import { io, type Socket } from 'socket.io-client';
import { config } from '@/config';
import { tokens } from '@/lib/auth/tokens';

/**
 * The `/rt` namespace (api.md §9) for the mobile client. The web sends the `ug_at` cookie; here
 * the Bearer access token travels in `auth.token` — never in the query string — and after the
 * HTTP client rotates the pair the socket re-authenticates in place with `auth.refresh`. The
 * socket is a delivery channel only: every event is data a screen already fetches over HTTP.
 */

let socket: Socket | null = null;
let lastToken: string | null = null;

function origin(): string {
  return new URL(config.apiUrl).origin;
}

export function realtime(): Socket {
  if (socket) return socket;
  socket = io(`${origin()}/rt`, {
    path: '/api/v1/rt/socket.io',
    transports: ['websocket'],
    reconnectionDelayMax: 30_000,
    // Evaluated on every (re)connect, so a reconnect after a refresh carries the current token.
    auth: (cb) => {
      lastToken = tokens.getAccess();
      cb({ token: lastToken ?? '' });
    },
  });
  return socket;
}

/** Called after `POST /auth/refresh` succeeds: the server re-verifies and re-evaluates rooms (§9.1). */
export function refreshRealtimeAuth(): void {
  const token = tokens.getAccess();
  if (!socket || !token || token === lastToken) return;
  lastToken = token;
  if (socket.connected) socket.emit('auth.refresh', { token }, () => undefined);
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
  lastToken = null;
}

export interface JoinAck {
  ok: boolean;
  backfill?: Record<string, unknown>;
  error?: { code: string };
}

export function joinRoom(room: string): Promise<JoinAck> {
  return new Promise((resolve) => {
    realtime().timeout(10_000).emit('room.join', { room }, (err: Error | null, ack?: JoinAck) => {
      resolve(err || !ack ? { ok: false, error: { code: 'TIMEOUT' } } : ack);
    });
  });
}

export function leaveRoom(room: string): void {
  socket?.emit('room.leave', { room }, () => undefined);
}

/** `trip.location` payload (api.md §9.4). */
export interface TripLocationEvent {
  tripId: string;
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  speedKmh: number | null;
  accuracyM: number | null;
  recordedAt: string;
  stale: boolean;
  seq: number;
}

/** `trip.status` payload (api.md §9.4). */
export interface TripStatusEvent {
  tripId: string;
  bookingId: string;
  status: string;
  previousStatus: string;
  occurredAt: string;
  seq: number;
}
