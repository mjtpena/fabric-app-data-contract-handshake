import { Chip } from '@x10/shared/ui';

import { ackMeta, changeTypeMeta, healthMeta, noticeStatusMeta, type Health } from '../domain/health';
import type { AckStatus, ChangeType, NoticeStatus } from '../model';

export function HealthChip({ health, title }: { health: Health | null; title?: string }) {
  if (!health) return <Chip tone="neutral" icon={false}>No open notices</Chip>;
  const m = healthMeta[health];
  return (
    <span data-testid="health-chip" data-health={health}>
      <Chip tone={m.tone} title={title ?? m.help}>
        {m.label}
      </Chip>
    </span>
  );
}

export function AckChip({ status }: { status: AckStatus }) {
  const m = ackMeta[status];
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

export function TypeChip({ type }: { type: ChangeType }) {
  const m = changeTypeMeta[type];
  return (
    <Chip tone={m.tone} icon={false} title={m.help}>
      {m.label}
    </Chip>
  );
}

export function NoticeStatusChip({ status }: { status: NoticeStatus }) {
  const m = noticeStatusMeta[status];
  return (
    <Chip tone={m.tone} icon={false}>
      {m.label}
    </Chip>
  );
}
