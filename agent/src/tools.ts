import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTool } from '@manelly/shared';

export type ToolName = 'ffmpeg' | 'ffprobe' | 'mkvmerge' | 'doviTool';
export type Tools = Record<ToolName, AgentTool>;

const EXECUTABLES: Record<ToolName, string> = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', mkvmerge: 'mkvmerge', doviTool: 'dovi_tool' };
const VERSION_ARGS: Record<ToolName, string> = { ffmpeg: '-version', ffprobe: '-version', mkvmerge: '--version', doviTool: '--version' };

export interface DiscoverOptions {
  /** Paths from agent.json; they win over everything else. */
  configured?: Partial<Record<ToolName, string>>;
  /** Folder of the agent, where the install script puts dovi_tool. */
  agentDir: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Where the tools usually are: Jellyfin ships its own ffmpeg, the install
 * script puts dovi_tool next to the agent. Only these fixed places and the
 * PATH are checked – the agent never searches drives.
 */
function knownLocations(name: ToolName, { agentDir, platform = process.platform, env = process.env }: DiscoverOptions): string[] {
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const locations: Record<ToolName, string[]> = {
      ffmpeg: [path.win32.join(programFiles, 'Jellyfin', 'Server', 'ffmpeg.exe')],
      ffprobe: [path.win32.join(programFiles, 'Jellyfin', 'Server', 'ffprobe.exe')],
      mkvmerge: [path.win32.join(programFiles, 'MKVToolNix', 'mkvmerge.exe')],
      doviTool: [path.win32.join(agentDir, 'tools', 'dovi_tool.exe')],
    };
    return locations[name];
  }
  const locations: Record<ToolName, string[]> = {
    ffmpeg: ['/usr/lib/jellyfin-ffmpeg/ffmpeg', '/Applications/Jellyfin.app/Contents/MacOS/ffmpeg'],
    ffprobe: ['/usr/lib/jellyfin-ffmpeg/ffprobe', '/Applications/Jellyfin.app/Contents/MacOS/ffprobe'],
    mkvmerge: [],
    doviTool: [path.posix.join(agentDir, 'tools', 'dovi_tool')],
  };
  return locations[name];
}

async function isExecutable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(name: ToolName, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<string | null> {
  const api = platform === 'win32' ? path.win32 : path.posix;
  const searchPath = env.PATH ?? env.Path ?? '';
  const file = platform === 'win32' ? `${EXECUTABLES[name]}.exe` : EXECUTABLES[name];
  for (const dir of searchPath.split(api.delimiter)) {
    if (!dir) continue;
    const candidate = api.join(dir, file);
    if (await isExecutable(candidate, platform)) return candidate;
  }
  return null;
}

/** "ffmpeg version 7.1.1-Jellyfin …" → "7.1.1-Jellyfin", "mkvmerge v82.0 (…)" → "82.0". */
export function parseVersion(output: string): string | null {
  const firstLine = output.split(/\r?\n/, 1)[0] ?? '';
  const match = firstLine.match(/(?:version\s+|\sv?)(\d[\w.\-+]*)/);
  return match?.[1] ?? null;
}

function readVersion(file: string, name: ToolName): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, [VERSION_ARGS[name]], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : parseVersion(String(stdout)));
    });
  });
}

export async function discoverTools(options: DiscoverOptions): Promise<Tools> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const entries = await Promise.all(
    (Object.keys(EXECUTABLES) as ToolName[]).map(async (name): Promise<[ToolName, AgentTool]> => {
      const candidates = [options.configured?.[name], ...knownLocations(name, options)].filter((file): file is string => Boolean(file));
      let found: string | null = null;
      for (const candidate of candidates) {
        if (await isExecutable(candidate, platform)) {
          found = candidate;
          break;
        }
      }
      found ??= await findOnPath(name, platform, env);
      return [name, { path: found, version: found ? await readVersion(found, name) : null }];
    }),
  );
  return Object.fromEntries(entries) as Tools;
}

/** ffprobe is optional: without it, the agent relies on what Jellyfin knows about the file. */
export function toolsReady(tools: Tools): boolean {
  return Boolean(tools.ffmpeg.path && tools.mkvmerge.path && tools.doviTool.path);
}
