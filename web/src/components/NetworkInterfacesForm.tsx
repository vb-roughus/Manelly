import { useState, type FormEvent } from 'react';
import type { AgentNetworkInterface, AgentNetworkList } from '@manelly/shared';
import { LoaderCircle } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useNetworkInterfaces, useSaveNetworkInterfaces } from '../hooks/queries';
import { formatBitrate } from '../lib/format';
import { Code, Message } from './ConnectionForm';

/** Picks the network interfaces of the Jellyfin server that the dashboard shows. */
export function NetworkInterfacesForm() {
  const agent = useAgent({ refreshTools: true });
  const status = agent.data?.status;
  const supported = Boolean(status?.network);
  const list = useNetworkInterfaces(supported);
  // Up here, so the confirmation survives the fresh list after saving.
  const save = useSaveNetworkInterfaces();

  if (!status) return <p className="text-sm text-ink-2">Zuerst den Agent oben verbinden.</p>;
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
  return <InterfaceChoice key={list.data.selected.join()} list={list.data} save={save} />;
}

const TYPE_LABELS: Record<string, string> = { Ethernet: 'Kabel', Wireless80211: 'WLAN', Virtual: 'Virtuell' };

function InterfaceChoice({ list, save }: { list: AgentNetworkList; save: ReturnType<typeof useSaveNetworkInterfaces> }) {
  const [selected, setSelected] = useState(() => new Set(list.selected));
  const changed = selected.size !== list.selected.length || list.selected.some((id) => !selected.has(id));
  // Connected interfaces first, the rest keeps the order of the system.
  const interfaces = [...list.interfaces].sort((a, b) => Number(b.up) - Number(a.up));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate([...selected]);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {interfaces.length === 0 ? (
        <p className="text-sm text-ink-2">Der Agent hat keine Netzwerkschnittstellen gefunden.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
          {interfaces.map((nic) => (
            <li key={nic.id}>
              <InterfaceRow nic={nic} checked={selected.has(nic.id)} onToggle={() => toggle(nic.id)} />
            </li>
          ))}
        </ul>
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
    <label className={clsx('flex cursor-pointer gap-3 px-3 py-2.5 transition hover:bg-card-2', checked && 'bg-accent/6')}>
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
