import type { AgentStatus } from '@manelly/shared';
import { createRestartStore, useRestartState } from './restartStore';

/** The agent's restart; while it runs, the agent's queries hold still, so no page shows errors of the absent agent. */
export const agentRestart = createRestartStore<AgentStatus>('manelly.agent.restart');

export const useAgentRestart = () => useRestartState(agentRestart);
