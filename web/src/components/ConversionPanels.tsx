import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AgentOverview } from '@manelly/shared';
import clsx from 'clsx';

export function Panel({ tone, children }: { tone?: 'critical'; children: ReactNode }) {
  return (
    <div className={clsx('rounded-2xl border p-4 text-sm', tone === 'critical' ? 'border-critical/30 bg-critical/8' : 'border-line bg-card')}>
      {children}
    </div>
  );
}

/** The heading of a page under «Umwandlungen». */
export function ConversionsHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header>
      <p className="text-sm font-medium text-accent">Umwandlungen</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-ink-2">{children}</p>
    </header>
  );
}

/** What the conversion pages show while the agent is loading, not set up or out of reach. */
export function AgentNotices({ agent }: { agent: UseQueryResult<AgentOverview> }) {
  return (
    <>
      {agent.isPending && <div aria-busy className="h-24 animate-pulse rounded-2xl bg-card-2" />}
      {agent.data && !agent.data.configured && (
        <Panel>
          <p className="font-medium">Noch kein Agent eingerichtet</p>
          <p className="mt-1 text-sm text-ink-2">
            Installiere den Agent auf dem Jellyfin-Server mit <code>scripts\start-agent.cmd</code> und trage Adresse und Schlüssel unter{' '}
            <Link to="/server/agent" className="font-medium text-accent hover:underline">
              Server → Agent
            </Link>{' '}
            ein.
          </p>
        </Panel>
      )}
      {agent.data?.error && <Panel tone="critical">{agent.data.error}</Panel>}
    </>
  );
}

