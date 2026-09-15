import type { ActorIdentity, ActorScope } from '@unigate/types';
import { getBooking } from '@/modules/bookings/booking.service.js';
import { tripBackfill } from '@/modules/trips/trip.service.js';

/**
 * Room authorization (api.md §9.2–§9.3): the same predicates the HTTP reads use, called through
 * the same services. "Does not exist" and "not yours" are indistinguishable (NOT_FOUND).
 */

export interface RoomPolicyBackfill {
  trip?: { status: string; allowedNextStatuses: string[]; position: unknown } | undefined;
}

function scopeOf(actor: ActorIdentity, globalPermission: string, fallback: 'OWN' | 'PARTY' = 'PARTY'): ActorScope {
  return { kind: actor.permissions.has(globalPermission) ? 'GLOBAL' : fallback, actor, requestId: 'socket' };
}

export async function canJoinRoom(actor: ActorIdentity, room: string): Promise<{ ok: true; backfill: RoomPolicyBackfill } | { ok: false }> {
  const [kind, id] = room.split(':', 2);
  if (!kind || !id) return { ok: false };
  switch (kind) {
    case 'user':
      return id === actor.userId ? { ok: true, backfill: {} } : { ok: false };
    case 'trip': {
      const b = await tripBackfill(scopeOf(actor, 'tracking.read_any'), id);
      return b ? { ok: true, backfill: { trip: b } } : { ok: false };
    }
    case 'booking': {
      try {
        await getBooking(scopeOf(actor, 'bookings.read_any'), id);
        return { ok: true, backfill: {} };
      } catch {
        return { ok: false };
      }
    }
    case 'owner':
      return actor.ownerProfileId === id || actor.permissions.has('bookings.read_any') ? { ok: true, backfill: {} } : { ok: false };
    case 'admin':
      return id === 'ops' && actor.permissions.has('dashboard.read') && actor.permissions.has('trips.read_any') ? { ok: true, backfill: {} } : { ok: false };
    default:
      return { ok: false };
  }
}
