import { io, type Socket } from 'socket.io-client';
import { apiUrl } from '@/lib/api';

/**
 * The /rt namespace (api.md §9). Web sessions authenticate with the ug_at cookie (withCredentials);
 * the socket is a delivery channel only — every payload is data the page could fetch over HTTP.
 */
let socket: Socket | null = null;

function origin(): string {
  return new URL(apiUrl('/')).origin;
}

export function realtime(): Socket {
  if (socket) return socket;
  socket = io(`${origin()}/rt`, { path: '/api/v1/rt/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 30_000 });
  return socket;
}

export function joinRoom(room: string): Promise<{ ok: boolean; backfill?: Record<string, unknown> }> {
  return new Promise((resolve) => {
    realtime().emit('room.join', { room }, (ack: { ok: boolean; backfill?: Record<string, unknown> }) => {
      resolve(ack);
    });
  });
}

export function leaveRoom(room: string): void {
  socket?.emit('room.leave', { room }, () => undefined);
}
