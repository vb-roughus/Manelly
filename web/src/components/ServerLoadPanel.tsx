import { Link } from 'react-router';
import { Gauge } from 'lucide-react';
import { useAgentResources } from '../hooks/queries';
import { ResourceUsage } from './ResourceUsage';

/** Behind the transcodes tile: CPU and GPU of the Jellyfin server and the share of its FFmpeg. Asks the agent only while open. */
export function ServerLoadPanel({ id, agentConfigured }: { id: string; agentConfigured: boolean }) {
  const resources = useAgentResources(agentConfigured);
  return (
    <div id={id} className="mt-3 rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5 sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <Gauge className="size-4 text-accent" aria-hidden />
        Auslastung des Servers
      </h3>
      {agentConfigured ? (
        <ResourceUsage data={resources.data} error={resources.error} focus="jellyfin" />
      ) : (
        <p className="text-sm text-ink-2">
          Mit dem Manelly-Agent auf dem Jellyfin-Server siehst du hier, wie stark CPU und GPU ausgelastet sind und wie viel davon das
          Transcoding braucht:{' '}
          <Link to="/server/agent" className="font-medium text-accent hover:underline">
            Server → Agent
          </Link>
        </p>
      )}
    </div>
  );
}
