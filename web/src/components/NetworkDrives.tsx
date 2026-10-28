import { useId, useState, type FormEvent } from 'react';
import type { NetworkDrive } from '@manelly/shared';
import { CircleCheck, CircleX, KeyRound, LoaderCircle } from 'lucide-react';
import { useRemoveDriveCredential, useSetDriveCredential } from '../hooks/queries';
import { inputClass, Message } from './ConnectionForm';

/** "\\nas\filme" → "\\nas" */
const serverOf = (remote: string) => remote.match(/^\\\\[^\\/]+/)?.[0] ?? remote;

/** The agent's hint where to enter the login; here the login is right below. */
const LOGIN_HINT = / In Manelly unter Server → Agent [^.]*hinterlegen\.$/;

const link = 'font-medium text-accent hover:underline disabled:opacity-60';
const button =
  'inline-flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm font-medium whitespace-nowrap text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';

/**
 * The user's network drives on the Jellyfin server: whether the agent reaches them, and per NAS the login it connects
 * them with – also when it starts without a logon.
 */
export function NetworkDrives({ drives }: { drives: NetworkDrive[] }) {
  // Agents before 0.16.0 report no username and take no logins.
  const takesLogins = drives.some((drive) => drive.username !== undefined);
  const servers = new Map<string, string | null>();
  for (const drive of drives) {
    const server = serverOf(drive.remote);
    const key = server.toLowerCase();
    if (![...servers.keys()].some((known) => known.toLowerCase() === key)) servers.set(server, drive.username ?? null);
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {drives.map((drive) => (
          <li key={drive.letter}>
            <span className="flex flex-wrap items-center gap-x-1.5">
              {drive.connected ? <CircleCheck className="size-3.5 shrink-0 text-good" aria-hidden /> : <CircleX className="size-3.5 shrink-0 text-critical" aria-hidden />}
              <b className="font-medium">{drive.letter}</b>
              <span className="break-all">{drive.remote}</span>
              <span className="whitespace-nowrap text-ink-3">· {drive.connected ? 'erreichbar' : 'nicht erreichbar'}</span>
            </span>
            {drive.error && <p className="text-xs text-critical">{takesLogins ? drive.error.replace(LOGIN_HINT, '') : drive.error}</p>}
          </li>
        ))}
      </ul>
      {takesLogins
        ? [...servers].map(([server, username]) => <ServerLogin key={server} server={server} username={username} />)
        : drives.some((drive) => !drive.connected) && (
            <p className="text-xs text-ink-3">Ab Agent 0.16.0 lassen sich hier Benutzername und Passwort für das NAS hinterlegen.</p>
          )}
    </div>
  );
}

function ServerLogin({ server, username }: { server: string; username: string | null }) {
  const id = useId();
  const save = useSetDriveCredential();
  const remove = useRemoveDriveCredential();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  function open() {
    setName(username ?? '');
    setPassword('');
    save.reset();
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      { server, username: name.trim(), password },
      {
        onSuccess: () => {
          setEditing(false);
          setPassword('');
        },
      },
    );
  }

  if (!editing) {
    return (
      <div className="text-xs">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <KeyRound className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          <span>
            {server}:{' '}
            {username ? (
              <>
                angemeldet als <b className="font-medium">{username}</b>
              </>
            ) : (
              <span className="text-ink-2">keine Anmeldedaten hinterlegt</span>
            )}
          </span>
          <button type="button" className={link} onClick={open}>
            {username ? 'Ändern' : 'Anmeldedaten hinterlegen'}
          </button>
          {username && (
            <button type="button" className={link} disabled={remove.isPending} onClick={() => remove.mutate(server)}>
              Entfernen
            </button>
          )}
        </p>
        {remove.isError && <p className="mt-1 text-critical">{remove.error.message}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-line bg-card-2/40 p-3">
      <p className="text-sm font-medium">Anmeldedaten für {server}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-user`} className="mb-1 block text-xs text-ink-2">
            Benutzername
          </label>
          <input
            id={`${id}-user`}
            required
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. rolf"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-password`} className="mb-1 block text-xs text-ink-2">
            Passwort
          </label>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-ink-3">
        Die Anmeldung beim NAS, nicht bei Windows. Manelly reicht sie nur an den Agent weiter; der speichert das Passwort
        verschlüsselt (nur auf dem Jellyfin-Server lesbar) und verbindet damit die Laufwerke dieses NAS – auch im Autostart
        ohne Anmeldung.
      </p>
      {save.isError && <Message tone="critical">{save.error.message}</Message>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button} disabled={save.isPending || !name.trim()}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          {save.isPending ? (
            'Verbindet …'
          ) : (
            <>
              {/* Next to the labels, a phone has room for the short word only. */}
              <span className="sm:hidden">Verbinden</span>
              <span className="hidden sm:inline">Speichern & verbinden</span>
            </>
          )}
        </button>
        <button type="button" className={button} disabled={save.isPending} onClick={() => setEditing(false)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
