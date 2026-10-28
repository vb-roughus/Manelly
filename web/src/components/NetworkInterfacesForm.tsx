import { Fragment, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { AgentNetworkInterface, AgentNetworkList, NetworkRole } from '@manelly/shared';
import { LoaderCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useNetworkInterfaces, useSaveNetworkInterfaces } from '../hooks/queries';
import { formatBitrate } from '../lib/format';
import { NETWORK_ROLES } from '../lib/networkRoles';
import { Code, Message } from './ConnectionForm';

/** Picks the network interfaces of the Jellyfin server that the dashboard shows, and what each is for. */
export function NetworkInterfacesForm() {
  const agent = useAgent({ refreshTools: true });
  const status = agent.data?.status;
  const supported = Boolean(status?.network);
  const list = useNetworkInterfaces(supported);
  // Up here, so the confirmation survives the fresh list after saving.
  const save = useSaveNetworkInterfaces();

  if (!status) {
    return (
      <p className="text-sm text-ink-2">
        Zuerst den Agent unter{' '}
        <Link to="/server/agent" className="font-medium text-accent hover:underline">
          Server → Agent
        </Link>{' '}
        verbinden.
      </p>
    );
  }
  if (!supported) {
    return (
      <Message tone="critical">
        Der Agent auf {status.hostname} ist zu alt dafür (Version {status.version}). Auf dem Jellyfin-Server <Code>git pull</Code> und{' '}
        <Code>scripts\start-agent.cmd -Install</Code> ausführen.
      </Message>
    );
  }
  if (list.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Der Agent sucht die Netzwerkschnittstellen …
      </p>
    );
  }
  if (!list.data) return <Message tone="critical">{list.error?.message ?? 'Die Netzwerkschnittstellen liessen sich nicht laden.'}</Message>;
  return <InterfaceChoice key={`${list.data.selected.join()}|${JSON.stringify(list.data.roles ?? null)}`} list={list.data} save={save} />;
}

const sameRoles = (a: NetworkRole[] = [], b: NetworkRole[] = []) => a.length === b.length && a.every((role) => b.includes(role));

const TYPE_LABELS: Record<string, string> = { Ethernet: 'Kabel', Wireless80211: 'WLAN', Virtual: 'Virtuell' };

function InterfaceChoice({ list, save }: { list: AgentNetworkList; save: ReturnType<typeof useSaveNetworkInterfaces> }) {
  const [selected, setSelected] = useState(() => new Set(list.selected));
  const [roles, setRoles] = useState<Record<string, NetworkRole[]>>(() => list.roles ?? {});
  // Agents before 0.19.0 know no roles.
  const withRoles = list.roles !== undefined;
  const changed =
    selected.size !== list.selected.length ||
    list.selected.some((id) => !selected.has(id)) ||
    (withRoles && [...selected].some((id) => !sameRoles(roles[id], list.roles?.[id])));
  // Connected interfaces first, the rest keeps the order of the system.
  const interfaces = [...list.interfaces].sort((a, b) => Number(b.up) - Number(a.up));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleRole(id: string, role: NetworkRole) {
    setRoles((current) => {
      const had = current[id] ?? [];
      return { ...current, [id]: had.includes(role) ? had.filter((entry) => entry !== role) : [...had, role] };
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const interfaces = [...selected];
    save.mutate({ interfaces, roles: withRoles ? Object.fromEntries(interfaces.map((id) => [id, roles[id] ?? []])) : undefined });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {interfaces.length === 0 ? (
        <p className="text-sm text-ink-2">Der Agent hat keine Netzwerkschnittstellen gefunden.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
          {interfaces.map((nic) => (
            <li key={nic.id} className={clsx(selected.has(nic.id) && 'bg-accent/6')}>
              <InterfaceRow nic={nic} checked={selected.has(nic.id)} onToggle={() => toggle(nic.id)} />
              {withRoles && selected.has(nic.id) && <RoleChoice name={nic.name} roles={roles[nic.id] ?? []} onToggle={(role) => toggleRole(nic.id, role)} />}
            </li>
          ))}
        </ul>
      )}
      {withRoles ? (
        <div className="text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {NETWORK_ROLES.map(({ role, label, hint }) => (
              <Fragment key={role}>
                <dt className="font-medium text-ink-2">{label}</dt>
                <dd className="text-ink-3">{hint}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="mt-2 text-ink-3">Hat der Server nicht für alles eine eigene Schnittstelle, bekommt eine Schnittstelle mehrere Rollen.</p>
        </div>
      ) : (
        selected.size > 0 && (
          <p className="text-xs text-ink-3">
            Rollen (Streaming, Management, Storage) gibt es ab Agent 0.19.0 – unter{' '}
            <Link to="/server/agent" className="font-medium text-accent hover:underline">
              Server → Agent
            </Link>{' '}
            «Aktualisieren & neu starten».
          </p>
        )
      )}
      {save.isError && <Message tone="critical">{save.error.message}</Message>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!changed || save.isPending}
          className="bg-brand inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Auswahl speichern
        </button>
        {save.isSuccess && !changed && <span className="text-xs text-good">Gespeichert.</span>}
      </div>
    </form>
  );
}

function InterfaceRow({ nic, checked, onToggle }: { nic: AgentNetworkInterface; checked: boolean; onToggle: () => void }) {
  const details = [TYPE_LABELS[nic.type ?? ''] ?? nic.type, nic.speedBps ? formatBitrate(nic.speedBps) : null, ...nic.addresses.slice(0, 2)].filter(Boolean);
  return (
    <label className="flex cursor-pointer gap-3 px-3 py-2.5 transition hover:bg-card-2">
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 size-4 shrink-0 accent-accent" />
      <span className="min-w-0 text-sm">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{nic.name}</span>
          <span className={clsx('text-xs', nic.up ? 'text-good' : 'text-ink-3')}>{nic.up ? 'verbunden' : 'getrennt'}</span>
        </span>
        {nic.description && nic.description !== nic.name && <span className="block truncate text-xs text-ink-2">{nic.description}</span>}
        {details.length > 0 && <span className="block truncate text-xs text-ink-3">{details.join(' · ')}</span>}
      </span>
    </label>
  );
}

function RoleChoice({ name, roles, onToggle }: { name: string; roles: NetworkRole[]; onToggle: (role: NetworkRole) => void }) {
  return (
    <div role="group" aria-label={`Rollen von ${name}`} className="flex flex-wrap items-center gap-1.5 pr-3 pb-2.5 pl-10">
      {NETWORK_ROLES.map(({ role, label, hint }) => {
        const on = roles.includes(role);
        return (
          <label
            key={role}
            title={hint}
            className={clsx(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 transition',
              on ? 'bg-accent/15 font-medium text-ink ring-accent/50' : 'text-ink-2 ring-line hover:bg-card-2',
            )}
          >
            <input type="checkbox" checked={on} onChange={() => onToggle(role)} className="size-3.5 accent-accent" />
            {label}
          </label>
        );
      })}
    </div>
  );
}
