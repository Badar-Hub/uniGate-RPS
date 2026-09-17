import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { DocumentDto, DocumentRequirementDto, DocumentTypeDto } from '@unigate/types';
import { DateField } from '@/components/date-field';
import { Sheet } from '@/components/sheet';
import { Badge, Button, Card, ErrorBanner, Loading, Muted, Notice, ProgressBar, SectionTitle, StatusBadge } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatBytes, pickDocumentFile, type PickSource } from '@/lib/documents/pick';
import { uploadDocument, type PickedFile, type UploadProgress } from '@/lib/documents/upload';
import { formatDate, isoDay } from '@/lib/format';
import { useDocumentRequirements, useInvalidate, keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

export interface ChecklistTarget {
  kind: 'USER' | 'OWNER' | 'DRIVER' | 'VEHICLE' | 'CORPORATE_CUSTOMER' | 'EXPENSE' | 'MAINTENANCE_RECORD' | 'TRIP_PROOF';
  id: string;
  /** Shown in the section title and the upload sheet. */
  label: string;
  transportType?: 'PASSENGER' | 'GOODS' | undefined;
}

/**
 * One target's document requirements (`GET /documents/requirements`, api.md §8.10) with the
 * presigned upload from camera / gallery / files — the mobile counterpart of the web's
 * `DocumentChecklist`. Every row shows the current status (MISSING / PENDING / VERIFIED /
 * REJECTED / EXPIRED) and an Upload or Replace button unless it is already VERIFIED.
 */
export function DocumentChecklist({ target, onChanged }: { target: ChecklistTarget; onChanged?: (() => void) | undefined }) {
  const { t, has, locale, errorMessage } = useI18n();
  const q = useDocumentRequirements(target.kind, target.id, target.transportType ?? null);
  const invalidate = useInvalidate();
  const [uploading, setUploading] = useState<DocumentRequirementDto | null>(null);

  return (
    <View>
      <SectionTitle>{t('documents.checklistFor', { target: target.label })}</SectionTitle>
      <Muted>{t('documents.accepted')}</Muted>
      <View className="mt-2">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorBanner message={errorMessage(apiErrorOf(q.error))} />
        ) : q.data.length === 0 ? (
          <Muted>{t('documents.noChecklist')}</Muted>
        ) : (
          q.data.map((r) => (
            <Card key={r.documentTypeCode}>
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-base font-medium text-card-foreground text-start">{locale === 'ar' ? r.nameAr : r.nameEn}</Text>
                  <View className="mt-1 flex-row flex-wrap items-center gap-2">
                    <Badge>{r.isMandatory ? t('documents.mandatory') : t('documents.optional')}</Badge>
                    <StatusBadge label={statusLabel({ t, has }, 'document', r.status)} tone={toneFor('document', r.status)} />
                  </View>
                  {r.expiryDate ? <Muted ltr>{t('documents.expires', { date: formatDate(`${r.expiryDate}T12:00:00`, locale) })}</Muted> : null}
                </View>
              </View>
              {r.status !== 'VERIFIED' ? (
                <View className="mt-3">
                  <Button
                    title={r.status === 'MISSING' ? t('documents.upload') : t('documents.replace')}
                    variant={r.status === 'MISSING' ? 'primary' : 'secondary'}
                    onPress={() => {
                      setUploading(r);
                    }}
                  />
                </View>
              ) : null}
            </Card>
          ))
        )}
      </View>
      {uploading ? (
        <UploadDocumentSheet
          target={target}
          documentTypeCode={uploading.documentTypeCode}
          name={locale === 'ar' ? uploading.nameAr : uploading.nameEn}
          requiresExpiry={uploading.requiresExpiry}
          onClose={(doc) => {
            setUploading(null);
            if (doc) {
              void invalidate(keys.documentRequirements(target.kind, target.id, target.transportType ?? null), ['documents']);
              onChanged?.();
            }
          }}
        />
      ) : null}
    </View>
  );
}

const STAGE_KEYS: Record<UploadProgress['stage'], string> = {
  hashing: 'documents.stage.hashing',
  requesting: 'documents.stage.requesting',
  uploading: 'documents.stage.uploading',
  confirming: 'documents.stage.confirming',
};

/**
 * Pick → (compress) → hash → presigned PUT → confirm, with the stage and bytes shown as they
 * happen. Reused outside the checklist for ad-hoc documents (an expense receipt, a workshop
 * invoice on a maintenance record). `onClose` receives the confirmed document, or null.
 */
