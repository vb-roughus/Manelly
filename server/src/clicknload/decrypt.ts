import { createDecipheriv } from 'node:crypto';
import type { ClickNLoadKind } from '@manelly/shared';

/** A request Manelly cannot use; the message says why. */
export class ClickNLoadError extends Error {}

/** Lines that look like addresses; JDownloader would take anything, but garbage from a wrong key is not wanted. */
const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const MAX_LINKS = 5000;
const MAX_LINK_LENGTH = 4000;

/** One link per line; the padding of a decrypted block and empty lines go. */
export function splitLinks(text: string): string[] {
  return text
    .replace(/\0/g, '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => ADDRESS.test(line) && line.length <= MAX_LINK_LENGTH);
}

/**
 * The key of a CNL2 request. The page sends it as JavaScript – `function f(){ return '31323334…'; }` – which
 * JDownloader runs; Manelly runs no code from a page and only reads the hex string it returns.
 */
export function keyFromJk(jk: string): Buffer | null {
  const plain = jk.trim();
  const hex = /^[0-9a-f]{32}$/i.test(plain) ? plain : /return\s*\(?\s*(['"])([0-9a-f]{32})\1/i.exec(plain)?.[2];
  return hex ? Buffer.from(hex, 'hex') : null;
}

/** Base64 as forms send it: a "+" may arrive as a space. */
const base64 = (value: string) => Buffer.from(value.replace(/ /g, '+').replace(/\s/g, ''), 'base64');

/** The links of a CNL2 request: AES-128-CBC with the key as IV, without padding. */
export function decryptLinks(key: Buffer, crypted: string): string[] {
  const data = base64(crypted);
  if (data.length === 0 || data.length % 16 !== 0) throw new ClickNLoadError('Die verschlüsselten Links sind unvollständig.');
  const decipher = createDecipheriv('aes-128-cbc', key, key).setAutoPadding(false);
  const links = splitLinks(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  if (links.length === 0) throw new ClickNLoadError('Die Links liessen sich nicht entschlüsseln.');
  return links;
}

/** What a Click'n'Load request hands over: links, or a DLC container (base64), with the package's name and password. */
export interface ClickNLoadContent {
  links: string[];
  container: string | null;
  packageName: string | null;
  password: string | null;
  source: string | null;
}

const field = (fields: Record<string, string>, name: string) => fields[name]?.trim() || null;

/** Reads the form fields of a request as the page sent them to JDownloader. */
export function readRequest(kind: ClickNLoadKind, fields: Record<string, string>): ClickNLoadContent {
  // Several passwords come one per line; JDownloader takes one for extracting.
  const password = field(fields, 'passwords')?.split(/[\r\n]+/)[0]?.trim() || null;
  const common = { packageName: field(fields, 'package')?.slice(0, 255) ?? null, password: password?.slice(0, 255) ?? null, source: field(fields, 'source')?.slice(0, 2000) ?? null };
  if (kind === 'addcrypted') {
    const crypted = field(fields, 'crypted');
    if (!crypted) throw new ClickNLoadError('Die Seite hat keinen DLC-Container mitgeschickt.');
    const container = base64(crypted);
    if (container.length === 0) throw new ClickNLoadError('Der DLC-Container ist leer.');
    return { links: [], container: container.toString('base64'), ...common };
  }
  let links: string[];
  if (kind === 'add') {
    links = splitLinks(field(fields, 'urls') ?? '');
    if (links.length === 0) throw new ClickNLoadError('Die Seite hat keine Links mitgeschickt.');
  } else {
    const jk = field(fields, 'jk');
    const crypted = field(fields, 'crypted');
    if (!jk || !crypted) throw new ClickNLoadError('Die Seite hat Schlüssel oder Links nicht mitgeschickt.');
    const key = keyFromJk(jk);
    if (!key) throw new ClickNLoadError('Den Schlüssel dieser Seite kann Manelly nicht lesen (er steckt in aufwendigerem JavaScript).');
    links = decryptLinks(key, crypted);
  }
  if (links.length > MAX_LINKS) throw new ClickNLoadError(`Mehr als ${MAX_LINKS} Links auf einmal gehen nicht.`);
  return { links, container: null, ...common };
}
