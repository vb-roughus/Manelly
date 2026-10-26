import type { FastifyInstance } from 'fastify';
import type { HardwareTestResult, TranscodingReport } from '@manelly/shared';
import type { AgentConnection } from '../agent/connection.js';
import { requireAgent } from '../agent/conversions.js';
import type { JellyfinConnection } from '../connection.js';
import { AppError, requireClient } from '../errors.js';
import type { TranscodeLogReader } from '../transcodeLog.js';
import { hardwareTestRequest, transcodingReport } from '../transcodingReport.js';

export async function serverRoutes(app: FastifyInstance, opts: { connection: JellyfinConnection; agent: AgentConnection; logs: TranscodeLogReader }) {
  const { connection, agent, logs } = opts;

  app.get('/transcoding', async (): Promise<TranscodingReport> => transcodingReport(requireClient(connection.client), logs));

  // Runs FFmpeg on the Jellyfin server through the agent, with the hardware Jellyfin is set up for.
  app.post('/transcoding/test', async (): Promise<HardwareTestResult> => {
    const client = requireClient(connection.client);
    const agentClient = requireAgent(agent);
    let request;
    try {
      request = await hardwareTestRequest(client);
    } catch (error) {
      throw new AppError('BAD_REQUEST', (error as Error).message);
    }
    return agentClient.testHardware(request);
  });
}
