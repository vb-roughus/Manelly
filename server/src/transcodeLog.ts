import type { TranscodeLogInfo } from '@manelly/shared';
import type { JellyfinClient } from './jellyfin/client.js';
import type { JfLogFile } from './jellyfin/types.js';

// Jellyfin names them "FFmpeg.Transcode-<date>_<media source id>_<random>.log" and writes the
// media source as JSON, a blank line, the FFmpeg command line, another blank line, then FFmpeg's output.
const LOG_PATTERN = /^FFmpeg\.(Transcode|DirectStream|Remux)-(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)_([0-9a-f]+)_[0-9a-f]+\.log$/i;
/** The command line and FFmpeg's start-up messages fit easily; the rest is progress output. */
export const LOG_HEAD_BYTES = 64 * 1024;

const HARDWARE_ENCODER = /_(qsv|nvenc|amf|vaapi|videotoolbox|v4l2m2m|rkmpp|mf)$/i;
const HARDWARE_DECODER = /_(qsv|cuvid|v4l2m2m|rkmpp|mediacodec)$/i;

// Lines in FFmpeg's output that mean the hardware did not work as intended.
const HARDWARE_ERRORS = [
  /Error creating a MFX session/i,
  /Error initializing an internal MFX session/i,
  /Device creation failed/i,
  /Failed to create (?:a )?(?:D3D11|device|hardware)/i,
  /Cannot load (?:nvcuda|libcuda|nvEncodeAPI)/i,
  /No NVENC capable devices found/i,
  /OpenEncodeSessionEx failed/i,
  /CUDA_ERROR_\w+/,
  /Driver does not support the required nvenc API version/i,
  /AMF failed|amfrt64\.dll/i,
  /Failed to initialise VAAPI connection|No VA display found|vaInitialize failed/i,
  /Failed setup for format \w+: hwaccel initialisation returned error/i,
  /Error while opening encoder/i,
  /Error initializing output stream/i,
  /Conversion failed!/i,
];

export function parseLogName(name: string): { kind: string; startedAt: string; mediaSourceId: string } | null {
  const match = name.match(LOG_PATTERN);
  if (!match) return null;
  const [, kind, stamp, mediaSourceId] = match;
  // "2026-10-26_20-31-05" in the server's local time; good enough to order and display.
  const startedAt = stamp!.replace(/_(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3');
  return { kind: kind!, startedAt, mediaSourceId: mediaSourceId!.toLowerCase() };
}

/** Reads what FFmpeg was told to do – and whether the hardware complained – from the start of a log. */
export function parseTranscodeLog(text: string): Omit<TranscodeLogInfo, 'fileName' | 'startedAt'> {
  const lines = text.split(/\r?\n/);
  const commandIndex = lines.findIndex((line) => /\s-i\s/.test(line) && !line.trimStart().startsWith('{'));
  const command = commandIndex >= 0 ? lines[commandIndex]! : '';
  // Options before the first input apply to decoding, the rest to the output.
  const inputAt = command.search(/\s-i\s/);
  const input = inputAt >= 0 ? command.slice(0, inputAt) : '';
  const output = inputAt >= 0 ? command.slice(inputAt) : '';

  const hwaccel = input.match(/-hwaccel\s+(\S+)/)?.[1] ?? null;
  const decoder = input.match(/-c(?:odec)?:v\s+(\S+)/)?.[1] ?? null;
  const encoder = output.match(/-codec:v:0\s+(\S+)/)?.[1] ?? output.match(/-c(?:odec)?:v(?::0)?\s+(\S+)/)?.[1] ?? null;
  const filters = output.match(/-(?:filter_complex|vf)\s+"([^"]*)"/)?.[1] ?? '';
  const toneMapping = /tonemap_(?:opencl|cuda|vaapi|videotoolbox)|vpp_qsv=[^,\]]*tonemap|libplacebo=[^,\]]*tonemap/i.test(filters)
    ? 'hardware'
    : /tonemapx|(?:^|[,\[\]])tonemap=/i.test(filters)
      ? 'software'
      : null;

  const errors: string[] = [];
  for (const line of lines.slice(commandIndex + 1)) {
    if (HARDWARE_ERRORS.some((pattern) => pattern.test(line)) && !errors.includes(line.trim())) errors.push(line.trim());
    if (errors.length >= 5) break;
  }
  const decodeFellBack = errors.some((line) => /Failed setup for format/i.test(line));

  return {
    encoder,
    encoderHardware: encoder === null || encoder === 'copy' ? null : HARDWARE_ENCODER.test(encoder),
    decoder: decoder ?? (hwaccel ? `hwaccel ${hwaccel}` : null),
    decoderHardware: decodeFellBack ? false : Boolean(hwaccel || (decoder && HARDWARE_DECODER.test(decoder))),
    toneMapping,
    errors,
  };
}

