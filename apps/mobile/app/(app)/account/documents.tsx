import { ScrollView } from 'react-native';
import { DocumentChecklist } from '@/components/document-checklist';
import { Muted, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys, useInvalidate } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * The owner's own checklists (the web's DocumentsPage): the business documents (`appliesTo=OWNER`,
 * the checklist the submit-for-review guard runs) and the identity documents of the user
 * (`appliesTo=USER`). Vehicle and driver documents live on their own pages.
 */
export default function OwnerDocumentsScreen() {
  const { t } = useI18n();
  const { me } = useSession();
  const invalidate = useInvalidate();
  const ownerId = me?.profiles.owner?.id ?? null;
  if (!me) return null;

  return (
    <Screen header>
      <ScrollView contentContainerClassName="py-4 pb-12">
        <Muted>{t('documents.subtitle')}</Muted>
        {ownerId ? (
          <>
            <DocumentChecklist target={{ kind: 'OWNER', id: ownerId, label: t('documents.targetOwner'), transportType: 'PASSENGER' }} onChanged={() => void invalidate(keys.owner(ownerId))} />
            <DocumentChecklist target={{ kind: 'USER', id: me.id, label: t('documents.targetUser') }} />
          </>
        ) : (
          <Muted>{t('documents.noChecklist')}</Muted>
        )}
      </ScrollView>
    </Screen>
  );
}
