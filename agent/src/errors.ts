/** An error the agent reports to Manelly with an HTTP status and a German message. */
export class AgentError extends Error {
  override name = 'AgentError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
