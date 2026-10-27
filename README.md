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
- **Transcode-Gründe auf Deutsch erklärt** – ein Klick zeigt, welche Eigenschaft der Datei das Problem ist (z. B.
  «Dolby Vision Profil 7 mit Enhancement Layer» oder «Level 5.1»), was Jellyfin daraus macht und wie man es behebt
- Erklärt auch Umwandlungen, für die Jellyfin keinen eigenen Grund nennt, z. B. warum TrueHD 7.1 als AAC 5.1 ankommt:
  Beim Umpacken in einen Streaming-Container nimmt der Client TrueHD nicht an
- Meldet Jellyfin zu einem Transcode keine Details (das passiert z. B., wenn dasselbe Gerät zwei Sitzungen hat, etwa zwei
  Browser-Tabs), holt Manelly sie von der anderen Sitzung des Geräts, nimmt die zuletzt gemeldeten oder liest aus dem
  FFmpeg-Protokoll, was umgewandelt wird – ein Wechsel des Video-Codecs zeigt dann den vermutlichen Grund
- Fortschritt des Transcoders als Puffer im Fortschrittsbalken
- **Stream-Diagnose** pro Wiedergabe, jeweils mit konkretem Tipp, wo man in Jellyfin ansetzt:
  - Kommt der Server mit dem Transcoding nach? Tempo im Verhältnis zur Bildrate (z. B. 0.7× Echtzeit) und Vorlauf
    gegenüber der Wiedergabe
  - Transcoding ganz ohne Hardware-Beschleunigung, Codecs, die trotz Hardware-Beschleunigung in Software dekodiert
    werden (z. B. HEVC oder HEVC 10 bit nicht aktiviert), ausgeschaltete Hardware-Kodierung
  - Ob wirklich die Hardware arbeitet: Manelly liest dazu das FFmpeg-Protokoll des Transcodes aus Jellyfin und nennt den
    Grund, wenn trotzdem in Software kodiert wird (Hardware-Kodierung aus, Beschleunigung passt nicht zum System, z. B.
    VA-API unter Windows, Disc-Abbild, oder der Encoder fehlte beim Start von Jellyfin) – samt Fehlermeldungen von FFmpeg
  - HDR, das ohne Tone-Mapping (blasse Farben) oder in Software (sehr rechenintensiv) in SDR umgewandelt wird
  - Welches Limit die Bitrate drückt: Benutzer- oder Server-Limit für den Fernzugriff oder die Qualitätseinstellung im Client
  - Hohe Bitraten über das Internet

  Dafür liest Manelly die Transcoding-Einstellungen, das Fernzugriff-Limit und die Benutzer-Limits aus Jellyfin (höchstens
  einmal pro Minute; der API-Schlüssel braucht Administratorrechte, was bei im Dashboard erstellten Schlüsseln der Fall ist)
- Kennzahlen: aktive Streams (mit den Benutzern, die gerade schauen), Direct Play / Direct Stream / Transcodes (inkl. wie
  viele nicht nachkommen), geschätzte Bandbreite
