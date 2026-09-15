import { Router } from 'express';
import {
  confirmUploadBody,
  documentRequirementsQuery,
  idParams,
  listDocumentsQuery,
  patchDocumentVisibilityBody,
  rejectDocumentBody,
  uploadUrlBody,
  verifyDocumentBody,
} from '@unigate/validation';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate } from '@/middleware/validate.js';
import * as c from './documents.controller.js';

/** api.md §8.10 `/documents`. Static paths are declared before `/:id` so `requirements` never matches as an id. */
export function documentsRouter(): Router {
  const r = Router({ strict: true });
  r.use(authenticate(), csrfGuard());

  r.post('/documents/upload-url', requirePermission('documents.upload'), validate({ body: uploadUrlBody }), h(c.uploadUrl));
  r.get('/documents/requirements', requirePermission('documents.read'), validate({ query: documentRequirementsQuery }), h(c.requirements));
  r.get('/documents', requirePermission('documents.read'), validate({ query: listDocumentsQuery }), h(c.list));
  r.get('/documents/:id', requirePermission('documents.read'), validate({ params: idParams }), h(c.get));
  r.post('/documents/:id/confirm', requirePermission('documents.upload'), idempotent({ required: true }), validate({ params: idParams, body: confirmUploadBody }), h(c.confirm));
  r.get('/documents/:id/download-url', requirePermission('documents.read'), validate({ params: idParams }), h(c.downloadUrl));
  r.post('/documents/:id/verify', requirePermission('documents.verify'), validate({ params: idParams, body: verifyDocumentBody }), h(c.verify));
  r.post('/documents/:id/reject', requirePermission('documents.verify'), validate({ params: idParams, body: rejectDocumentBody }), h(c.reject));
  r.patch('/documents/:id/visibility', requirePermission('documents.upload'), validate({ params: idParams, body: patchDocumentVisibilityBody }), h(c.visibility));
  r.delete('/documents/:id', requirePermission('documents.delete'), validate({ params: idParams }), h(c.remove));

  return r;
}
