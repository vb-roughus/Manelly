import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolName } from './tools.js';

export interface AgentConfig {
  port: number;
  host: string;
  /** Manelly sends it as Bearer token; generated on first start. */
  token: string;
  /** Folders the agent may read from and write to; empty means any folder Manelly names. */
  roots: string[];
  /** Tool paths, for tools that are not found automatically. */
  tools: Partial<Record<ToolName, string>>;
}

const DEFAULT_PORT = 8790;
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));
const CONFIG_FILE = 'agent.json';

export function dataDirFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_DATA_DIR || DEFAULT_DATA_DIR;
}

/** Reads agent.json from the data folder and creates it (with a new token) on first start. */
export async function loadConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): Promise<{ config: AgentConfig; path: string; created: boolean }> {
  const path = join(dataDir, CONFIG_FILE);
  let stored: Partial<AgentConfig> = {};
  let created = false;
  try {
    // Notepad may save the file with a byte order mark.
    stored = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as Partial<AgentConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`${path} ist kein gültiges JSON: ${(error as Error).message}`);
    }
    created = true;
  }

  const config: AgentConfig = {
    port: typeof stored.port === 'number' ? stored.port : DEFAULT_PORT,
    host: typeof stored.host === 'string' ? stored.host : '0.0.0.0',
    token: typeof stored.token === 'string' && stored.token.length >= 16 ? stored.token : randomBytes(24).toString('base64url'),
    roots: Array.isArray(stored.roots) ? stored.roots.filter((root): root is string => typeof root === 'string' && root.length > 0) : [],
    tools: stored.tools && typeof stored.tools === 'object' ? stored.tools : {},
  };
  if (created || config.token !== stored.token) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  }

  // The environment wins over the file, e.g. for a one-off start on another port.
  const port = Number(env.AGENT_PORT);
  if (Number.isInteger(port) && port > 0 && port < 65536) config.port = port;
  return { config, path, created };
}
