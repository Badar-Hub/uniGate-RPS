import { z } from 'zod';
import { TRANSPORT_TYPE, WEBHOOK_PROCESSING_STATUS } from '@unigate/types';
import { isoDate, isoTimestamp, uuid } from './primitives.js';
import { offsetPagination } from './pagination.js';

/** Admin (api.md §8.29). */

const range = { dateFrom: isoDate, dateTo: isoDate };
const refineRange = (q: { dateFrom: string; dateTo: string }) => q.dateTo >= q.dateFrom;

export const adminDashboardQuery = z.object({ ...range, transportType: z.enum(TRANSPORT_TYPE).optional() }).strict().refine(refineRange, 'dateTo must not precede dateFrom');
export const adminDashboardSeriesQuery = z.object({ ...range, bucket: z.enum(['day', 'week', 'month']).default('day'), transportType: z.enum(TRANSPORT_TYPE).optional() }).strict().refine(refineRange, 'dateTo must not precede dateFrom');
export const listWebhookEventsQuery = offsetPagination.extend({ providerCode: z.string().max(48).optional(), processingStatus: z.enum(WEBHOOK_PROCESSING_STATUS).optional(), signatureValid: z.coerce.boolean().optional(), dateFrom: isoTimestamp.optional(), dateTo: isoTimestamp.optional() }).strict();
export const listOutboxQuery = offsetPagination.extend({ status: z.enum(['PENDING', 'PUBLISHED', 'FAILED']).optional(), eventType: z.string().max(96).optional() }).strict();
export const outboxIdParams = z.object({ id: uuid }).strict();
