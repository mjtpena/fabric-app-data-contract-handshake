/**
 * Line status: every contract as a line, with its producer, stations, running services and status (worst health of
 * its open services), worst first. Register a contract to open a new line.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Route } from 'lucide-react';

import { useApp } from '@x10/shared/runtime';
import { normKey, plural, useAsync } from '@x10/shared/lib';
import { Button, DataState, EmptyState, FilterSelect, PageHeader, SearchInput, Skeleton, Toolbar } from '@x10/shared/ui';

import { LineStatusLabel, lineStyleFor } from '../components/transit';
import { ContractDialog } from '../components/forms';
import { loadSnapshot, buildRegistry, type RegistryRow } from '../domain/contracts';
import { localToday } from '../domain/days';
import type { Contract, Schema } from '../model';
import { LineBullet } from '../metro/DeparturesBoard';

type Filter = 'all' | 'attention' | 'mine';

export function RegistryPage() {
  const { store, me } = useApp<Schema>();
  const navigate = useNavigate();
  const rows = useAsync(async () => {
    const s = await loadSnapshot(store);
    return { rows: buildRegistry(s, localToday()), contracts: s.contracts, stations: new Set(s.consumers.map((c) => normKey(c.teamName))).size };
  }, [store]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const shown = (list: RegistryRow[]) =>
    list.filter((r) => {
      const k = normKey(q);
      if (k && !normKey(`${r.contract.name} ${r.contract.sourceRef} ${r.contract.producerTeam} ${r.contract.ownerName}`).includes(k)) return false;
      if (filter === 'attention') return r.worst === 'blocked' || r.worst === 'overdue' || r.worst === 'at_risk';
      if (filter === 'mine') return r.contract.ownerSub === me.sub;
      return true;
    });

  const filterOptions = useMemo(
    () => [
      { value: 'all' as const, label: 'All lines' },
      { value: 'attention' as const, label: 'Disrupted' },
      { value: 'mine' as const, label: 'My lines' },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Line status"
        meta={rows.data ? <span className="num">{plural(rows.data.rows.length, 'line')} · {plural(rows.data.stations, 'station')}</span> : undefined}
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
            Register contract
          </Button>
        }
      />
      <DataState
        state={rows}
        isEmpty={(d) => d.rows.length === 0}
        skeleton={
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={64} />
            ))}
          </div>
        }
        empty={
          <EmptyState
            icon={<Route />}
            title="No lines yet"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Register the first contract
              </Button>
            }
          >
            A contract you register becomes a line; the teams that consume it become its stations.
          </EmptyState>
        }
      >
        {({ rows: list, contracts }) => {
          const visible = shown(list);
          return (
            <>
              <Toolbar>
                <SearchInput value={q} onChange={setQ} label="Search lines" placeholder="Search name, source, team or owner" shortcut="/" />
                <FilterSelect label="Show" value={filter} onChange={setFilter} options={filterOptions} />
              </Toolbar>
              {visible.length === 0 ? (
                <EmptyState title="No lines match" action={<Button onClick={() => { setQ(''); setFilter('all'); }}>Clear filters</Button>}>
                  Try another search or show all lines.
                </EmptyState>
              ) : (
                <ul className="m-0 list-none divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line bg-surface p-0" aria-label="Lines">
                  {visible.map((r) => (
                    <LineRow key={r.contract.id} r={r} contracts={contracts} mine={r.contract.ownerSub === me.sub} />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </DataState>
      <ContractDialog open={adding} onClose={() => setAdding(false)} onSaved={(c) => navigate(`/contracts/${c.id}`)} />
    </>
  );
}

function LineRow({ r, contracts, mine }: { r: RegistryRow; contracts: Contract[]; mine: boolean }) {
  const style = lineStyleFor(contracts, r.contract.id);
  return (
    <li
      className="group relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 py-3.5 pl-5 pr-4 transition-colors hover:bg-surface-2 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_120px_minmax(0,1.1fr)] md:items-center md:gap-x-5"
      data-testid="registry-row"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[5px]" style={{ background: style.color }} />
      <LineBullet line={style} size={30} className="row-span-2 md:row-span-1" />
      <div className="min-w-0">
        <Link to={`/contracts/${r.contract.id}`} className="font-semibold text-fg no-underline after:absolute after:inset-0 hover:underline">
          {r.contract.name}
        </Link>
        <div className="truncate font-mono text-xs text-muted">{r.contract.sourceRef}</div>
      </div>
      <div className="col-start-2 min-w-0 text-ui text-muted md:col-start-auto">
        <div className="truncate">{r.contract.producerTeam}</div>
        <div className="truncate">
          {r.contract.ownerName}
          {mine && ' (you)'}
        </div>
      </div>
      <div className="col-start-2 flex gap-4 text-ui md:col-start-auto md:flex-col md:gap-0">
        <span>
          <span className="font-mono num">{r.consumerCount}</span> <span className="text-muted">{r.consumerCount === 1 ? 'station' : 'stations'}</span>
        </span>
        <span>
          <span className="font-mono num">{r.openNotices}</span> <span className="text-muted">running</span>
          {r.draftNotices > 0 && <span className="text-muted"> · {r.draftNotices} in depot</span>}
        </span>
      </div>
      <div className="col-start-2 md:col-start-auto md:justify-self-end">
        <LineStatusLabel health={r.worst} />
      </div>
    </li>
  );
}
