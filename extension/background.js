// Pages hand Click'n'Load links to JDownloader at 127.0.0.1:9666 – on this computer, where none runs. The extension
// answers there instead (rules.json) and passes what the page sent on to Manelly, which hands it to the JDownloader
// on the Jellyfin server.

const KINDS = { '/flash/add': 'add', '/flash/addcrypted': 'addcrypted', '/flash/addcrypted2': 'addcrypted2' };
const KEEP = 10;

/** Manelly's address: set in the options, else the one Manelly wrote into manelly.json of the download. */
async function manellyUrl() {
  const { url } = await chrome.storage.local.get('url');
  if (url) return url;
  try {
    const bundled = await (await fetch(chrome.runtime.getURL('manelly.json'))).json();
    return typeof bundled.url === 'string' ? bundled.url : null;
  } catch {
    return null;
  }
}

/** The form fields as the page sent them: parsed by the browser, or else read from the raw body. */
function formFields(body) {
  const fields = {};
  if (body?.formData) {
    for (const [name, values] of Object.entries(body.formData)) if (values.length) fields[name] = String(values[0]);
    return fields;
  }
  if (body?.raw) {
    const bytes = body.raw.filter((part) => part.bytes).map((part) => new Uint8Array(part.bytes));
    const text = new TextDecoder().decode(bytes.length === 1 ? bytes[0] : new Uint8Array(bytes.flatMap((part) => [...part])));
    for (const [name, value] of new URLSearchParams(text)) if (!(name in fields)) fields[name] = value;
  }
  return fields;
}

async function remember(entry) {
  const { events = [] } = await chrome.storage.local.get('events');
  await chrome.storage.local.set({ events: [entry, ...events].slice(0, KEEP) });
  await chrome.action.setBadgeBackgroundColor({ color: entry.error ? '#d92d20' : '#12b76a' });
  await chrome.action.setBadgeText({ text: entry.error ? '!' : '✓' });
  await chrome.action.setTitle({ title: entry.error ? `Click'n'Load: ${entry.error}` : `Click'n'Load: an Manelly übergeben` });
}

async function forward(kind, fields, page) {
  const url = await manellyUrl();
  const at = new Date().toISOString();
  if (!url) {
    await remember({ at, page, links: 0, error: 'Keine Manelly-Adresse eingetragen – in den Optionen der Erweiterung nachholen.' });
    return;
  }
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/cnl/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok) throw new Error(answer?.error?.message ?? `Manelly antwortete mit HTTP ${response.status}.`);
    if (answer.duplicate) return;
    await remember({ at, page, links: answer.links, container: answer.container, packageName: answer.packageName, error: answer.error });
  } catch (error) {
    const message = error instanceof TypeError ? `Manelly ist unter ${url} nicht erreichbar.` : error.message;
    await remember({ at, page, links: 0, error: message });
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== 'POST') return;
    const kind = KINDS[new URL(details.url).pathname.replace(/\/+$/, '')];
    if (!kind) return;
    void forward(kind, formFields(details.requestBody), details.initiator ?? null);
  },
  { urls: ['http://127.0.0.1:9666/flash/*', 'http://localhost:9666/flash/*'] },
  ['requestBody'],
);
