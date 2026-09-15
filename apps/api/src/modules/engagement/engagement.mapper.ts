import type { ComplaintDto, ComplaintNoteDto, RatingDto } from '@unigate/types';
import type { ComplaintRow, RatingRow } from './engagement.repository.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** "Ahmed Al-Rashid" → "Ahmed A." — a rater is identifiable to the platform, not to the subject. */
export function maskName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? `${(parts.at(-1) ?? '').charAt(0)}.` : '';
  return [first, last].filter(Boolean).join(' ');
}

export function toRatingDto(r: RatingRow, raterName: string): RatingDto {
  return {
    id: r.id, bookingId: r.bookingId, bookingNumber: r.booking.bookingNumber, tripId: r.tripId, raterRole: r.raterRole, raterDisplayName: maskName(raterName), subjectType: r.subjectType, subjectId: r.subjectId,
    score: r.score, comment: r.comment, status: r.status, createdAt: r.createdAt.toISOString(),
  };
}

export function toComplaintDto(c: ComplaintRow, names: Map<string, string>, opts: { includeInternal: boolean; respondBy: Date | null }): ComplaintDto {
  const notes: ComplaintNoteDto[] = c.notes
    .filter((n) => opts.includeInternal || !n.isInternal)
    .map((n) => ({ id: n.id, authorUserId: n.authorUserId, authorName: names.get(n.authorUserId) ?? '—', body: n.body, isInternal: n.isInternal, createdAt: n.createdAt.toISOString() }));
  return {
    id: c.id, complaintNumber: c.complaintNumber, raisedByUserId: c.raisedByUserId, raisedByName: names.get(c.raisedByUserId) ?? '—', bookingId: c.bookingId, bookingNumber: c.booking?.bookingNumber ?? null, tripId: c.tripId,
    againstType: c.againstType, againstId: c.againstId, category: c.category, subject: c.subject, description: c.description, severity: c.severity, status: c.status,
    assignedToUserId: c.assignedToUserId, assignedToName: c.assignedToUserId ? (names.get(c.assignedToUserId) ?? '—') : null, resolution: c.resolution, resolvedAt: iso(c.resolvedAt),
    respondBy: iso(opts.respondBy), overdue: opts.respondBy !== null && opts.respondBy < new Date(), notes,
    createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(),
  };
}
