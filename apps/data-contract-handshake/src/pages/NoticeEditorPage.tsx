/**
 * Timetable a service: announce a change (new draft) or edit a draft. A live preview shows the row as it will appear
 * on the departures board, and where the departure lands against today and the final-call window.
 */
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';

import { NotFoundError } from '@x10/shared/data';
import { useApp } from '@x10/shared/runtime';
import { describeError, hasErrors, useAsync, type Errors } from '@x10/shared/lib';
import { Breadcrumb, Button, Callout, DataState, EmptyState, Field, InlineError, Input, LinkButton, PageHeader, Skeleton, TextArea, cx } from '@x10/shared/ui';

import { lineStyleFor, type LineStyle } from '../components/transit';
import { rules } from '../config';
import { daysLabel, daysUntil, fromDayInput, localToday, toDayInput } from '../domain/days';
import { changeTypeMeta } from '../domain/health';
import { createNotice, updateNotice, validateNotice, type NoticeInput } from '../domain/notices';
import { CHANGE_TYPES, limits, type ChangeNotice, type ChangeType, type Contract, type Schema } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';
import { countdown, dayFlap, typeColor, typeShort } from '../metro/meta';
import { SplitFlap } from '../metro/SplitFlap';

/** New notice: /contracts/:contractId/notices/new. Edit a draft: /notices/:noticeId/edit. */
export function NoticeEditorPage() {
  const { contractId, noticeId } = useParams();
  const { store } = useApp<Schema>();
  const state = useAsync(async () => {
    let notice: ChangeNotice | null = null;
    if (noticeId) {
      notice = await store.repo('ChangeNotice').get(noticeId);
      if (!notice) throw new NotFoundError('ChangeNotice', noticeId);
    }
    const cid = notice?.contractId ?? contractId ?? '';
    const contract = await store.repo('Contract').get(cid);
    if (!contract) throw new NotFoundError('Contract', cid);
    const [consumers, contracts] = await Promise.all([store.repo('Consumer').list({ where: { contractId: cid } }), store.repo('Contract').list()]);
    return { notice, contract, consumerCount: consumers.length, style: lineStyleFor(contracts, cid) };
  }, [store, contractId, noticeId]);

  return (
    <DataState
      state={state}
      skeleton={
        <div className="flex flex-col gap-4">
          <Skeleton width={260} height={28} />
          <Skeleton height={420} />
        </div>
      }
    >
      {(d) => <Editor contract={d.contract} notice={d.notice} consumerCount={d.consumerCount} style={d.style} />}
    </DataState>
  );
}

