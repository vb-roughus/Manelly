# Manelly

Ein Web-Tool für deinen [Jellyfin](https://jellyfin.org)-Server: Server-Management, Medien durchsuchen und
Troubleshooting an einem Ort.

**Aktueller Stand:** ein Live-Dashboard der laufenden Streams.

- Alle aktiven Wiedergaben mit Cover, Benutzer, Gerät, Client und Fortschritt (läuft flüssig mit, Aktualisierung alle 5 s)
- Wiedergabeart wie im Jellyfin-Dashboard: **Direct Play**, **Remux**, **Direct Stream** oder **Transcode**, inklusive Hardware-Beschleunigung
- Quelle → Ziel für Video, Audio, Untertitel und Container, z. B. `4K · HEVC · HDR10 → 1080p · H.264`
- **Transcode-Gründe auf Deutsch erklärt** (Tooltip mit Hinweis, was man dagegen tun kann)
- Fortschritt des Transcoders als Puffer im Fortschrittsbalken
- Kennzahlen: aktive Streams, Direct Play / Direct Stream / Transcodes, geschätzte Bandbreite
- Lokal oder extern verbunden (anhand der IP-Adresse)
- Hell- und Dunkelmodus (folgt dem System, umschaltbar)
- Jellyfin-Verbindung (Adresse und API-Schlüssel) direkt in der Oberfläche einrichten – Manelly testet sie vor dem Speichern
- Verständliche Fehlerhinweise, wenn Jellyfin nicht erreichbar ist oder der API-Schlüssel nicht stimmt

Geplant: Medien durchsuchen, Server-Management (Bibliotheken, geplante Aufgaben, Benutzer) und Troubleshooting (Logs,
Wiedergabe-Analyse).

## Schnellstart mit Docker

1. Starten:

   ```bash
   docker compose up -d --build
   ```

2. <http://localhost:3000> öffnen.
3. In Jellyfin unter **Dashboard → API-Schlüssel** einen neuen Schlüssel erstellen (z. B. «Manelly»).
4. Server-Adresse und Schlüssel im Einrichtungsformular eintragen. Später lässt sich beides unter **Einstellungen**
   ändern.

Die Einstellungen liegen im Docker-Volume `manelly-data` und bleiben bei Updates erhalten.

> **Tipp:** Die Server-Adresse muss aus dem Container heraus erreichbar sein. `localhost` zeigt dort auf den Container
> selbst – verwende die IP-Adresse des Hosts (z. B. `http://192.168.1.10:8096`) oder, wenn beide Container im selben
> Docker-Netzwerk laufen, den Container-Namen (z. B. `http://jellyfin:8096`). Läuft Jellyfin direkt auf demselben Mac
> oder Windows-PC, funktioniert `http://host.docker.internal:8096`.

### Wenn `docker compose` fehlt

Meldet Docker `unknown shorthand flag: 'd' in -d`, ist das Compose-Plugin nicht installiert (`docker compose version`
prüft das). Entweder Docker Desktop installieren bzw. aktualisieren – es bringt Compose mit –, oder bei einer
Homebrew-Installation `brew install docker-compose` ausführen und den Hinweis von Homebrew zu `cliPluginsExtraDirs` in
`~/.docker/config.json` übernehmen.

Es geht auch ganz ohne Compose:

```bash
docker build -t manelly .
docker run -d --name manelly --restart unless-stopped -p 3000:3000 -v manelly-data:/data manelly
```

Update später: `git pull`, dann `docker rm -f manelly` und die beiden Befehle erneut ausführen.

## Ohne Docker

Voraussetzung: Node.js 22 oder neuer.

```bash
npm ci
npm run build
npm start              # dann http://localhost:3000 öffnen und die Verbindung einrichten
```

## Entwicklung

```bash
npm install
npm run dev
```

- Frontend mit Hot Reload: <http://localhost:5173>
- API-Server: <http://localhost:3000> (Vite leitet `/api` dorthin weiter)

| Befehl              | Zweck                                   |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Server und Frontend im Watch-Modus      |
| `npm run build`     | Produktions-Build von Frontend und Server |
| `npm start`         | Gebauten Server starten (liest `.env`)  |
| `npm test`          | Tests (Vitest)                          |
| `npm run typecheck` | TypeScript-Prüfung aller Pakete         |

## Konfiguration

Die Jellyfin-Verbindung richtest du in der Oberfläche ein. Manelly speichert sie in `DATA_DIR/settings.json` (nur für
den Besitzer lesbar). Der API-Schlüssel wird nie an den Browser zurückgegeben; angezeigt werden nur die letzten Zeichen.

Optional lässt sich alles über Umgebungsvariablen (oder eine `.env`-Datei, Vorlage: `.env.example`) vorgeben.
**In der Oberfläche gespeicherte Einstellungen haben Vorrang** vor `JELLYFIN_URL` und `JELLYFIN_API_KEY`.

| Variable           | Standard                    | Beschreibung                                               |
| ------------------ | --------------------------- | ---------------------------------------------------------- |
| `JELLYFIN_URL`     | –                           | Adresse des Jellyfin-Servers, z. B. `http://192.168.1.10:8096` |
| `JELLYFIN_API_KEY` | –                           | API-Schlüssel aus Jellyfin (Dashboard → API-Schlüssel)      |
| `DATA_DIR`         | `./data` (Docker: `/data`)  | Ordner für die gespeicherten Einstellungen                  |
| `PORT`             | `3000`                      | Port von Manelly                                            |
| `HOST`             | `0.0.0.0`                   | Netzwerk-Interface, auf dem Manelly lauscht                 |
| `LOG_LEVEL`        | `info`                      | `debug`, `info`, `warn`, `error`                            |

## Aufbau

```
shared/   API-Typen, die Server und Frontend gemeinsam nutzen
server/   Fastify-Server: spricht mit der Jellyfin-API, liefert das Frontend aus
web/      React-Frontend (Vite, Tailwind CSS, TanStack Query)
```

Der Browser spricht nur mit dem Manelly-Server, nie direkt mit Jellyfin. Dadurch bleibt der API-Schlüssel auf dem
Server, und Jellyfin muss vom Browser aus nicht erreichbar sein (auch Cover-Bilder werden durchgereicht).

## Sicherheit

Ein Jellyfin-API-Schlüssel hat Administratorrechte. Manelly hat **noch keine eigene Anmeldung** – wer die Oberfläche
öffnen kann, kann auch die Jellyfin-Verbindung ändern. Betreibe Manelly daher nur im Heimnetz oder hinter einem Reverse
Proxy mit Authentifizierung und mache es nicht direkt im Internet erreichbar.
