'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CustomerDto, OwnerDto } from '@unigate/types';
import { api } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { DocumentChecklist, type ChecklistTarget } from './document-checklist';

/** The actor's document checklists (identity, owner business, company). Vehicle documents live on the vehicle page. */
export function DocumentsPage() {
  const { me } = useSession();
  const t = useTranslations('portal.documents');
  const [targets, setTargets] = useState<ChecklistTarget[]>([]);

  useEffect(() => {
    if (!me) return;
    const next: ChecklistTarget[] = [];
    const ownerProfile = me.profiles.owner;
    if (ownerProfile) {
      // Filled in below from the owner's applied verticals; until then the common requirements show.
      next.push({ kind: 'OWNER', id: ownerProfile.id, label: t('targetOwner') });
      next.push({ kind: 'USER', id: me.id, label: t('targetUser') });
    }
    setTargets(next);
    if (ownerProfile) {
      // The checklist follows the verticals the vendor applied for — a goods vendor needs the goods
      // licence, not the passenger one. One vertical → filter by it; both → every requirement.
      void api<OwnerDto>(`/owners/${ownerProfile.id}`).then((res) => {
        if (!res.ok) return;
        const applied = res.data.verticals.filter((v) => v.status !== 'REJECTED').map((v) => v.transportType);
        if (applied.length !== 1) return;
        setTargets((cur) => cur.map((tg) => (tg.kind === 'OWNER' ? { ...tg, transportType: applied[0] as 'PASSENGER' | 'GOODS' } : tg)));
      });
    }
    if (me.profiles.customer) {
      void api<CustomerDto>(`/customers/${me.profiles.customer.id}`).then((res) => {
        const corporateId = res.ok ? res.data.corporate?.id : undefined;
        if (corporateId) setTargets((cur) => [...cur, { kind: 'CORPORATE_CUSTOMER', id: corporateId, label: t('targetCorporate') }]);
      });
    }
  }, [me, t]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {targets.length === 0 && <p className="text-sm text-muted-foreground">{t('noChecklist')}</p>}
      {targets.map((tg) => (
        <DocumentChecklist key={tg.id} target={tg} />
      ))}
    </div>
  );
}
