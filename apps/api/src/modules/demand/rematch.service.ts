import type { Prisma } from '@prisma/client';
import { newId } from '@/common/ids.js';
import { money } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { matchVehicles, systemScope } from './trip-request.service.js';
import * as repo from './trip-request.repository.js';

/**
 * Late invitations. `publishTripRequest` invites whatever is dispatchable at that moment; a
 * vehicle approved afterwards, or an owner who adds the pickup city to their service areas or
 * gains a vertical, would otherwise never see requests that are still open. Triggered from the
 * event worker on `vehicle.approved`, `owner.approved`, `owner.vertical_approved` and
 * `owner.service_areas_replaced`; idempotent through the invitation unique key
 * (request, owner, vehicle). Newly invited owners get the same NEW_TRIP_OPPORTUNITY notification
 * the original publish sends (`trip_request.invitations_added`).
 */
export interface RematchScope {
  vehicleId?: string;
  ownerProfileId?: string;
}

const OPEN: Prisma.TripRequestWhereInput = { status: { in: ['PUBLISHED', 'PARTIALLY_AWARDED'] } };

export async function rematchOpenRequests(filter: RematchScope, reason: string): Promise<{ requests: number; invitations: number }> {
  const now = new Date();
  const open = await prisma().tripRequest.findMany({ where: { ...OPEN, biddingClosesAt: { gt: now } }, select: repo.tripRequestSelect, orderBy: { pickupAt: 'asc' }, take: 500 });
  let invitations = 0;
  for (const r of open) {
    const matches = (await matchVehicles(r)).filter((m) => (filter.vehicleId ? m.candidate.id === filter.vehicleId : true) && (filter.ownerProfileId ? m.candidate.ownerProfileId === filter.ownerProfileId : true));
    if (!matches.length) continue;
    const existing = await prisma().tripRequestInvitation.findMany({ where: { tripRequestId: r.id, vehicleId: { in: matches.map((m) => m.candidate.id) } }, select: { vehicleId: true } });
    const fresh = matches.filter((m) => !existing.some((e) => e.vehicleId === m.candidate.id));
    if (!fresh.length) continue;
    const owners = [...new Set(fresh.map((m) => m.candidate.ownerProfileId))].filter((o) => !r.invitations.some((i) => i.ownerProfileId === o));
    await prisma().$transaction(async (tx) => {
      await tx.tripRequestInvitation.createMany({
        data: fresh.map((m) => ({ id: newId(), tripRequestId: r.id, ownerProfileId: m.candidate.ownerProfileId, vehicleId: m.candidate.id, matchScore: money(m.score), matchReason: { reasons: [...m.reasons, `LATE:${reason}`], vehiclePlate: m.candidate.plateNumberEn }, notificationChannels: [] })),
        skipDuplicates: true,
      });
      await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'trip_request.rematched', entityType: 'trip_request', entityId: r.id, afterValue: { reason, invitedVehicles: fresh.map((m) => m.candidate.id), newOwners: owners } }, tx);
      // Owners already invited through another vehicle were notified at publish; only new ones hear about it.
      if (owners.length) await publishEvent('trip_request', r.id, 'trip_request.invitations_added', { requestNumber: r.requestNumber, transportType: r.transportType, invitedOwnerProfileIds: owners, reason }, tx);
    });
    invitations += fresh.length;
  }
  if (invitations) logger().info({ ...filter, reason, requests: open.length, invitations }, 'late invitations written');
  return { requests: open.length, invitations };
}

export { systemScope };
