import { useEffect, useId, useState } from 'react';

import type { Person } from '@x10/shared/identity';
import { useApp } from '@x10/shared/runtime';
import { describeError, hasErrors, type Errors } from '@x10/shared/lib';
import { Button, Dialog, Field, InlineError, Input, Select, TextArea } from '@x10/shared/ui';

import {
  addConsumer,
  createContract,
  updateContract,
  validateConsumer,
  validateContract,
  type ConsumerInput,
  type ContractInput,
} from '../domain/contracts';
import { limits, type Contract, type Schema } from '../model';

const emptyContract: ContractInput = { name: '', sourceRef: '', producerTeam: '', description: '' };

/** Register a new contract, or edit an existing one (owner only). */
export function ContractDialog({
  open,
  onClose,
  existing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  existing?: Contract;
  onSaved: (c: Contract) => void | Promise<void>;
}) {
  const { store, me } = useApp<Schema>();
  const [v, setV] = useState<ContractInput>(emptyContract);
  const [errors, setErrors] = useState<Errors<ContractInput>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setV(
      existing
        ? { name: existing.name, sourceRef: existing.sourceRef, producerTeam: existing.producerTeam, description: existing.description ?? '' }
        : emptyContract,
    );
    setErrors({});
    setFailure(null);
  }, [open, existing]);

  const set = (k: keyof ContractInput) => (e: { target: { value: string } }) => {
    setV((p) => ({ ...p, [k]: e.target.value }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const save = async () => {
    const e = validateContract(v);
    setErrors(e);
    if (hasErrors(e)) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = existing ? await updateContract(store, me, existing.id, v) : await createContract(store, me, v);
      await onSaved(saved);
      onClose();
    } catch (err) {
      setFailure(describeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Edit contract' : 'Register a contract'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {existing ? 'Save changes' : 'Register contract'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <Field label="Name" htmlFor={`${id}-name`} required error={errors.name} counter={{ value: v.name.length, max: limits.contractName.max }}>
          <Input id={`${id}-name`} value={v.name} onChange={set('name')} invalid={!!errors.name} placeholder="Orders fact table" />
        </Field>
        <Field
          label="Source"
          htmlFor={`${id}-source`}
          required
          error={errors.sourceRef}
          hint="Where the data lives, such as lakehouse.sales.orders."
          counter={{ value: v.sourceRef.length, max: limits.sourceRef.max }}
        >
          <Input id={`${id}-source`} value={v.sourceRef} onChange={set('sourceRef')} invalid={!!errors.sourceRef} className="font-mono" />
        </Field>
        <Field label="Producer team" htmlFor={`${id}-team`} required error={errors.producerTeam} counter={{ value: v.producerTeam.length, max: limits.producerTeam.max }}>
          <Input id={`${id}-team`} value={v.producerTeam} onChange={set('producerTeam')} invalid={!!errors.producerTeam} />
        </Field>
        <Field
          label="Description"
          htmlFor={`${id}-desc`}
          error={errors.description}
          hint="Optional. Grain, refresh schedule, anything consumers should know."
          counter={{ value: v.description.length, max: limits.contractDescription.max }}
        >
          <TextArea id={`${id}-desc`} value={v.description} onChange={set('description')} invalid={!!errors.description} rows={3} />
        </Field>
        {!existing && <p className="m-0 text-xs text-muted">You become the owner: only you can edit it, manage its consumers and publish its notices.</p>}
        <button type="submit" hidden />
        <InlineError error={failure} />
      </form>
    </Dialog>
  );
}

const emptyConsumer: ConsumerInput = { teamName: '', contactName: '', contactSub: '' };

/** Register a consumer team on a contract (owner only). */
export function ConsumerDialog({
  open,
  onClose,
  contract,
  people,
  knownTeams,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  contract: Contract;
  people: Person[];
  knownTeams: string[];
  onSaved: (message: string) => void | Promise<void>;
}) {
  const { store, me } = useApp<Schema>();
  const [v, setV] = useState<ConsumerInput>(emptyConsumer);
  const [errors, setErrors] = useState<Errors<ConsumerInput>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setV(emptyConsumer);
    setErrors({});
    setFailure(null);
  }, [open]);

  const save = async () => {
    const e = validateConsumer(v);
    setErrors(e);
    if (hasErrors(e)) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await addConsumer(store, me, contract.id, v);
      await onSaved(
        r.acksCreated
          ? `${r.consumer.teamName} added. ${r.acksCreated} pending ${r.acksCreated === 1 ? 'ack' : 'acks'} created for open notices.`
          : `${r.consumer.teamName} added.`,
      );
      onClose();
    } catch (err) {
      setFailure(describeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a consumer team"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Add consumer
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <Field label="Team name" htmlFor={`${id}-team`} required error={errors.teamName} counter={{ value: v.teamName.length, max: limits.teamName.max }}>
          <Input
            id={`${id}-team`}
            list={`${id}-teams`}
            value={v.teamName}
            invalid={!!errors.teamName}
            onChange={(e) => setV((p) => ({ ...p, teamName: e.target.value }))}
          />
          <datalist id={`${id}-teams`}>
            {knownTeams.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Contact person"
          htmlFor={`${id}-person`}
          hint="Optional. Link someone who signs in to this app; they can answer this contract's notices for the team. Team membership itself is managed by admins."
        >
          <Select
            id={`${id}-person`}
            value={v.contactSub}
            onChange={(e) => {
              const sub = e.target.value;
              const p = people.find((x) => x.sub === sub);
              setV((prev) => ({ ...prev, contactSub: sub, contactName: p ? p.displayName : prev.contactName }));
            }}
          >
            <option value="">No linked person</option>
            {people.map((p) => (
              <option key={p.sub} value={p.sub}>
                {p.displayName}
                {p.email ? ` (${p.email})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contact name" htmlFor={`${id}-contact`} required error={errors.contactName} counter={{ value: v.contactName.length, max: limits.contactName.max }}>
          <Input
            id={`${id}-contact`}
            value={v.contactName}
            invalid={!!errors.contactName}
            onChange={(e) => setV((p) => ({ ...p, contactName: e.target.value }))}
          />
        </Field>
        <p className="m-0 text-xs text-muted">Open published notices on this contract get a pending ack for the new team straight away.</p>
        <button type="submit" hidden />
        <InlineError error={failure} />
      </form>
    </Dialog>
  );
}
