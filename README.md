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
- Verständliche Einrichtungs- und Fehlerhinweise, wenn Jellyfin nicht erreichbar ist oder der API-Schlüssel nicht stimmt

Geplant: Medien durchsuchen, Server-Management (Bibliotheken, geplante Aufgaben, Benutzer) und Troubleshooting (Logs,
Wiedergabe-Analyse).

## Schnellstart mit Docker

1. In Jellyfin unter **Dashboard → API-Schlüssel** einen neuen Schlüssel erstellen (z. B. «Manelly»).
2. Konfiguration anlegen:

   ```bash
   cp .env.example .env
   # JELLYFIN_URL und JELLYFIN_API_KEY in .env eintragen
   ```

3. Starten:

   ```bash
   docker compose up -d --build
   ```

4. Öffnen: <http://localhost:3000>

> **Tipp:** `JELLYFIN_URL` muss aus dem Container heraus erreichbar sein. `localhost` zeigt dort auf den Container
> selbst – verwende die IP-Adresse des Hosts (z. B. `http://192.168.1.10:8096`) oder, wenn beide Container im selben
> Docker-Netzwerk laufen, den Container-Namen (z. B. `http://jellyfin:8096`).

## Ohne Docker

Voraussetzung: Node.js 22 oder neuer.

```bash
npm ci
cp .env.example .env   # Werte eintragen
npm run build
npm start
```

## Entwicklung

```bash
npm install
cp .env.example .env   # Werte deines Jellyfin-Servers eintragen
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

| Variable           | Standard  | Beschreibung                                               |
| ------------------ | --------- | ---------------------------------------------------------- |
| `JELLYFIN_URL`     | –         | Adresse des Jellyfin-Servers, z. B. `http://192.168.1.10:8096` |
| `JELLYFIN_API_KEY` | –         | API-Schlüssel aus Jellyfin (Dashboard → API-Schlüssel)      |
| `PORT`             | `3000`    | Port von Manelly                                            |
| `HOST`             | `0.0.0.0` | Netzwerk-Interface, auf dem Manelly lauscht                 |
| `LOG_LEVEL`        | `info`    | `debug`, `info`, `warn`, `error`                            |

## Aufbau

```
shared/   API-Typen, die Server und Frontend gemeinsam nutzen
server/   Fastify-Server: spricht mit der Jellyfin-API, liefert das Frontend aus
web/      React-Frontend (Vite, Tailwind CSS, TanStack Query)
```

Der Browser spricht nur mit dem Manelly-Server, nie direkt mit Jellyfin. Dadurch bleibt der API-Schlüssel auf dem
Server, und Jellyfin muss vom Browser aus nicht erreichbar sein (auch Cover-Bilder werden durchgereicht).

## Sicherheit

Ein Jellyfin-API-Schlüssel hat Administratorrechte. Manelly hat **noch keine eigene Anmeldung** – betreibe es daher
nur im Heimnetz oder hinter einem Reverse Proxy mit Authentifizierung und mache es nicht direkt im Internet
erreichbar.
