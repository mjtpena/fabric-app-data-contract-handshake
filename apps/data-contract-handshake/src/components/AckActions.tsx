import { useState } from 'react';
import { ArrowRightLeft, Check, Hand, RotateCcw } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { useAction } from '@x10/shared/lib';
import { Button, ConfirmDialog, InlineError, cx } from '@x10/shared/ui';

import { setAckStatus } from '../domain/notices';
import { limits, type Ack, type AckStatus, type Schema } from '../model';

/**
 * The signal levers for one ack: Acknowledge, Object (a dialog with a required note) and Migrated.
 * `allowReset` adds "Reset to pending" for the contract owner or an admin. `levers` lays the buttons out as an equal
 * three-way row on phones (44 px targets).
 */
export function AckActions({
  ack,
  onChanged,
  allowReset,
  levers,
  onPending,
}: {
  ack: Pick<Ack, 'id' | 'status' | 'teamName'>;
  onChanged: (message: string) => void | Promise<void>;
  allowReset?: boolean;
  levers?: boolean;
  /** Called with the status being set, before the write (for optimistic feedback). */
  onPending?: (status: AckStatus | null) => void;
}) {
  const { store, me } = useApp<Schema>();
  const [objecting, setObjecting] = useState(false);
  const act = useAction(async (status: AckStatus) => {
    onPending?.(status);
    try {
      await setAckStatus(store, me, ack.id, status);
    } catch (e) {
      onPending?.(null);
      throw e;
    }
    const verb = { acknowledged: 'Acknowledged', objected: 'Objection recorded', migrated: 'Marked migrated', pending: 'Reset to pending' }[status];
    await onChanged(`${verb} for ${ack.teamName}.`);
  });
  const forTeam = <span className="sr-only"> for {ack.teamName}</span>;
  const size = levers ? 'md' : 'sm';
  return (
    <div>
      <div className={cx('flex flex-wrap gap-2', levers && 'grid grid-cols-3 sm:flex [&>button]:min-h-11 sm:[&>button]:min-h-8')}>
        {ack.status !== 'acknowledged' && (
          <Button size={size} variant="primary" icon={<Check />} busy={act.pending} onClick={() => void act.run('acknowledged')}>
            Acknowledge{forTeam}
          </Button>
        )}
        {ack.status !== 'objected' && (
          <Button size={size} icon={<Hand />} disabled={act.pending} onClick={() => setObjecting(true)}>
            Object{forTeam}
          </Button>
        )}
        {ack.status !== 'migrated' && (
          <Button size={size} icon={<ArrowRightLeft />} disabled={act.pending} onClick={() => void act.run('migrated')}>
            Migrated{forTeam}
          </Button>
        )}
        {allowReset && ack.status !== 'pending' && (
          <Button size={size} variant="ghost" icon={<RotateCcw />} disabled={act.pending} onClick={() => void act.run('pending')}>
            Reset{forTeam}
          </Button>
        )}
      </div>
      <InlineError error={act.error} />
      <ConfirmDialog
        open={objecting}
        onClose={() => setObjecting(false)}
        title={`Object on behalf of ${ack.teamName}`}
        body={
          <p className="m-0 text-sm text-muted">
            The service is <strong className="text-fg">held at the signal</strong> (blocked) until the producer resolves it. Say what breaks and what you
            need.
          </p>
        }
        noteLabel="Objection note"
        noteRequired
        noteMax={limits.ackNote.max}
        confirmLabel="Record objection"
        danger
        onConfirm={async (note) => {
          onPending?.('objected');
          try {
            await setAckStatus(store, me, ack.id, 'objected', note);
          } catch (e) {
            onPending?.(null);
            throw e;
          }
          await onChanged(`Objection recorded for ${ack.teamName}.`);
        }}
      />
    </div>
  );
}
