const input = document.getElementById('url');
const check = document.getElementById('check');
const list = document.getElementById('events');

async function bundledUrl() {
  try {
    return (await (await fetch(chrome.runtime.getURL('manelly.json'))).json()).url ?? '';
  } catch {
    return '';
  }
}

function show(text, tone) {
  check.textContent = text;
  check.className = tone ?? '';
}

async function test(url) {
  show('Prüfe …');
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/api/cnl`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 404 ? 'Diese Manelly-Version kennt Click\'n\'Load noch nicht.' : `HTTP ${response.status}`);
    await response.json();
    show('Manelly erreichbar.', 'good');
  } catch (error) {
    show(error instanceof TypeError ? 'Manelly ist unter dieser Adresse nicht erreichbar.' : error.message, 'bad');
  }
}

function when(iso) {
  return new Date(iso).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
}

async function render() {
  const { events = [] } = await chrome.storage.local.get('events');
  if (!events.length) return;
  list.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement('li');
      const what = event.error ? event.error : event.container ? 'DLC-Container übergeben' : `${event.links} ${event.links === 1 ? 'Link' : 'Links'} übergeben`;
      const from = event.packageName || (event.page ? new URL(event.page).host : '');
      item.textContent = `${when(event.at)} · ${from ? `${from} · ` : ''}${what}`;
      item.className = event.error ? 'bad' : '';
      return item;
    }),
  );
}

document.getElementById('save').addEventListener('click', async () => {
  const url = input.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(url)) return show('Adresse wie http://192.168.1.20:3000 eintragen.', 'bad');
  await chrome.storage.local.set({ url });
  await test(url);
});

(async () => {
  const { url } = await chrome.storage.local.get('url');
  input.value = url || (await bundledUrl());
  await chrome.action.setBadgeText({ text: '' });
  await render();
  if (input.value) await test(input.value);
})();
