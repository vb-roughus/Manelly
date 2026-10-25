# Manelly

Ein Web-Tool für deinen [Jellyfin](https://jellyfin.org)-Server: Server-Management, Medien durchsuchen und
Troubleshooting an einem Ort.

## Funktionen

### Dashboard

Live-Übersicht der laufenden Streams:

- Alle aktiven Wiedergaben mit Cover, Benutzer, Gerät, Client und Fortschritt (läuft flüssig mit, Aktualisierung alle 5 s)
- Wiedergabeart wie im Jellyfin-Dashboard: **Direct Play**, **Remux**, **Direct Stream** oder **Transcode**, inklusive der
  eingestellten Hardware-Beschleunigung
- Quelle → Ziel für Video, Audio, Untertitel und Container, z. B. `4K · HEVC · HDR10 → 1080p · H.264`
- **Transcode-Gründe auf Deutsch erklärt** (Tooltip mit Hinweis, was man dagegen tun kann)
- Fortschritt des Transcoders als Puffer im Fortschrittsbalken
- **Stream-Diagnose** pro Wiedergabe, jeweils mit konkretem Tipp, wo man in Jellyfin ansetzt:
  - Kommt der Server mit dem Transcoding nach? Tempo im Verhältnis zur Bildrate (z. B. 0.7× Echtzeit) und Vorlauf
    gegenüber der Wiedergabe
  - Transcoding ganz ohne Hardware-Beschleunigung, Codecs, die trotz Hardware-Beschleunigung in Software dekodiert
    werden (z. B. HEVC oder HEVC 10 bit nicht aktiviert), ausgeschaltete Hardware-Kodierung
  - HDR, das ohne Tone-Mapping (blasse Farben) oder in Software (sehr rechenintensiv) in SDR umgewandelt wird
  - Welches Limit die Bitrate drückt: Benutzer- oder Server-Limit für den Fernzugriff oder die Qualitätseinstellung im Client
  - Hohe Bitraten über das Internet

  Dafür liest Manelly die Transcoding-Einstellungen, das Fernzugriff-Limit und die Benutzer-Limits aus Jellyfin (höchstens
  einmal pro Minute; der API-Schlüssel braucht Administratorrechte, was bei im Dashboard erstellten Schlüsseln der Fall ist)
- Kennzahlen: aktive Streams, Direct Play / Direct Stream / Transcodes (inkl. wie viele nicht nachkommen), geschätzte
  Bandbreite
- Lokal oder extern verbunden (anhand der IP-Adresse)

### Medien

Filme und Serien durchsuchen und filtern:

- Titelsuche, Filme/Serien, Genre, Erscheinungsjahr, Bewertung, Altersfreigabe und Bibliothek
- **Video-Filter:** Auflösung, Dynamikumfang (Dolby Vision, HDR10, …) und Codec (HEVC, H.264, AV1, VP9, MPEG-4, …)
- **Tonspur-Filter** nach Sprache, Format (Dolby Atmos, DTS:X, TrueHD, DTS-HD MA, Dolby Digital Plus, …) und Kanälen. Die
  Bedingungen gelten für **dieselbe Spur**: «Deutsch in Dolby Atmos» findet nur Titel mit einer deutschen Atmos-Spur, nicht
  solche mit deutscher DTS- und englischer Atmos-Spur
- Schnellwahl **«Deutsch in Dolby Atmos»** und **«Ohne deutsche Tonspur»**; jeder Tonspur-Filter lässt sich auch umkehren
  («fehlt»)
- Serien zeigen, in wie vielen Folgen die gesuchte Spur vorhanden ist; optional nur Serien, bei denen alle Folgen passen
- Detailansicht mit allen Tonspuren jeder Version bzw. jeder Folge und Link zum Titel in Jellyfin
- **Treffer in eine Sammlung übernehmen:** alle Titel der aktuellen Suche zu einer bestehenden Jellyfin-Sammlung
  hinzufügen oder eine neue anlegen. Manelly zeigt vorher, wie viele schon drin sind, und fügt nur die fehlenden hinzu
- Tonspur- und Video-Filter sind einklappbar und zeigen eingeklappt eine Zusammenfassung, z. B. «4K · Dolby Vision · HEVC»
- Filter stehen in der URL – eine Suche lässt sich als Lesezeichen speichern
- **«Titel fehlt?»** sucht einen Titel direkt in Jellyfin und erklärt, warum er in Manelly nicht erscheint: von aktiven
  Filtern ausgeblendet, noch nicht eingelesen, falscher Bibliothekstyp (z. B. «Heimvideos»), von Jellyfin als «Video»
  statt als Film geführt oder von Jellyfin bei der Abfrage seiner Bibliothek nicht ausgeliefert. Dazu liest die Prüfung
  die Bibliothek genau so wie Manelly beim Einlesen; ein «Hinzugefügt»-Datum in der Zukunft wird angezeigt

Manelly liest dafür einmal alle Filme, Serien und Folgen samt Tonspuren aus Jellyfin ein und frischt diesen Index im
Hintergrund auf, wenn er älter als 15 Minuten ist (oder sofort mit «Neu einlesen»). Kann Jellyfin die Medieninfos eines
einzelnen Titels nicht liefern (etwa weil eine neue Datei noch analysiert wird), nimmt Manelly ihn ohne Tonspuren auf und
zeigt «ohne Medieninfos» an, statt das ganze Einlesen abzubrechen. Dolby Atmos und DTS:X erkennt Jellyfin
am Codec-Profil der Tonspur (z. B. «Dolby TrueHD + Dolby Atmos»). Wurde eine Datei mit einer älteren Jellyfin-Version
gescannt, fehlt das Profil eventuell. Dann bei den betroffenen Titeln in Jellyfin «Metadaten aktualisieren» mit «Alle
Metadaten ersetzen» ausführen (Achtung: überschreibt manuell geänderte Metadaten) und danach in Manelly «Neu einlesen».

### Allgemein

- Hell- und Dunkelmodus (folgt dem System, umschaltbar)
- Hauptmenü links lässt sich zu einer schmalen Icon-Leiste einklappen
- Jellyfin-Verbindung (Adresse und API-Schlüssel) direkt in der Oberfläche einrichten – Manelly testet sie vor dem Speichern
- Verständliche Fehlerhinweise, wenn Jellyfin nicht erreichbar ist oder der API-Schlüssel nicht stimmt

Geplant: Server-Management (Bibliotheken, geplante Aufgaben, Benutzer) und Troubleshooting (Logs, Wiedergabe-Analyse).

## Schnellstart auf dem Mac

Im Manelly-Ordner:

```bash
./scripts/start-mac.sh
```

Das Skript installiert bei Bedarf Node.js 22 über [Homebrew](https://brew.sh) (und bietet an, Homebrew selbst zu
installieren, falls es fehlt), installiert die Abhängigkeiten, baut Manelly, startet es und öffnet
<http://localhost:3000> im Browser. Dort richtest du beim ersten Start die Verbindung zu Jellyfin ein. Beenden mit
`Ctrl+C`, ein anderer Port mit `PORT=3001 ./scripts/start-mac.sh`.

Update: `git pull`, dann das Skript erneut starten. Die Einstellungen liegen in `data/` und bleiben erhalten.

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

Voraussetzung: Node.js 22.12 oder neuer.

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
öffnen kann, kann auch die Jellyfin-Verbindung ändern und Sammlungen in Jellyfin bearbeiten. (Sammlungen liest Manelly
mit der Sicht eines Jellyfin-Administrators, weil Jellyfin deren Inhalt nur für einen Benutzer auflöst.) Betreibe Manelly daher nur im Heimnetz oder hinter einem Reverse
Proxy mit Authentifizierung und mache es nicht direkt im Internet erreichbar.