export function UploadDocumentSheet({
  target,
  documentTypeCode,
  name,
  requiresExpiry,
  onClose,
}: {
  target: ChecklistTarget;
  documentTypeCode: string;
  name: string;
  requiresExpiry: boolean;
  onClose: (doc: DocumentDto | null) => void;
}) {
  const { t, errorMessage } = useI18n();
  const requirement = { documentTypeCode, requiresExpiry };
  const action = useAction(['documentTypeCode', 'target', 'originalFilename', 'mimeType', 'sizeBytes', 'checksumSha256', 'issueDate', 'expiryDate', 'visibility']);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [done, setDone] = useState<DocumentDto | null>(null);
  const [picking, setPicking] = useState(false);

  // The document type's constraints (MIME allow-list, size cap) come from the reference catalogue.
  const types = useQuery({
    queryKey: ['reference', 'document-types', target.kind] as const,
    queryFn: () => fetchOrThrow<DocumentTypeDto[]>('/reference/document-types', { query: { appliesTo: target.kind } }),
    staleTime: 60 * 60 * 1000,
  });
  const docType = types.data?.find((d) => d.code === requirement.documentTypeCode);
  const allowed = docType?.allowedMimeTypes ?? [];
  const maxBytes = docType?.maxSizeBytes ?? null;
  const today = isoDay(new Date());

  const pick = async (source: PickSource) => {
    setPickError(null);
    setPicking(true);
    const res = await pickDocumentFile(source, allowed, maxBytes !== null ? Math.min(maxBytes, 2 * 1024 * 1024) : undefined);
    setPicking(false);
    if (!res.ok) {
      if (res.reason === 'permission') setPickError(t('documents.pick.permission'));
      else if (res.reason === 'too_large') setPickError(t('documents.pick.tooLarge'));
      else if (res.reason === 'failed') setPickError(res.message ?? t('errors.generic'));
      return;
    }
    if (allowed.length && !allowed.includes(res.file.mimeType)) {
      setPickError(t('documents.pick.typeNotAllowed', { types: allowed.join(', ') }));
      return;
    }
    if (maxBytes !== null && res.file.size !== null && res.file.size > maxBytes) {
      setPickError(t('documents.pick.tooLarge'));
      return;
    }
    setFile(res.file);
  };

  const submit = async () => {
    if (!file) return;
    setProgress({ stage: 'hashing', fraction: 0 });
    const res = await action.run(() =>
      uploadDocument({
        documentTypeCode: requirement.documentTypeCode,
        target: { kind: target.kind, id: target.id },
        file,
        issueDate: issueDate || undefined,
        expiryDate: expiryDate || undefined,
        visibility: 'INTERNAL',
        onProgress: setProgress,
      }),
    );
    setProgress(null);
    if (!res) return;
    setDone(res);
  };

  const canSubmit = Boolean(file) && !progress && (!requirement.requiresExpiry || expiryDate.length > 0);

  return (
    <Sheet
      title={t('documents.dialogTitle', { name })}
      onClose={() => {
        onClose(done);
      }}
      closeLabel={done ? t('common.done') : t('common.cancel')}
    >
      {done ? (
        <Notice message={t('documents.uploaded')} />
      ) : (
        <View>
          <Muted>{t('documents.checklistFor', { target: target.label })}</Muted>
          {docType ? (
            <Muted>
              {t('documents.constraints', { types: docType.allowedMimeTypes.map(shortMime).join(', '), max: formatBytes(docType.maxSizeBytes) })}
            </Muted>
          ) : null}
          <View className="mt-3">
            <ErrorBanner message={action.banner ?? pickError} />
            {types.isError ? <ErrorBanner message={errorMessage(apiErrorOf(types.error))} /> : null}
          </View>

          <View className="mb-3 flex-row gap-2">
            <View className="flex-1">
              <Button title={t('documents.pick.camera')} variant="secondary" disabled={picking || Boolean(progress)} onPress={() => void pick('camera')} />
            </View>
            <View className="flex-1">
              <Button title={t('documents.pick.gallery')} variant="secondary" disabled={picking || Boolean(progress)} onPress={() => void pick('gallery')} />
            </View>
          </View>
          <Button title={t('documents.pick.file')} variant="secondary" disabled={picking || Boolean(progress)} onPress={() => void pick('file')} />

          <View className="my-3 rounded-md border border-border bg-muted p-3">
            {file ? (
              <>
                <Text className="text-sm font-medium text-foreground" style={{ writingDirection: 'ltr' }} numberOfLines={1}>
                  {file.name}
                </Text>
                <Muted ltr>
                  {file.mimeType}
                  {file.size !== null ? ` · ${formatBytes(file.size)}` : ''}
                </Muted>
              </>
            ) : (
              <Muted>{picking ? t('common.loading') : t('documents.pick.none')}</Muted>
            )}
          </View>

          <DateField label={t('documents.issueDate')} value={issueDate} onChange={setIssueDate} maximumDate={new Date()} clearable error={action.fields['issueDate']} />
          <DateField
            label={requirement.requiresExpiry ? t('documents.expiryDateRequired') : t('documents.expiryDate')}
            value={expiryDate}
            onChange={setExpiryDate}
            minimumDate={new Date(`${today}T00:00:00`)}
            clearable={!requirement.requiresExpiry}
            error={action.fields['expiryDate']}
          />

          {progress ? <ProgressBar fraction={progress.fraction} label={t(STAGE_KEYS[progress.stage])} /> : null}
          <Button title={progress ? t('documents.uploading') : t('documents.upload')} loading={Boolean(progress)} disabled={!canSubmit} onPress={() => void submit()} />
        </View>
      )}
    </Sheet>
  );
}

function shortMime(m: string): string {
  return m.replace('application/', '').replace('image/', '').toUpperCase();
}
