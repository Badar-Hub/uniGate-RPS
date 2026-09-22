import { ScrollView } from 'react-native';
import { DocumentChecklist } from '@/components/document-checklist';
import { Muted, QueryState, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys, useInvalidate, useOwner } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { apiErrorOf } from '@/lib/api';

/** One applied vertical → filter the checklist by it; none or both → every requirement. */
function ownerChecklistVertical(verticals: { transportType: string; status: string }[] | undefined): 'PASSENGER' | 'GOODS' | undefined {
  const applied = (verticals ?? []).filter((v) => v.status !== 'REJECTED').map((v) => v.transportType);
  return applied.length === 1 ? (applied[0] as 'PASSENGER' | 'GOODS') : undefined;
}

/**
 * The owner's own checklists (the web's DocumentsPage): the business documents (`appliesTo=OWNER`,
 * the checklist the submit-for-review guard runs) and the identity documents of the user
 * (`appliesTo=USER`). Vehicle and driver documents live on their own pages.
 */
export default function OwnerDocumentsScreen() {
  const { t, errorMessage } = useI18n();
  const { me } = useSession();
  const invalidate = useInvalidate();
  const ownerId = me?.profiles.owner?.id ?? null;
  const owner = useOwner(ownerId);
  if (!me) return null;
  // The checklist follows the verticals the vendor applied for (a goods vendor needs the goods
  // licence, not the passenger one); with both applied no filter is sent, which returns every
  // requirement. Server-side, submit-for-review checks exactly this set.
  const transportType = ownerChecklistVertical(owner.data?.verticals);

  return (
    <Screen header>
      <ScrollView contentContainerClassName="py-4 pb-12">
        <Muted>{t('documents.subtitle')}</Muted>
        {ownerId ? (
          <>
            <QueryState pending={owner.isPending} error={owner.isError ? errorMessage(apiErrorOf(owner.error)) : null} retryLabel={t('common.retry')} onRetry={() => void owner.refetch()}>
              <DocumentChecklist target={{ kind: 'OWNER', id: ownerId, label: t('documents.targetOwner'), ...(transportType ? { transportType } : {}) }} onChanged={() => void invalidate(keys.owner(ownerId))} />
            </QueryState>
            <DocumentChecklist target={{ kind: 'USER', id: me.id, label: t('documents.targetUser') }} />
          </>
        ) : (
          <Muted>{t('documents.noChecklist')}</Muted>
        )}
      </ScrollView>
    </Screen>
  );
}
