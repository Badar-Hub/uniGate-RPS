import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { createCategoryBody, createMakeBody, createModelBody, idParams, listCategoriesQuery, listCitiesQuery, listDocumentTypesQuery, listModelsQuery, patchCategoryBody } from '@unigate/validation';
import { ok, sendCreated, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as cat from './catalogue.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;

/**
 * Reference reads are the only publicly cacheable part of the API (api.md §8.9): ETag +
 * `Cache-Control: public, max-age=300, stale-while-revalidate=3600`, 304 on If-None-Match.
 */
function sendCached(req: Request, res: Response, data: unknown): void {
  const body = JSON.stringify(ok(data));
  const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  res.setHeader('ETag', etag);
  if (req.header('if-none-match') === etag) {
    res.status(304).end();
    return;
  }
  res.status(200).type('application/json').send(body);
}

export function catalogueRouter(): Router {
  const r = Router({ strict: true });

  // ── public reads ──────────────────────────────────────────────────────────
  r.get('/vehicle-categories', validate({ query: listCategoriesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listCategoriesQuery>>).validated;
    sendCached(req, res, await cat.listCategories(query));
  }));
  r.get('/reference/regions', h(async (req, res) => {
    sendCached(req, res, await cat.listRegions());
  }));
  r.get('/reference/cities', validate({ query: listCitiesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listCitiesQuery>>).validated;
    sendCached(req, res, await cat.listCities(query));
  }));
  r.get('/reference/vehicle-makes', h(async (req, res) => {
    sendCached(req, res, await cat.listMakes());
  }));
  r.get('/reference/vehicle-models', validate({ query: listModelsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listModelsQuery>>).validated;
    sendCached(req, res, await cat.listModels(query));
  }));
  r.get('/reference/document-types', validate({ query: listDocumentTypesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listDocumentTypesQuery>>).validated;
    sendCached(req, res, await cat.listDocumentTypes(query));
  }));
  r.get('/reference/expense-categories', h(async (req, res) => {
    sendCached(req, res, await cat.listExpenseCategories());
  }));
  r.get('/reference/maintenance-service-types', h(async (req, res) => {
    sendCached(req, res, await cat.listMaintenanceServiceTypes());
  }));
  r.get('/reference/enums', h(async (req, res) => {
    sendCached(req, res, cat.enumCatalogue());
    await Promise.resolve();
  }));

  // ── managed writes ────────────────────────────────────────────────────────
  const manage = [authenticate(), csrfGuard(), requirePermission('reference.manage')];
  r.post('/vehicle-categories', ...manage, validate({ body: createCategoryBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createCategoryBody>>).validated;
    sendCreated(res, await cat.createCategory(scopeFor(req, 'reference.manage'), body));
  }));
  r.patch('/vehicle-categories/:id', ...manage, validate({ params: idParams, body: patchCategoryBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchCategoryBody>, unknown, z.infer<typeof idParams>>).validated;
    sendOk(res, await cat.patchCategory(scopeFor(req, 'reference.manage'), params.id, body));
  }));
  r.delete('/vehicle-categories/:id', ...manage, validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof idParams>>).validated;
    sendOk(res, await cat.patchCategory(scopeFor(req, 'reference.manage'), params.id, { isActive: false }));
  }));
  r.post('/reference/vehicle-makes', ...manage, validate({ body: createMakeBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createMakeBody>>).validated;
    sendCreated(res, await cat.createMake(scopeFor(req, 'reference.manage'), body));
  }));
  r.post('/reference/vehicle-models', ...manage, validate({ body: createModelBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createModelBody>>).validated;
    sendCreated(res, await cat.createModel(scopeFor(req, 'reference.manage'), body));
  }));

  return r;
}
