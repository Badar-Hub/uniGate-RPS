import { z } from 'zod';
import { COMPLAINT_AGAINST_TYPE, COMPLAINT_SEVERITY, COMPLAINT_STATUS, RATER_ROLE, RATING_STATUS, RATING_SUBJECT_TYPE } from '@unigate/types';
import { isoTimestamp, safeText, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Engagement — ratings and complaints (api.md §8.24–8.25). */

const category = z.string().regex(/^[A-Z_]{2,48}$/, 'category codes are UPPER_SNAKE');

export const createRatingBody = z
  .object({
    bookingId: uuid,
    raterRole: z.enum(RATER_ROLE),
    subjectType: z.enum(RATING_SUBJECT_TYPE),
    subjectId: uuid,
    score: z.number().int().min(1).max(5),
    comment: safeText(1000).nullable().optional(),
  })
  .strict();
export const listRatingsQuery = offsetPagination
  .extend({ subjectType: z.enum(RATING_SUBJECT_TYPE).optional(), subjectId: uuid.optional(), bookingId: uuid.optional(), minScore: z.coerce.number().int().min(1).max(5).optional(), status: z.enum(RATING_STATUS).optional() })
  .strict();
export const ratingSummaryQuery = z.object({ subjectType: z.enum(RATING_SUBJECT_TYPE), subjectId: uuid }).strict();
export const moderateRatingBody = z.object({ status: z.enum(RATING_STATUS), reason: safeText(500).pipe(z.string().min(3)) }).strict();

export const createComplaintBody = z
  .object({
    againstType: z.enum(COMPLAINT_AGAINST_TYPE),
    againstId: uuid.nullable().optional(),
    bookingId: uuid.nullable().optional(),
    tripId: uuid.nullable().optional(),
    category,
    subject: safeText(200).pipe(z.string().min(3)),
    description: safeText(4000).pipe(z.string().min(10)),
    severity: z.enum(COMPLAINT_SEVERITY).optional(),
  })
  .strict();
export const listComplaintsQuery = offsetPagination
  .extend({
    status: z.enum(COMPLAINT_STATUS).optional(), severity: z.enum(COMPLAINT_SEVERITY).optional(), category: category.optional(), againstType: z.enum(COMPLAINT_AGAINST_TYPE).optional(), bookingId: uuid.optional(),
    assignedToUserId: uuid.optional(), overdueOnly: z.coerce.boolean().default(false), dateFrom: isoTimestamp.optional(), dateTo: isoTimestamp.optional(),
  })
  .strict();
export const patchComplaintBody = z.object({ severity: z.enum(COMPLAINT_SEVERITY).optional(), category: category.optional(), assignedToUserId: uuid.nullable().optional() }).strict();
export const assignComplaintBody = z.object({ assignedToUserId: uuid.nullable() }).strict();
export const complaintStatusBody = z.object({ status: z.enum(COMPLAINT_STATUS), resolution: safeText(2000).optional(), note: safeText(2000).optional() }).strict();
export const complaintNoteBody = z.object({ body: safeText(2000).pipe(z.string().min(1)), isInternal: z.boolean().default(false) }).strict();