function Editor({ contract, notice, consumerCount, style }: { contract: Contract; notice: ChangeNotice | null; consumerCount: number; style: LineStyle }) {
  const { store, me } = useApp<Schema>();
  const navigate = useNavigate();
  const id = useId();
  const [v, setV] = useState<NoticeInput>({ title: '', changeType: '', description: '', effectiveDay: '' });
  const [errors, setErrors] = useState<Errors<NoticeInput>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (notice) {
      setV({ title: notice.title, changeType: notice.changeType, description: notice.description, effectiveDay: toDayInput(notice.effectiveDate) });
    }
  }, [notice]);

  const owner = contract.ownerSub === me.sub;
  const back = notice ? `/notices/${notice.id}` : `/contracts/${contract.id}`;

  if (!owner) {
    return (
      <EmptyState
        icon={<Lock />}
        title="Only the line's owner can timetable a change"
        action={<LinkButton to={back}>Back</LinkButton>}
      >
        {contract.ownerName} owns {contract.name}. Ask them to raise the notice, or object on an existing one from your signal box.
      </EmptyState>
    );
  }
  if (notice && notice.status !== 'draft') {
    return (
      <EmptyState icon={<Lock />} title="This service has already been published" action={<LinkButton to={back}>Back to the service</LinkButton>}>
        Published notices are a promise to consumers and cannot be edited. Close it and announce a new one instead.
      </EmptyState>
    );
  }

  const set = (k: keyof NoticeInput) => (e: { target: { value: string } }) => {
    setV((p) => ({ ...p, [k]: e.target.value }));
    if (errors[k]) setErrors((p) => ({ ...p, [k]: undefined }));
  };
  const day = fromDayInput(v.effectiveDay);
  const daysLeft = day ? daysUntil(day, localToday()) : null;

  const save = async () => {
    const e = validateNotice(v);
    setErrors(e);
    if (hasErrors(e)) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = notice ? await updateNotice(store, me, notice.id, v) : await createNotice(store, me, contract.id, v);
      navigate(`/notices/${saved.id}`);
    } catch (err) {
      setFailure(describeError(err).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <Breadcrumb
            items={[
              { label: 'Timetable', to: '/timetable' },
              { label: contract.name, to: `/contracts/${contract.id}` },
              { label: notice ? 'Edit draft' : 'New service' },
            ]}
          />
        }
        title={notice ? 'Edit draft notice' : 'Announce a change'}
        meta={
          <span className="inline-flex items-center gap-2">
            <LineBullet line={style} size={18} />
            {contract.name} · saved as a draft; publishing signals {consumerCount === 1 ? 'the 1 station' : `all ${consumerCount} stations`}
          </span>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form
          noValidate
          className="min-w-0 max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title" htmlFor={`${id}-title`} required error={errors.title} counter={{ value: v.title.length, max: limits.noticeTitle.max }}>
            <Input id={`${id}-title`} value={v.title} onChange={set('title')} invalid={!!errors.title} placeholder="Rename order_total to gross_amount" />
          </Field>

          <fieldset className="m-0 mb-4 border-0 p-0" aria-describedby={errors.changeType ? `${id}-type-error` : undefined}>
            <legend className="mb-1.5 text-ui font-medium">
              Change type <span className="text-bad-text" aria-hidden="true">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Change type">
              {CHANGE_TYPES.map((t) => {
                const on = v.changeType === t;
                return (
                  <label
                    key={t}
                    className={cx(
                      'relative flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-[border-color,background-color,box-shadow] duration-[120ms]',
                      on ? 'border-accent-8 bg-accent-2 shadow-[0_0_0_1px_var(--accent-8)]' : 'border-line-strong bg-surface hover:border-gray-8',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-type`}
                      value={t}
                      checked={on}
                      aria-label={changeTypeMeta[t].label}
                      aria-describedby={`${id}-type-${t}`}
                      onChange={() => {
                        setV((p) => ({ ...p, changeType: t }));
                        if (errors.changeType) setErrors((p) => ({ ...p, changeType: undefined }));
                      }}
                      className="sr-only"
                    />
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="h-1.5 w-4 rounded-full" style={{ background: typeColor[t] }} aria-hidden="true" />
                      {changeTypeMeta[t].label}
                    </span>
                    <span id={`${id}-type-${t}`} className="text-xs leading-4 text-muted">
                      {changeTypeMeta[t].help}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.changeType && (
              <p id={`${id}-type-error`} className="m-0 mt-1.5 text-ui font-medium text-bad-text">
                {errors.changeType}
              </p>
            )}
          </fieldset>

          <Field
            label="Description"
            htmlFor={`${id}-desc`}
            required
            error={errors.description}
            hint="What changes, why, and what consumers need to do."
            counter={{ value: v.description.length, max: limits.noticeDescription.max }}
          >
            <TextArea id={`${id}-desc`} value={v.description} onChange={set('description')} invalid={!!errors.description} rows={6} />
          </Field>
          <Field
            label="Effective date"
            htmlFor={`${id}-date`}
            required
            error={errors.effectiveDay}
            hint={daysLeft === null ? 'The day the change lands in the data: the departure.' : `Departs ${daysLabel(daysLeft)}.`}
          >
            <Input id={`${id}-date`} type="date" value={v.effectiveDay} onChange={set('effectiveDay')} invalid={!!errors.effectiveDay} className="max-w-xs" />
          </Field>
          <div className="flex flex-col gap-3">
            {daysLeft !== null && daysLeft < 0 && (
              <Callout tone="warn" title="This date is in the past">
                You can save the draft, but it cannot be published until the date is today or later.
              </Callout>
            )}
            {consumerCount === 0 && (
              <Callout tone="warn" title="No stations on this line">
                Publishing will work, but nobody will be asked to acknowledge this change.
              </Callout>
            )}
          </div>
          <div className="sticky z-20 -mx-4 mt-6 flex gap-2 border-t border-line bg-[color-mix(in_oklab,var(--bg)_90%,transparent)] px-4 py-3 backdrop-blur-md md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none" style={{ bottom: 'var(--x-bottom-inset)' }}>
            <Button type="submit" variant="primary" busy={busy} className="flex-1 md:flex-none">
              Save draft
            </Button>
            <Button onClick={() => navigate(back)}>Cancel</Button>
          </div>
          <InlineError error={failure} />
        </form>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:self-start" aria-label="Preview">
          <div className="x-legend-label text-muted">On the board</div>
          <div className="dch-board rounded-xl px-4 py-3.5 shadow-1">
            <div className="flex items-center justify-between gap-3">
              <SplitFlap text={day ? dayFlap(day) : '-- ---'} className="text-[15px]" color="var(--board-amber)" />
              <span className="font-mono text-[11px] text-[var(--board-muted)]">{daysLeft === null ? 'T-?' : countdown(daysLeft)}</span>
              <SplitFlap text={v.changeType ? typeShort[v.changeType as ChangeType] : '---'} className="text-[15px]" />
            </div>
            <div className="mt-2.5">
              <SplitFlap text={v.title || 'Your service title'} length={22} className="text-[15px]" />
            </div>
            <div className="mt-2.5 flex items-center gap-2 text-[12px] text-[var(--board-muted)]">
              <LineBullet line={style} size={16} />
              <span className="truncate">{contract.name}</span>
              <span className="ml-auto inline-flex gap-1" aria-label={`${consumerCount} pending signals once published`}>
                {Array.from({ length: Math.min(consumerCount, 8) }, (_, i) => (
                  <span key={i} className="dch-lamp" style={{ ['--lamp' as string]: 'var(--warn-solid)', width: 7, height: 7 }} />
                ))}
              </span>
            </div>
          </div>
          <DepartureRuler daysLeft={daysLeft} type={(v.changeType || null) as ChangeType | null} />
          <p className="m-0 text-xs text-muted">
            Back to <Link to={back}>{notice ? 'the service' : contract.name}</Link>
          </p>
        </aside>
      </div>
    </>
  );
}

/** Where the departure lands: today, the final-call window for at-risk change types, and the chosen date. */
function DepartureRuler({ daysLeft, type }: { daysLeft: number | null; type: ChangeType | null }) {
  const span = Math.max(35, (daysLeft ?? 0) + 7);
  const pos = (d: number) => `${Math.max(0, Math.min(100, (d / span) * 100))}%`;
  const atRisk = type ? (rules.atRiskTypes as readonly ChangeType[]).includes(type) : false;
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="x-legend-label mb-3 text-muted">Where it lands</div>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-[18px] h-[3px] rounded-full bg-gray-4" />
        {daysLeft !== null && daysLeft >= 0 && atRisk && (
          <div
            className="absolute top-[14px] h-[11px] rounded-[3px] bg-warn-soft ring-1 ring-inset ring-[var(--warn-line)]"
            style={{ left: pos(Math.max(0, daysLeft - rules.atRiskDays)), width: `calc(${pos(daysLeft)} - ${pos(Math.max(0, daysLeft - rules.atRiskDays))})` }}
            title="Final call window"
          />
        )}
        <div className="absolute top-[10px] h-[19px] w-[2px] rounded bg-gray-11" style={{ left: 0 }} />
        <span className="absolute top-[30px] text-[11px] text-muted" style={{ left: 0 }}>
          Today
        </span>
        {daysLeft !== null && (
          <>
            <div
              className="absolute top-[8px] grid size-[23px] -translate-x-1/2 place-items-center rounded-full ring-3 ring-[var(--surface)]"
              style={{ left: pos(Math.max(0, daysLeft)), background: daysLeft < 0 ? 'var(--bad-solid)' : 'var(--accent-9)' }}
            >
              <span className="size-[7px] rounded-full bg-[var(--surface)]" />
            </div>
            <span className="absolute top-[30px] -translate-x-1/2 whitespace-nowrap font-mono text-[11px] num" style={{ left: pos(Math.max(0, daysLeft)) }}>
              {countdown(daysLeft)}
            </span>
          </>
        )}
      </div>
      <p className="m-0 mt-3 text-xs text-muted">
        {daysLeft === null
          ? 'Pick a date to see it on the line.'
          : atRisk
            ? `A ${type} change gets a final call ${rules.atRiskDays} days before it departs while any signal is pending.`
            : type
              ? `${changeTypeMeta[type].label} changes never get a final call; they wait until the date.`
              : 'Choose a change type to see whether it gets a final call.'}
      </p>
    </div>
  );
}
