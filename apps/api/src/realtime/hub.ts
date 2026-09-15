import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ActorIdentity } from '@unigate/types';
import { cacheGet } from '@/common/throttle.js';
import { config } from '@/config/index.js';
import { logger } from '@/logging/logger.js';
import { actorFromToken } from '@/middleware/authenticate.js';
import { canJoinRoom, type RoomPolicyBackfill } from './rooms.js';

/**
 * The Socket.IO delivery channel (api.md §9). It never carries an authorization decision: the
 * handshake resolves the same actor the HTTP middleware would, rooms are joined through the same
 * policy functions the HTTP reads use, and no client→server event mutates domain state.
 */

export interface SocketData {
  actor: ActorIdentity;
  authenticatedAt: number;
}

let io: Server | null = null;
const seqByRoom = new Map<string, number>();

function nextSeq(room: string): number {
  const n = (seqByRoom.get(room) ?? 0) + 1;
  seqByRoom.set(room, n);
  return n;
}

function tokenFrom(socket: Socket): { token: string; mode: 'bearer' | 'cookie' } | null {
  const auth = socket.handshake.auth as { token?: unknown };
  if (typeof auth.token === 'string' && auth.token) return { token: auth.token, mode: 'bearer' };
  // Web: the ug_at cookie travels with credentials. Never a query string (proxy logs, Referer).
  const cookie = socket.handshake.headers.cookie ?? '';
  const m = /(?:^|;\s*)ug_at=([^;]+)/.exec(cookie);
  if (m?.[1]) return { token: decodeURIComponent(m[1]), mode: 'cookie' };
  return null;
}

export function startRealtime(server: HttpServer): Server {
  const cfg = config();
  io = new Server(server, { path: '/api/v1/rt/socket.io', cors: { origin: [...cfg.corsOrigins], credentials: true }, transports: ['websocket', 'polling'] });
  const ns = io.of('/rt');

  ns.use((socket, next) => {
    const t = tokenFrom(socket);
    if (!t) {
      next(new Error('AUTH_TOKEN_MISSING'));
      return;
    }
    actorFromToken(t.token, t.mode)
      .then(({ actor }) => {
        (socket.data as SocketData).actor = actor;
        (socket.data as SocketData).authenticatedAt = Date.now();
        next();
      })
      .catch((e: unknown) => {
        next(new Error(e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : 'AUTH_TOKEN_INVALID'));
      });
  });

  ns.on('connection', (socket) => {
    const data = socket.data as SocketData;
    void socket.join(`user:${data.actor.userId}`);

    socket.on('room.join', (payload: { room?: unknown; sinceSeq?: unknown }, ack?: (r: unknown) => void) => {
      const room = typeof payload.room === 'string' ? payload.room : '';
      canJoinRoom(data.actor, room)
        .then((res) => {
          if (!res.ok) {
            ack?.({ ok: false, error: { code: 'NOT_FOUND' } });
            return;
          }
          void socket.join(room);
          ack?.({ ok: true, backfill: res.backfill });
        })
        .catch(() => ack?.({ ok: false, error: { code: 'NOT_FOUND' } }));
    });
    socket.on('room.leave', (payload: { room?: unknown }, ack?: (r: unknown) => void) => {
      if (typeof payload.room === 'string') void socket.leave(payload.room);
      ack?.({ ok: true });
    });
    socket.on('auth.refresh', (payload: { token?: unknown }, ack?: (r: unknown) => void) => {
      const token = typeof payload.token === 'string' ? payload.token : '';
      actorFromToken(token, 'bearer')
        .then(async ({ actor }) => {
          data.actor = actor;
          data.authenticatedAt = Date.now();
          // Re-evaluate every joined room; leave those the actor can no longer access.
          for (const room of socket.rooms) {
            if (room === socket.id || room === `user:${actor.userId}`) continue;
            const res = await canJoinRoom(actor, room);
            if (!res.ok) await socket.leave(room);
          }
          ack?.({ ok: true });
        })
        .catch(() => ack?.({ ok: false, error: { code: 'AUTH_TOKEN_INVALID' } }));
    });
    socket.on('ping', (_payload: unknown, ack?: (r: unknown) => void) => {
      ack?.({ serverTime: new Date().toISOString() });
    });
  });

  // A revoked session must not keep a room: sweep every 15 minutes (api.md §9.3).
  const sweep = setInterval(() => {
    void (async () => {
      for (const [, socket] of ns.sockets) {
        const d = socket.data as SocketData;
        if (d.actor.sessionId && (await cacheGet(`sess:revoked:${d.actor.sessionId}`)) !== null) socket.disconnect(true);
      }
    })();
  }, 15 * 60_000);
  sweep.unref();

  logger().info({ path: '/api/v1/rt/socket.io', namespace: '/rt' }, 'realtime namespace mounted');
  return io;
}

/** Emit to a room with the monotonic per-room sequence and emittedAt (api.md §9.4). No-op without a server (worker, tests). */
export function emitToRoom(room: string, event: string, payload: Record<string, unknown>): void {
  if (!io) return;
  io.of('/rt').to(room).emit(event, { ...payload, emittedAt: new Date().toISOString(), seq: nextSeq(room) });
}

/** Evict everyone from a room (booking cancelled, driver unassigned). */
export async function evictRoom(room: string): Promise<void> {
  if (!io) return;
  const sockets = await io.of('/rt').in(room).fetchSockets();
  for (const s of sockets) s.leave(room);
}

export async function stopRealtime(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}

export type { RoomPolicyBackfill };
