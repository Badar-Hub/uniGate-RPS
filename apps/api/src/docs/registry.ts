import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/**
 * api.md P5 — OpenAPI 3.1 is generated from the same Zod schemas that validate requests.
 * Modules register their routes here; `generateSpec()` is served at /api/v1/docs/openapi.json
 * and diffed against the committed openapi.json in CI.
 */
export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const errorBody = z
  .object({
    success: z.literal(false),
    data: z.null(),
    message: z.string(),
    error: z.object({
      code: z.string(),
      details: z.record(z.unknown()).optional(),
      requestId: z.string().uuid(),
    }),
  })
  .openapi('ErrorEnvelope');

registry.register('ErrorEnvelope', errorBody);

export function successEnvelope<T extends z.ZodTypeAny>(data: T, name: string) {
  return z
    .object({
      success: z.literal(true),
      data,
      message: z.string().nullable(),
      meta: z.record(z.unknown()),
    })
    .openapi(name);
}

export function generateSpec(apiUrl: string, version: string): Record<string, unknown> {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'UniGate API',
      version,
      description: 'Vehicle hiring & management platform. Money is a decimal string; timestamps are ISO-8601 UTC; every response uses the same envelope.',
    },
    servers: [{ url: `${apiUrl}/api/v1` }],
  }) as unknown as Record<string, unknown>;
}