/** Reads the start of a log without downloading the whole file, which grows with every progress line. */
async function readHead(client: JellyfinClient, name: string): Promise<string> {
  const response = await client.getLogFile(name);
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < LOG_HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8', 0, Math.min(size, LOG_HEAD_BYTES));
}

/**
 * Finds the FFmpeg log of running transcodes. A log never changes its start,
 * so each one is parsed once; listing the logs is cheap.
 */
export function createTranscodeLogReader(options: { cacheSize?: number } = {}) {
  const { cacheSize = 100 } = options;
  const parsed = new Map<string, TranscodeLogInfo>();

  async function read(client: JellyfinClient, file: JfLogFile): Promise<TranscodeLogInfo | null> {
    const name = file.Name ?? '';
    const cached = parsed.get(name);
    if (cached) return cached;
    const meta = parseLogName(name);
    if (!meta) return null;
    const info: TranscodeLogInfo = { fileName: name, startedAt: meta.startedAt, ...parseTranscodeLog(await readHead(client, name)) };
    // Only keep logs that already contain the command line; a brand-new one is read again next time.
    if (info.encoder || info.errors.length) {
      parsed.set(name, info);
      if (parsed.size > cacheSize) parsed.delete(parsed.keys().next().value!);
    }
    return info;
  }

  return {
    read,

    /** The newest transcode log of each media source; Jellyfin names its files after the media source id. */
    async forMediaSources(client: JellyfinClient, mediaSourceIds: string[]): Promise<Map<string, TranscodeLogInfo>> {
      const result = new Map<string, TranscodeLogInfo>();
      if (mediaSourceIds.length === 0) return result;
      const wanted = new Set(mediaSourceIds.map((id) => id.toLowerCase().replace(/-/g, '')));
      const newest = new Map<string, JfLogFile>();
      for (const file of await client.getLogFiles()) {
        const meta = file.Name ? parseLogName(file.Name) : null;
        if (!meta || meta.kind !== 'Transcode' || !wanted.has(meta.mediaSourceId)) continue;
        const current = newest.get(meta.mediaSourceId);
        if (!current || (current.Name ?? '') < (file.Name ?? '')) newest.set(meta.mediaSourceId, file);
      }
      await Promise.all(
        [...newest].map(async ([id, file]) => {
          const info = await read(client, file).catch(() => null);
          if (info) result.set(id, info);
        }),
      );
      return result;
    },

    /** The most recent transcode logs, newest first. */
    async recent(client: JellyfinClient, limit: number): Promise<TranscodeLogInfo[]> {
      const files = (await client.getLogFiles())
        .filter((file) => file.Name && parseLogName(file.Name)?.kind === 'Transcode')
        .sort((a, b) => (b.Name ?? '').localeCompare(a.Name ?? ''))
        .slice(0, limit);
      const logs = await Promise.all(files.map((file) => read(client, file).catch(() => null)));
      return logs.filter((log): log is TranscodeLogInfo => log !== null);
    },
  };
}

export type TranscodeLogReader = ReturnType<typeof createTranscodeLogReader>;

/** Jellyfin writes media source ids without dashes in file names. */
export const normalizeMediaSourceId = (id: string) => id.toLowerCase().replace(/-/g, '');
