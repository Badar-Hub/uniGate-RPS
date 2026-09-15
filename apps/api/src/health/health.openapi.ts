import { z } from 'zod';
import { registry, successEnvelope } from '@/docs/registry.js';

const health = z.object({ status: z.literal('ok'), uptimeSeconds: z.number().int() }).openapi('Health');
const readiness = z
  .object({ ready: z.boolean(), checks: z.object({ database: z.boolean(), redis: z.boolean() }) })
  .openapi('Readiness');

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['platform'],
  summary: 'Liveness',
  responses: { 200: { description: 'Process is up', content: { 'application/json': { schema: successEnvelope(health, 'HealthEnvelope') } } } },
});

registry.registerPath({
  method: 'get',
  path: '/ready',
  tags: ['platform'],
  summary: 'Readiness — dependency reachability as booleans only',
  responses: {
    200: { description: 'All hard dependencies reachable', content: { 'application/json': { schema: successEnvelope(readiness, 'ReadinessEnvelope') } } },
    503: { description: 'A hard dependency is down (Retry-After set)', content: { 'application/json': { schema: successEnvelope(readiness, 'ReadinessEnvelope') } } },
  },
});
