import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { confirmUploadBody, documentRequirementsQuery, idParams, listDocumentsQuery, patchDocumentVisibilityBody, rejectDocumentBody, uploadUrlBody, verifyDocumentBody } from '@unigate/validation';
import { paginated, sendCreated, sendNoContent, sendOk } from '@/common/envelope.js';
import { scopeFor } from '@/middleware/authenticate.js';
import type { ValidatedRequest } from '@/middleware/validate.js';
import * as documents from './documents.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;

export async function uploadUrl(req: Request, res: Response): Promise<void> {
  const { body } = (req as R<z.infer<typeof uploadUrlBody>>).validated;
  const dto = await documents.requestUploadUrl(scopeFor(req, 'documents.read_any'), body);
  sendCreated(res, dto, `/api/v1/documents/${dto.documentId}`);
}

export async function confirm(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof confirmUploadBody>, unknown, z.infer<typeof idParams>>).validated;
  sendOk(res, await documents.confirmUpload(scopeFor(req, 'documents.read_any'), params.id, body.checksumSha256));
}

export async function list(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof listDocumentsQuery>>).validated;
  const { items, total } = await documents.listDocuments(scopeFor(req, 'documents.read_any'), query, query);
  res.status(200).json(paginated(items, query.page, query.pageSize, total));
}

export async function get(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof idParams>>).validated;
  sendOk(res, await documents.getDocument(scopeFor(req, 'documents.read_any'), params.id));
}

export async function downloadUrl(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof idParams>>).validated;
  sendOk(res, await documents.getDownloadUrl(scopeFor(req, 'documents.read_any'), params.id, { ipAddress: req.ip ?? null }));
}

export async function verify(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof verifyDocumentBody>, unknown, z.infer<typeof idParams>>).validated;
  sendOk(res, await documents.verifyDocument(scopeFor(req, 'documents.verify'), params.id, body));
}

export async function reject(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof rejectDocumentBody>, unknown, z.infer<typeof idParams>>).validated;
  sendOk(res, await documents.rejectDocument(scopeFor(req, 'documents.verify'), params.id, body.rejectionReason));
}

export async function visibility(req: Request, res: Response): Promise<void> {
  const { body, params } = (req as R<z.infer<typeof patchDocumentVisibilityBody>, unknown, z.infer<typeof idParams>>).validated;
  sendOk(res, await documents.setVisibility(scopeFor(req, 'documents.read_any'), params.id, body.visibility));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const { params } = (req as R<unknown, unknown, z.infer<typeof idParams>>).validated;
  await documents.deleteDocument(scopeFor(req, 'documents.read_any'), params.id);
  sendNoContent(res);
}

export async function requirements(req: Request, res: Response): Promise<void> {
  const { query } = (req as R<unknown, z.infer<typeof documentRequirementsQuery>>).validated;
  sendOk(res, await documents.requirementsFor(scopeFor(req, 'documents.read_any'), query.appliesTo, query.targetId, query.transportType));
}