- Lokal oder extern verbunden (anhand der IP-Adresse)
- Laufende und in den letzten 12 Stunden beendete [Umwandlungen](#umwandlungen-mit-agent) mit Fortschritt (mit Agent),
  einklappbar – der Browser merkt sich, ob der Abschnitt offen ist
- Ein Klick auf die Kachel **Transcodes** zeigt die **Auslastung des Servers** (mit Agent): CPU und GPU (pro Einheit wie
  Video-Dekodierung, Video-Kodierung, Videoverarbeitung, 3D), jeweils mit dem Anteil von Jellyfins FFmpeg und einer
  laufenden Umwandlung, einem Verlauf der letzten 10 Minuten und den einzelnen FFmpeg-Prozessen. Der Agent misst nur,
  solange die Anzeige offen ist (danach noch 10 Minuten). GPU-Werte gibt es auf Windows 10/11 für jede Grafikkarte mit
  aktuellem Treiber, auf Linux nur für AMD und ohne Anteil pro Prozess
- Ein Klick auf die Kachel **Bandbreite** klappt die Details auf: die aktuelle Bitrate jedes Streams (gesamt und davon
  nach extern) und darunter das **Netzwerk des Jellyfin-Servers** (mit Agent): Senden und Empfangen der unter
  Einstellungen gewählten Schnittstellen, Auslastung gemessen an der Link-Geschwindigkeit (ab 70 % gelb, ab 90 % rot) und
  der Verlauf der letzten 10 Minuten. Der Agent misst nur die gewählten Schnittstellen und nur, solange das Dashboard
  offen ist (danach noch 10 Minuten) – so ist der Verlauf beim Aufklappen schon da

### Medien

Filme und Serien durchsuchen und filtern:

- Titelsuche, Filme/Serien, Genre, Erscheinungsjahr, Bewertung, Altersfreigabe und Bibliothek
- **Video-Filter:** Auflösung, Dynamikumfang (Dolby Vision, Dolby Vision P7, HDR10, …) und Codec (HEVC, H.264, AV1, VP9,
  MPEG-4, …)
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

### Server

- **Hardware-Beschleunigung prüfen:** Einstellungen von Jellyfin im Überblick (Beschleunigung, Hardware-Kodierung,
  Hardware-Dekodierung, HEVC 10 bit, Tone-Mapping, FFmpeg) mit Hinweisen, was nicht passt – z. B. HEVC nicht für die
  Hardware-Dekodierung eingeschaltet (Jellyfins Standard) oder eine Beschleunigung, die es auf dem System nicht gibt
- **Letzte Transcodes** aus den FFmpeg-Protokollen: dekodiert/kodiert in Hardware oder Software, Fehlermeldungen
- **Hardware testen** (mit [Agent](#agent-auf-dem-jellyfin-server-windows)): Das FFmpeg von Jellyfin kodiert und
  dekodiert auf dem Server ein paar Sekunden Testbild mit der eingestellten Beschleunigung – so zeigt sich, ob Treiber und
  Grafikeinheit wirklich funktionieren
- **Agent** (Unterseite im Menü unter Server): Verbindung zum [Agent](#agent-auf-dem-jellyfin-server-windows) einrichten,
  seine Werkzeuge, Version, Prozess-ID und Startzeit sehen und ihn beenden – z. B. wenn vor einem Update noch ein alter
  Agent läuft

### Umwandlungen (mit Agent)

Dolby Vision **Profil 7** (UHD-Blu-ray-Remuxe) spielen viele Geräte nicht ab, Profil 8.1 schon. Ein kleiner Agent auf dem
Jellyfin-Server wandelt solche Dateien direkt dort um:

- In den Medien mit dem Filter **«Dolby Vision P7»** die Kandidaten finden, Titel öffnen, **«In Profil 8.1 umwandeln»**
- Speicherort wählen: **neben dem Original** (Jellyfin zeigt beide als Versionen), **Original ersetzen** (das Original
  wandert in einen Backup-Ordner `.manelly-backup`, den Jellyfin ignoriert) oder **ein anderer Ordner** einer
  Jellyfin-Bibliothek (z. B. eine UHD-Bibliothek), mit Unterordner und Dateiname
- Der Agent löst die Videospur heraus (ffmpeg), wandelt die Dolby-Vision-Daten um (`dovi_tool -m 2 convert --discard`) und
  setzt die Datei mit allen Ton- und Untertitelspuren, Kapiteln und Anhängen neu zusammen (mkvmerge). Das Bild wird nicht
  neu kodiert; der Enhancement Layer fällt weg (bei «FEL»-Dateien geht dessen Zusatzinformation verloren)
- **Sofort** oder **nach Zeitplan**: Auf der Seite **Umwandlungen** ein Zeitfenster (z. B. 01:00–07:00, Uhrzeit des
  Jellyfin-Servers) und/oder «nur wenn niemand streamt» einstellen. Geplante Umwandlungen startet der Agent selbst, auch
  wenn Manelly nicht läuft. Beginnt ein Stream, pausiert die Umwandlung und macht später beim zuletzt fertigen Schritt
  weiter; nach einem Stream wartet der Agent noch 5 Minuten. Eine laufende Umwandlung darf über das Ende des Zeitfensters
  hinaus fertig werden. **«Jetzt starten»** übergeht den Zeitplan.
- Übersteht Neustarts des Servers: Wartende Umwandlungen bleiben eingeplant, eine unterbrochene macht nach dem Neustart
  beim zuletzt fertigen Schritt weiter (wird der Agent fünfmal mitten in derselben Umwandlung beendet, gibt er sie auf)
- Seite **Umwandlungen** mit Fortschritt, Wartegrund, Abbrechen, aufklappbarer **Auslastung des Servers** (dieselbe Anzeige
  wie im Dashboard, mit dem Anteil der Umwandlung zuerst) und der Ausgabe des Werkzeugs bei Fehlern; danach meldet
  der Agent die neue Datei an Jellyfin, damit sie gleich erscheint
- Für Zeitplan und Meldung gibt Manelly dem Agent die Jellyfin-Adresse und den API-Schlüssel (gespeichert in
  `agent\data\settings.json` auf dem Jellyfin-Server)
- Manelly nennt dem Agent jede Datei und jeden Zielordner (aus Jellyfin) – der Agent durchsucht keine Laufwerke, prüft
  vorher den freien Platz (etwa doppelte Dateigrösse) und überschreibt nie eine Datei

Einrichtung: siehe [Agent auf dem Jellyfin-Server](#agent-auf-dem-jellyfin-server-windows).

### Downloads (JDownloader, mit Agent)

Läuft auf dem Jellyfin-Server JDownloader 2, zeigt und steuert Manelly ihn über den Agent:

- Abschnitt **Downloads** im Dashboard (einklappbar): Zustand und Gesamttempo, die Pakete mit Fortschritt, Tempo und
  Restzeit, darunter die fertigen
- **Pausieren, Fortsetzen, Starten, Stoppen** und das **Tempo-Limit** von JDownloader setzen
- **Bremsen, solange jemand streamt** (unter Einstellungen → JDownloader): Beginnt ein Stream, begrenzt der Agent
  JDownloader auf ein Tempo (z. B. 2 MB/s) oder pausiert ihn. Fünf Minuten nach dem letzten Stream stellt er ihn wieder
  so ein wie vorher – auch nach einem Neustart des Servers. Was du in der Zwischenzeit von Hand änderst, bleibt; ein von
  Hand gesetztes Tempo-Limit ist auch das, was danach wieder gilt
- Einrichtung: In JDownloader unter **Einstellungen → Erweiterte Einstellungen** nach «Deprecated» suchen und die
  **Deprecated API** einschalten (die Einstellung «nur localhost» kann eingeschaltet bleiben – der Agent läuft auf
  demselben Rechner). Dann in Manelly unter **Einstellungen → JDownloader** «JDownloader einbinden» wählen; die Adresse
  ist meist `http://127.0.0.1:3128`

### Troubleshooting (Aufzeichnung, mit Agent)

Was lief auf dem Server, als es ruckelte? Unter **Troubleshooting** zeichnet der Agent auf Wunsch rund um die Uhr auf und
Manelly zeigt den Verlauf – das Dashboard bleibt dabei schlank wie bisher:

- **Aufzeichnung starten** auf der Seite Troubleshooting; die Aufbewahrung ist wählbar (7 Tage bis 1 Jahr, ältere Tage
  löscht der Agent selbst). Ein Tag braucht etwa 1 MB im Ordner `agent\data\history`
- Alle 15 Sekunden: **CPU** und **GPU** (gesamt und die Anteile von Jellyfins FFmpeg und der Umwandlung), die gewählten
  **Netzwerkschnittstellen** (Senden und Empfangen) und die Zahl der **Streams** und Transcodes
- Jeder **Stream** mit Start, Ende und jedem Wechsel dazwischen: wer mit welchem Client und Gerät was abgespielt hat,
  wie (Direct Play, Remux, Direct Stream, Transcode) und – bei einem Transcode – **warum**, mit Quelle und Ziel
  (z. B. «HEVC 4K Dolby Vision · TrueHD 7.1 → H.264 1080p · AAC Stereo»)
- Zeitraum von 1 Stunde bis 30 Tage, frei verschiebbar; ein Fadenkreuz zeigt in allen Diagrammen die Werte zur selben
  Zeit. Streams erscheinen als Balken über den Diagrammen und als gestrichelte Linien darin; ein Klick markiert die Zeit
  des Streams überall, «Ausschnitt zeigen» zoomt darauf
- Lief der Agent nicht (Neustart, ausgeschaltet), bleibt eine **Lücke**. Ein Stream, der in dieser Zeit endete, endet in
  der Aufzeichnung, als der Agent ihn zuletzt sah
- Solange nur aufgezeichnet wird und niemand zuschaut, misst der Agent CPU und GPU alle 10 statt alle 3 Sekunden – die
  Messung kostet unter Windows selbst etwas Leistung

### Allgemein

- Hell- und Dunkelmodus (folgt dem System, umschaltbar)
- Hauptmenü links lässt sich zu einer schmalen Icon-Leiste einklappen
- Jellyfin-Verbindung (Adresse und API-Schlüssel) direkt in der Oberfläche einrichten – Manelly testet sie vor dem Speichern
- Verständliche Fehlerhinweise, wenn Jellyfin nicht erreichbar ist oder der API-Schlüssel nicht stimmt

Geplant: weiteres Server-Management (Bibliotheken, geplante Aufgaben, Benutzer) und mehr Troubleshooting (Logs).

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

## Schnellstart unter Windows

Im Manelly-Ordner `scripts\start-windows.cmd` doppelklicken oder in PowerShell ausführen:

```powershell
.\scripts\start-windows.ps1
```

Das Skript installiert bei Bedarf Node.js (LTS) mit `winget` (in Windows 10 und 11 über den «App Installer» enthalten;
Windows fragt dabei eventuell nach Administratorrechten), installiert die Abhängigkeiten, baut Manelly, startet es und
öffnet <http://localhost:3000> im Browser. Beenden mit `Ctrl+C`, ein anderer Port mit
`.\scripts\start-windows.ps1 -Port 3001` (oder `scripts\start-windows.cmd -Port 3001`).

- Blockiert PowerShell das Skript («Die Ausführung von Skripts ist auf diesem System deaktiviert»), `start-windows.cmd`
  verwenden – es erlaubt die Ausführung nur für dieses eine Skript.
- Fehlt `winget`, Node.js (LTS) von <https://nodejs.org> installieren und das Skript erneut starten.
- Ist Node.js installiert, aber `node` wird nicht gefunden (Ordner fehlt im PATH, oder bei nvm-windows fehlt die
  Verknüpfung), findet das Skript die Installation selbst und trägt den Ordner für deinen Benutzer wieder in den PATH ein.
- Beim ersten Start fragt die Windows-Firewall eventuell, ob Node.js Netzwerkzugriff erhält. Für den Zugriff von anderen
  Geräten zulassen; nur auf diesem PC funktioniert Manelly auch ohne.

Update: `git pull`, dann das Skript erneut starten. Die Einstellungen liegen in `data\` und bleiben erhalten.

## Agent auf dem Jellyfin-Server (Windows)

Nötig für die [Umwandlungen](#umwandlungen-mit-agent), die [Aufzeichnung](#troubleshooting-aufzeichnung-mit-agent),
die Auslastung von CPU, GPU und Netzwerk und für [JDownloader](#downloads-jdownloader-mit-agent). Auf dem Windows-PC, auf
dem Jellyfin läuft:

1. Manelly herunterladen (`git clone https://github.com/vb-roughus/Manelly.git`) und im Manelly-Ordner eine
   PowerShell **als Administrator** öffnen, dann den Agent mit Autostart einrichten:

   ```powershell
   .\scripts\start-agent.ps1 -Install
   ```

   Das Skript installiert bei Bedarf Node.js und MKVToolNix mit `winget`, lädt
   [dovi_tool](https://github.com/quietvoid/dovi_tool) (feste Version, Prüfsumme wird kontrolliert) nach `agent\tools`,
   verwendet das ffmpeg von Jellyfin, baut den Agent, gibt Port 8790 in der Windows-Firewall (privates Netzwerk) frei und
   richtet den Autostart ein: Der Agent startet **mit Windows, ohne dass sich jemand anmelden muss** (z. B. nach einem
   nächtlichen Neustart), unsichtbar unter deinem Benutzer. Ohne Administratorrechte startet er erst bei deiner Anmeldung.
   Ohne `-Install` läuft der Agent einfach in diesem Fenster.

   Liegen die Medien auf einer **Netzwerkfreigabe** (`\\nas\filme`), braucht der Autostart dein Windows-Passwort, weil
   Windows ohne Anmeldung sonst nur lokale Laufwerke freigibt:

   ```powershell
   .\scripts\start-agent.ps1 -Install -StorePassword
   ```

   Das Passwort speichert Windows in der Aufgabenplanung; nach einer Passwortänderung den Befehl erneut ausführen.
   Verbundene Laufwerksbuchstaben (`Z:`) gibt es ohne Anmeldung nicht – Jellyfin sollte die Freigaben als `\\nas\…`
   kennen.
2. Das Skript zeigt **Adresse** und **Schlüssel** an. Beides in Manelly unter **Server → Agent** eintragen; Manelly
   zeigt dann, welche Werkzeuge gefunden wurden.

- Konfiguration in `agent\data\agent.json`: `port`, `token` (der Schlüssel), `tools` (Pfade, falls ein Werkzeug nicht
  gefunden wird; `-Install` trägt Werkzeuge ein, die nur über den PATH gefunden werden) und `roots` – eine Liste von Ordnern, auf die der Agent sich beschränken soll (leer: jeder Ordner, den
  Manelly nennt). Nach Änderungen den Agent neu starten.
- Netzwerk: Unter **Einstellungen → Netzwerk des Jellyfin-Servers** die Schnittstellen wählen, die das Dashboard zeigen
  soll. Auf Windows liest der Agent dafür die Zähler von Windows über PowerShell (ein Prozess, solange gemessen wird), auf
  Linux aus `/sys/class/net`.
- Aufzeichnung: `agent\data\history`, eine Datei pro Tag und Art (Messwerte, Streams). Löschen geht auch auf der Seite
  Troubleshooting.
- Protokoll: `agent\data\agent.log`. Entfernen: `.\scripts\start-agent.ps1 -Uninstall` (als Administrator, wegen der
  Firewall-Regel).
- Update: `git pull`, dann `.\scripts\start-agent.ps1 -Install` erneut ausführen (als Administrator). Das Skript beendet
  den laufenden Agent – auch eine ältere Version – und startet den neuen; es meldet erst Erfolg, wenn die neue Version
  antwortet. Bleibt der Port belegt, nennt es das Programm, das ihn hält. Eine laufende Umwandlung wird dabei
  unterbrochen und macht danach weiter.
- Der Agent ist **kein Dienst**: Im Task-Manager steht er unter «Details» als `node.exe`; der Autostart ist die Aufgabe
  «Manelly Agent» in der Aufgabenplanung. Unter **Server → Agent** zeigt Manelly Version, Prozess-ID und Startzeit und
  kann ihn **beenden** (ab Agent 0.7.0). Wieder starten: Windows neu starten, `Start-ScheduledTask -TaskName 'Manelly
  Agent'` (als Administrator) oder das Skript mit `-Install`.

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
| `npm run build`     | Produktions-Build von Frontend, Server und Agent |
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
shared/   API-Typen, die Server, Frontend und Agent gemeinsam nutzen
server/   Fastify-Server: spricht mit der Jellyfin-API und dem Agent, liefert das Frontend aus
web/      React-Frontend (Vite, Tailwind CSS, TanStack Query)
agent/    Agent für den Jellyfin-Server: wandelt Dateien um (ffmpeg, dovi_tool, mkvmerge), ohne Abhängigkeiten
```

Der Browser spricht nur mit dem Manelly-Server, nie direkt mit Jellyfin. Dadurch bleibt der API-Schlüssel auf dem
Server, und Jellyfin muss vom Browser aus nicht erreichbar sein (auch Cover-Bilder werden durchgereicht).

## Sicherheit

Ein Jellyfin-API-Schlüssel hat Administratorrechte. Manelly hat **noch keine eigene Anmeldung** – wer die Oberfläche
öffnen kann, kann auch die Jellyfin-Verbindung ändern und Sammlungen in Jellyfin bearbeiten. (Sammlungen liest Manelly
mit der Sicht eines Jellyfin-Administrators, weil Jellyfin deren Inhalt nur für einen Benutzer auflöst.) Betreibe Manelly daher nur im Heimnetz oder hinter einem Reverse
Proxy mit Authentifizierung und mache es nicht direkt im Internet erreichbar.

Der Agent verlangt bei jeder Anfrage seinen Schlüssel, spricht aber unverschlüsseltes HTTP – gib seinen Port nur im
Heimnetz frei. Er liest und schreibt nur die Dateien und Ordner, die Manelly ihm nennt (auf Wunsch zusätzlich beschränkt
mit `roots`), legt nur eigene Unterordner an und löscht keine Originale. Den Jellyfin-API-Schlüssel, den Manelly ihm für
den Zeitplan gibt, nutzt er nur für die Liste der laufenden Streams und um neue Dateien zu melden. Die Aufzeichnung
enthält, wer wann was geschaut hat, samt IP-Adresse des Clients – sie bleibt auf dem Jellyfin-Server, und jeder, der
Manelly öffnen kann, sieht sie. Die «Deprecated API»
von JDownloader hat keinen Schlüssel – lass sie auf «nur localhost», dann erreicht sie nur der Agent auf demselben Rechner.
