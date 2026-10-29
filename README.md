# Manelly

Ein Web-Tool für deinen [Jellyfin](https://jellyfin.org)-Server: Server-Management, Medien durchsuchen und
Troubleshooting an einem Ort.

## Funktionen

Aufklappbares – Menügruppen wie **Umwandlungen** und **Server**, Abschnitte im Dashboard, Filter, Staffeln, Pfade – ist
nach jedem Laden der Seite eingeklappt. Eine eingeklappte Menügruppe zeigt, wenn eine ihrer Seiten offen ist. Im Menü
ist immer nur eine Gruppe offen: Öffnet man eine andere, klappt die vorherige zu; beides gleitet animiert auf und zu (auf
dem Handy seitwärts). Auch der Wechsel zu einer anderen Seite ist animiert: Die bisherige blendet aus, die neue gleitet
herein, das Menü bleibt stehen (in Browsern mit View Transitions; mit «Bewegung reduzieren» ohne Animation). Die Reiter
von JDownloader gleiten je nach Richtung von rechts oder links herein.

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
  eingeklappt (die Überschrift zeigt, wie viele laufen) – ein Klick klappt den Abschnitt auf
- Ein Klick auf die Kachel **Transcodes** zeigt die **Auslastung des Servers** (mit Agent): CPU und GPU (pro Einheit wie
  Video-Dekodierung, Video-Kodierung, Videoverarbeitung, 3D), jeweils mit dem Anteil von Jellyfins FFmpeg und einer
  laufenden Umwandlung, einem Verlauf der letzten 10 Minuten und den einzelnen FFmpeg-Prozessen. Der Agent misst nur,
  solange die Anzeige offen ist (danach noch 10 Minuten). GPU-Werte gibt es auf Windows 10/11 für jede Grafikkarte mit
  aktuellem Treiber, auf Linux nur für AMD und ohne Anteil pro Prozess
- Ein Klick auf die Kachel **Bandbreite** klappt die Details auf: die aktuelle Bitrate jedes Streams (gesamt und davon
  nach extern) und darunter das **Netzwerk des Jellyfin-Servers** (mit Agent): Senden und Empfangen der unter
  Einstellungen gewählten Schnittstellen mit ihren Rollen, Auslastung gemessen an der Link-Geschwindigkeit (ab 70 % gelb, ab 90 % rot) und
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
- Detailansicht mit allen Tonspuren und der Dateigrösse jeder Version bzw. den Tonspuren jeder Folge und Link zum Titel in Jellyfin;
  bei einer Serie scannt **«Diese Serie scannen»** nur ihren Ordner (siehe unten)
- **Treffer in eine Sammlung übernehmen:** alle Titel der aktuellen Suche zu einer bestehenden Jellyfin-Sammlung
  hinzufügen oder eine neue anlegen. Manelly zeigt vorher, wie viele schon drin sind, und fügt nur die fehlenden hinzu
- Tonspur- und Video-Filter sind eingeklappt und zeigen dann eine Zusammenfassung, z. B. «4K · Dolby Vision · HEVC»
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

**Mediatheken scannen:** Neben «Neu einlesen» öffnet «Mediatheken scannen» ein Menü: **Alle Mediatheken** startet den
Scan aller Mediatheken in Jellyfin (dieselbe Aufgabe «Medienbibliothek scannen» wie in Jellyfins Dashboard), ein Klick
auf eine einzelne Mediathek scannt **nur diese** – viel schneller, wenn andere gross sind, etwa Serien mit vielen
Ordnern. Jellyfin sucht in den Ordnern nach neuen, geänderten und gelöschten Dateien, Manelly zeigt den Fortschritt im
Knopf. Ist der Scan fertig – auch einer aller Mediatheken, der in Jellyfin selbst gestartet wurde –, liest Manelly die
Medien sofort neu ein, sodass neue Titel gleich auftauchen. Den Scan einer einzelnen Mediathek kann Jellyfin nicht
abbrechen.

**Einzelne Serie scannen:** Bei Serien-Mediatheken bietet das Menü zusätzlich **Einzelne Serie …**: Serie und, wenn sie
Staffelordner hat, auf Wunsch eine Staffel wählen (beides aus Jellyfin, mit dem Ordner dazu) – Jellyfin sucht dann nur
in diesem Ordner nach neuen, geänderten und gelöschten Dateien, meist in Sekunden statt Minuten. Dasselbe macht
«Diese Serie scannen» in der Detailansicht einer Serie. Jellyfin meldet für diesen Scan keinen Fortschritt; Manelly liest
die Medien nach einer halben und nach zwei Minuten neu ein. Eine ganz neue Serie, deren Ordner Jellyfin noch nicht
kennt, findet nur der Scan der Mediathek.

### Server

Im Menü öffnet und schliesst «Server» drei Seiten: **Allgemein**, **Agent** und **JDownloader**.

- **Allgemein – Manelly selbst:** Stand (Git-Commit), Rechner, Prozess-ID, Startzeit und das letzte Update; Manelly
  **neu starten** oder **aktualisieren und neu starten** – siehe [Manelly aktualisieren](#manelly-aktualisieren)
- **Allgemein – Mediatheken:** die Mediatheken von Jellyfin mit ihren Ordnern, wann der letzte Scan aller Mediatheken
  lief und wie er ausging; den Scan aller Mediatheken **starten** und **abbrechen**, mit Fortschritt in Prozent; mit
  «Scannen» bei einer Mediathek nur diese scannen, mit eigenem Fortschritt; bei Serien-Mediatheken mit «Serie …» nur
  eine einzelne Serie oder Staffel
- **Allgemein – Hardware-Beschleunigung prüfen:** Einstellungen von Jellyfin im Überblick (Beschleunigung, Hardware-Kodierung,
  Hardware-Dekodierung, HEVC 10 bit, Tone-Mapping, FFmpeg) mit Hinweisen, was nicht passt – z. B. HEVC nicht für die
  Hardware-Dekodierung eingeschaltet (Jellyfins Standard) oder eine Beschleunigung, die es auf dem System nicht gibt
- **Letzte Transcodes** aus den FFmpeg-Protokollen: dekodiert/kodiert in Hardware oder Software, Fehlermeldungen
- **Hardware testen** (mit [Agent](#agent-auf-dem-jellyfin-server-windows)): Das FFmpeg von Jellyfin kodiert und
  dekodiert auf dem Server ein paar Sekunden Testbild mit der eingestellten Beschleunigung – so zeigt sich, ob Treiber und
  Grafikeinheit wirklich funktionieren
- **Agent:** Verbindung zum [Agent](#agent-auf-dem-jellyfin-server-windows) einrichten, seine Werkzeuge, Version,
  Prozess-ID, Startzeit, die Netzlaufwerke (mit **Anmeldedaten fürs NAS**, siehe Agent-Installation) und das letzte
  Update sehen, ihn **neu starten**, **aktualisieren und neu starten** oder
  **beenden**. Aktualisieren sucht zuerst eine neuere Version (`git fetch`) und lässt alles, wie es ist, wenn es keine
  gibt; sonst holt es sie mit `git pull`, installiert bei Bedarf die Abhängigkeiten und baut den Agent, **während er
  weiterläuft**, und startet ihn erst danach neu. Jeder Schritt erscheint auf der Seite, auch nach einem Neuladen oder in
  einem anderen Browser; klappt etwas nicht, läuft die bisherige Version weiter
- **JDownloader:** Downloads und Link Grabber, Einstellungen hinter dem Zahnrad – siehe [Downloads](#downloads-jdownloader-mit-agent)

### Umwandlungen (mit Agent)

Dolby Vision **Profil 7** (UHD-Blu-ray-Remuxe) spielen viele Geräte nicht ab, Profil 8.1 schon. Ein kleiner Agent auf dem
Jellyfin-Server wandelt solche Dateien direkt dort um. Im Menü ist **Umwandlungen** aufklappbar: **Übersicht** (laufende
und fertige Umwandlungen), **Backups** (die im Arbeitsordner behaltenen Originale) und **Einstellungen** (Zeitplan,
Arbeitsordner, Kopieren begrenzen).

- In den Medien mit dem Filter **«Dolby Vision P7»** die Kandidaten finden, Titel öffnen, **«In Profil 8.1 umwandeln»**
- Speicherort wählen: **neben dem Original** (Jellyfin zeigt beide als Versionen), **Original ersetzen** (das Original
  wandert in einen Backup-Ordner `.manelly-backup`, den Jellyfin ignoriert; mit Arbeitsordner siehe unten) oder **ein anderer Ordner** einer
  Jellyfin-Bibliothek (z. B. eine UHD-Bibliothek), mit Unterordner und Dateiname. Speicherort, «Wo umwandeln» und «Wann»
  sind Auswahllisten; vorgewählt ist, was bei der letzten Umwandlung in diesem Browser gewählt war (soweit es passt)
- Der Agent löst die Videospur heraus (ffmpeg), wandelt die Dolby-Vision-Daten um (`dovi_tool -m 2 convert --discard`) und
  setzt die Datei mit allen Ton- und Untertitelspuren, Kapiteln und Anhängen neu zusammen (mkvmerge). Das Bild wird nicht
  neu kodiert; der Enhancement Layer fällt weg (bei «FEL»-Dateien geht dessen Zusatzinformation verloren)
- **Arbeitsordner** (ab Agent 0.17.0): Unter **Umwandlungen → Einstellungen** einen Ordner auf einer schnellen Platte des
  Jellyfin-Servers eintragen (z. B. `E:\Manelly` auf einer zusätzlichen SSD; den Ordner zuerst anlegen). Im
  Umwandlungsdialog ist dann **«Im Arbeitsordner»** vorgewählt: Der Agent kopiert das Original dorthin, wandelt dort um und
  kopiert das Ergebnis zurück – an den gewählten Speicherort, wie oben. Der Speicher, auf dem die Filme liegen (z. B. das
  NAS), wird so nur beim Hin- und Zurückkopieren belastet statt während der ganzen Umwandlung. Im Arbeitsordner braucht es
  etwa die dreifache Dateigrösse, am Ziel nur noch die einfache. Das Kopieren zeigt Fortschritt, lässt sich pausieren und
  macht nach einer Unterbrechung dort weiter, wo es war. **«Direkt am Speicherort»** wandelt wie bisher dort um, wo die Datei
  liegt
- **Platz im Arbeitsordner:** Unter **Umwandlungen → Einstellungen** zeigt ein Balken, wie voll die Platte des
  Arbeitsordners ist – frei, Gesamtgrösse (ab Agent 0.25.0), wie viel davon die **Backups** belegen, und bis zu welcher
  Filmgrösse der Platz für eine Umwandlung reicht. Unter 20 % frei wird der Balken gelb, unter 10 % rot
- **Kopieren begrenzen** (ab Agent 0.21.0, in Mbit/s ab Agent 0.23.0): Unter **Umwandlungen → Einstellungen** beim Arbeitsordner einstellen, wie schnell das Hin- und Zurückkopieren sein
  darf, damit auf dem Speicher genug für Streams bleibt. **Automatisch während Streams**: einmal eintragen, was der
  Speicher insgesamt schafft (den gemessenen Höchstwert, z. B. 1600 Mbit/s; zu sehen bei einer Umwandlung unter «Auslastung
  der Storage-Schnittstelle», «Zusammen»). Solange jemand streamt, kopiert der Agent höchstens mit 85 % dieses Werts
  − Bitrate der laufenden Streams (geschätzt aus ihren Dateien) − 20 Mbit/s Reserve, mindestens aber mit 8 Mbit/s; ohne
  Streams mit voller Geschwindigkeit. Die 15 % Luft (ab Agent 0.24.0) braucht es, weil ein Stream seine Datei in vielen
  kleinen Stücken liest: Ist der Speicher fast voll ausgelastet, wartet jedes Stück hinter den grossen Blöcken der Kopie,
  und der Stream stockt, obwohl die Summe der Bitraten noch passt. Dazu zählt der gemessene Höchstwert auch den
  Netzwerk-Overhead mit, das Limit nur die Dateidaten.
  Ein Limit, das ein älterer Agent in MB/s gespeichert hat, rechnet der Agent beim Update in Mbit/s um.
  Er fragt Jellyfin dafür alle 15 Sekunden, und nur während er kopiert; weiss er nichts über Streams, rechnet er mit einem
  UHD-Stream. **Immer**: ein festes Limit. Die Umwandlungskarte zeigt, wenn und warum gerade gebremst wird. Die
  Umwandlungsschritte im Arbeitsordner selbst und «Direkt am Speicherort» sind nicht begrenzt
- **Originale im Arbeitsordner** (ab Agent 0.18.0): Bei **«Original ersetzen»** im Arbeitsordner kommt das Original nicht in
  `.manelly-backup` auf dem Speicher, sondern bleibt als die Kopie, die schon im Arbeitsordner liegt, in dessen Unterordner
  `Originale`. Auf dem Speicher wird es erst ganz am Schluss gegen die umgewandelte Datei getauscht – bis dahin spielt
  Jellyfin es normal ab. Hat sich das Original während der Umwandlung verändert, bleibt es, wie es ist. **Umwandlungen →
  Backups** listet diese Originale mit Herkunft, Grösse und Alter: länger als 30 Tage aufbewahrt **gelb**, länger
  als 90 Tage **rot**. Passt das Ergebnis, dort **«Löschen»** (mit Rückfrage). Der Agent löscht nur Originale, die er
  selbst dort abgelegt hat. «Neben dem Original» und «Anderer Ordner» lassen das Original auf dem Speicher
- **Sofort** oder **nach Zeitplan**: Unter **Umwandlungen → Einstellungen** ein Zeitfenster (z. B. 01:00–07:00, Uhrzeit des
  Jellyfin-Servers) und/oder «nur wenn niemand streamt» einstellen. Geplante Umwandlungen startet der Agent selbst, auch
  wenn Manelly nicht läuft. Beginnt ein Stream, pausiert die Umwandlung und macht später beim zuletzt fertigen Schritt
  weiter; nach einem Stream wartet der Agent noch 5 Minuten. Eine laufende Umwandlung darf über das Ende des Zeitfensters
  hinaus fertig werden. **«Jetzt starten»** übergeht den Zeitplan.
- **Pausieren und Fortsetzen** (ab Agent 0.12.0): «Pausieren» hält das gerade laufende Werkzeug (ffmpeg, dovi_tool oder
  mkvmerge) an Ort und Stelle an – es braucht dann keine Rechenzeit und keine Plattenzugriffe mehr –, «Fortsetzen» lässt es
  genau dort weiterlaufen. Andere Umwandlungen warten so lange. Lässt Windows das Anhalten nicht zu, wird die Umwandlung
  stattdessen unterbrochen und macht beim Fortsetzen beim zuletzt fertigen Schritt weiter. Eine pausierte Umwandlung
  bleibt auch über einen Neustart des Agents pausiert
- Übersteht Neustarts des Servers: Wartende Umwandlungen bleiben eingeplant, eine unterbrochene macht nach dem Neustart
  beim zuletzt fertigen Schritt weiter (wird der Agent fünfmal mitten in derselben Umwandlung beendet, gibt er sie auf)
- **Nie «Fertig» mit einer unvollständigen Datei** (ab Agent 0.22.0): Nach dem Zusammensetzen prüft der Agent, ob die neue
  Datei so lange läuft wie das Original, und nach jedem Kopieren, ob die Kopie gleich gross ist. Stimmt etwas nicht,
  schlägt die Umwandlung mit einer Meldung fehl und das Original bleibt, wie es ist
- **Umwandlungen → Übersicht** mit Dateigrösse (ab Agent 0.20.0; auch im Dashboard), Dauer einer fertigen Umwandlung – so
  lässt sich abschätzen, wie lange die nächste dauert –, Fortschritt mit dem aktuellen Tempo des laufenden Schritts in Mbit/s
  (ab Agent 0.21.0; gemessen daran, wie schnell die Datei wächst, die der Schritt schreibt), Wartegrund, Pausieren, Abbrechen, aufklappbarer **Auslastung der
  Storage-Schnittstelle** und der Ausgabe des Werkzeugs bei Fehlern; danach meldet der Agent die neue Datei an Jellyfin,
  damit sie gleich erscheint. Eine Umwandlung kodiert das Bild nicht neu, sie kopiert vor allem – CPU und GPU haben
  wenig zu tun, das Tempo bestimmt der Weg zum Speicher. Darum zeigt die Karte Lesen, Schreiben und beides zusammen
  (in Mbit/s) der Schnittstelle(n) mit der Rolle **Storage** (ab Agent 0.19.0, siehe [Rollen](#agent-auf-dem-jellyfin-server-windows)),
  die Auslastung gemessen am Link und den Verlauf der letzten 10 Minuten
- Für Zeitplan und Meldung gibt Manelly dem Agent die Jellyfin-Adresse und den API-Schlüssel (gespeichert in
  `agent\data\settings.json` auf dem Jellyfin-Server)
- Manelly nennt dem Agent jede Datei, jeden Zielordner (aus Jellyfin) und den Arbeitsordner – der Agent durchsucht keine
  Laufwerke, prüft vorher den freien Platz (direkt etwa doppelte Dateigrösse, mit Arbeitsordner siehe oben) und
  überschreibt nie eine Datei

Einrichtung: siehe [Agent auf dem Jellyfin-Server](#agent-auf-dem-jellyfin-server-windows).

### Downloads (JDownloader, mit Agent)

Läuft auf dem Jellyfin-Server JDownloader 2, zeigt und steuert Manelly ihn über den Agent:

- Abschnitt **Downloads** im Dashboard (eingeklappt, ein Klick klappt ihn auf): Zustand und Gesamttempo, die Pakete mit Fortschritt, Tempo und
  Restzeit, darunter die fertigen
- **Entpacken** nach dem Download (ab Agent 0.10.0): Ein Paket, dessen Archive JDownloader gerade entpackt, bleibt
  oben in der Liste, mit «Entpacken 40 %» und blauem Balken; schlägt das Entpacken fehl (z. B. falsches Passwort),
  steht es rot mit dem Grund von JDownloader da. Erfolgreich entpackte Pakete zählen zu den fertigen («entpackt»)
- Seite **Server → JDownloader** mit drei Reitern:
  - **Downloads:** alle Pakete; ein Klick auf ein Paket klappt seine **einzelnen Dateien (Parts)** auf, jede mit
    Fortschritt, Tempo, Restzeit, Status und ob sie entpackt ist; «Fertige ausblenden» zeigt nur die Dateien, die noch
    nicht fertig sind (die Wahl gilt auch für die nächsten Pakete). Die fertigen Pakete klappen ebenfalls auf.
    **Starten, Stoppen, Pausieren, Fortsetzen** und das **Tempo-Limit** von JDownloader
    überschreiben (gilt sofort, auch während des Bremsens beim Streamen). Tempo und Limits zeigt Manelly in Mbit/s, wie
    alle Datenraten
  - **Link Grabber:** was JDownloader gesammelt hat, nach Paketen, mit dem Status jedes Links (online, offline,
    unbekannt) und ob er noch sammelt. Pakete und – im aufgeklappten Paket – einzelne Links **per Häkchen auswählen**
    (z. B. ein Paket ohne seinen Offline-Teil) und mit «Auswahl in die Downloads» übernehmen; ein Paket mit seinem
    Knopf oder alle auf einmal gehen auch direkt.
    **DLC-Dateien** (ab Agent 0.15.0) mit «DLC hochladen» auswählen oder auf den Link Grabber ziehen, auch mehrere
    auf einmal (je höchstens 1 MB): Manelly gibt sie über den Agent an JDownloader weiter, der sie entschlüsselt – die
    Pakete erscheinen ein paar Sekunden später im Link Grabber
  - **Premium-Accounts** (ab Agent 0.13.0): die in JDownloader eingerichteten Accounts mit Hoster, Benutzer und Zustand
    (aktiv, vorübergehend gesperrt, abgelaufen, ungültig, ausgeschaltet), dem **restlichen Traffic** (mit Balken, oder
    «unbegrenzt») und wie lange das **Premium** noch läuft (rot ab sieben Tagen). «Neu prüfen» lässt JDownloader die
    Hoster sofort nach den aktuellen Werten fragen
  - **Extracted** (ab Agent 0.26.0): was im **Entpack-Ordner** liegt, das zuletzt Entpackte zuoberst – mit Grösse, Anzahl
    Dateien und Zeitpunkt; Ordner klappen auf und zeigen ihren Inhalt (Filme, Untertitel, Samples …). Den Entpack-Ordner
    legst du in den Einstellungen fest (so wie beim Archiv-Entpacker von JDownloader eingestellt, z. B. `D:\Downloads\Entpackt`
    oder `\\NAS\Downloads\Entpackt`). Der Agent liest nur diesen Ordner und nur, solange der Reiter offen ist (jede Minute neu).
    **Move to Library** (ab Agent 0.27.0): Ordner und Dateien ankreuzen (ein angekreuzter Ordner nimmt alles darin mit),
    dann im Dialog die Mediathek wählen – jede mit ihrem Ordner aus Jellyfin dahinter. Bei einer Serien-Mediathek folgt
    die **Serie** (aus Jellyfin, mit dem Ordner, in dem Jellyfin sie führt; vorgeschlagen nach dem Namen, z. B. «The
    Expanse S06» → The Expanse) und, wenn die Serie Staffelordner hat, die **Staffel** (für einzelne Folgen wie
    «S05E11» schlägt Manelly die passende vor). Für eine **neue Serie** gibst du den Namen des Serienordners an
    (ab Agent 0.28.0; vorgeschlagen aus dem Namen, z. B. «Dark.2017.S01.German.1080p» → «Dark (2017)»): Der Agent legt
    ihn in der Mediathek an und verschiebt die Einträge hinein. Gibt es die Serie in Jellyfin schon, weist der Dialog
    darauf hin. Mit einem älteren Agent kommt der Ordner als neue Serie direkt in die Mediathek. Unten steht der
    Zielordner. Als Ziel taugen nur Ordner, die Jellyfin selbst nennt. Auf derselben Platte ist das ein Umbenennen und sofort fertig; sonst kopiert der Agent im Hintergrund (mit
    Fortschritt und Tempo, so schnell, wie das Kopier-Limit der Umwandlungen es während Streams erlaubt) und löscht erst
    danach im Entpack-Ordner. Was es am Ziel schon gibt, bleibt unangetastet und wird gemeldet. Jellyfin erfährt gleich
    von den neuen Ordnern. Ein Neustart des Agents fragt nach, solange etwas verschoben wird.
    **Check for Samples** sucht im ganzen Entpack-Ordner nach Dateien mit «sample» im Namen und zeigt sie mit Ordner und
    Grösse; angekreuzt sind alle bis 1 GB (grössere sind selten ein Sample). Nach der Kontrolle löscht «Samples löschen»
    die angekreuzten – nur Dateien mit «sample» im Namen – und einen Sample-Ordner, der dabei leer wird
- Die Einstellungen liegen hinter dem **Zahnrad** oben rechts auf dieser Seite: einbinden, Adresse, Entpack-Ordner und das
  Bremsen beim Streamen
- **Bremsen, solange jemand streamt** (in den JDownloader-Einstellungen): Beginnt ein Stream, begrenzt der Agent
  JDownloader auf ein Tempo (z. B. 16 Mbit/s) oder pausiert ihn. Fünf Minuten nach dem letzten Stream stellt er ihn wieder
  so ein wie vorher – auch nach einem Neustart des Servers. Was du in der Zwischenzeit von Hand änderst, bleibt; ein von
  Hand gesetztes Tempo-Limit ist auch das, was danach wieder gilt
- Einrichtung: In JDownloader unter **Einstellungen → Erweiterte Einstellungen** nach «Deprecated» suchen und die
  **Deprecated API** einschalten (die Einstellung «nur localhost» kann eingeschaltet bleiben – der Agent läuft auf
  demselben Rechner). Dann in Manelly unter **Server → JDownloader** über das Zahnrad «JDownloader einbinden» wählen; die Adresse
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

Update: in Manelly unter **Server → Allgemein** «Aktualisieren & neu starten» (siehe
[Manelly aktualisieren](#manelly-aktualisieren)), oder von Hand `git pull` und das Skript erneut starten. Die
Einstellungen liegen in `data/` und bleiben erhalten.

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

Update: in Manelly unter **Server → Allgemein** «Aktualisieren & neu starten» (siehe
[Manelly aktualisieren](#manelly-aktualisieren)), oder von Hand `git pull` und das Skript erneut starten. Die
Einstellungen liegen in `data\` und bleiben erhalten.

## Manelly aktualisieren

Läuft Manelly über `scripts/start-mac.sh` oder `scripts\start-windows.cmd`, aktualisiert es sich unter **Server →
Allgemein** selbst:

1. **Neuere Version suchen** (`git fetch`): Gibt es keine, bleibt alles, wie es ist – kein Neustart.
2. **Änderungen holen** (`git pull`), **Abhängigkeiten installieren** (`npm ci`, nur wenn sie sich geändert haben) und
   **bauen** – währenddessen läuft Manelly weiter.
3. **Neu starten:** Manelly beendet sich, das Start-Skript startet es gleich wieder, und die Seite lädt neu.

Die Seite zeigt jeden Schritt, auch nach einem Neuladen. Solange Manelly neu startet, zeigen alle Seiten den letzten
Stand statt Fehlermeldungen; danach das Ergebnis. Klappt ein Schritt nicht (z. B. eigene Änderungen im Ordner, die
`git pull` verhindern), läuft die bisherige Version weiter, und die Seite sagt, woran es lag. «Neu starten» allein
startet Manelly neu, ohne zu aktualisieren. Das Start-Skript muss dafür weiterlaufen; mit `Ctrl+C` beendest du Manelly
wie bisher. In Docker oder mit `npm start` geht das nicht – dort `git pull` und neu starten bzw.
`docker compose up -d --build`.

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

   Liegen die Medien auf einem **Netzlaufwerk** (`Z:`) oder einer **Netzwerkfreigabe** (`\\nas\filme`), hat der
   Autostart ohne Anmeldung keine Anmeldedaten fürs Netzwerk (die Umwandlung meldet dann «nicht erreichbar» bzw.
   «Kein Zugriff»), und verbundene Laufwerksbuchstaben gibt es ohne Anmeldung auch nicht. Der Agent verbindet deshalb
   die Netzlaufwerke, die Windows für dich gespeichert hat, selbst wieder, sobald eine Umwandlung sie braucht (und
   gleich beim Start). Die Anmeldung dafür gibst du in Manelly unter **Server → Agent** bei den **Netzlaufwerken** an
   (ab Agent 0.16.0): «Anmeldedaten hinterlegen» beim NAS, Benutzername und Passwort **des NAS** eintragen, «Speichern &
   verbinden». Manelly reicht beides nur an den Agent weiter und speichert nichts davon; der Agent speichert das
   Passwort mit Windows DPAPI verschlüsselt (nur auf diesem Rechner lesbar) und verbindet damit die Laufwerke und
   Freigaben dieses NAS – auch im Autostart ohne Anmeldung. Dort steht auch, welche Laufwerke er erreicht und warum
   nicht. Das Passwort reist dabei wie der Agent-Schlüssel unverschlüsselt durchs Heimnetz (HTTP).

   Früher half `.\scripts\start-agent.ps1 -Install -StorePassword` (Windows-Passwort in der Aufgabenplanung); das
   klappt nicht überall, weil Windows die gespeicherten Netzwerk-Anmeldedaten einem Autostart nicht immer gibt. Der
   Agent läuft so oder so als dein normaler Benutzer, nicht als Administrator.
2. Das Skript zeigt **Adresse** und **Schlüssel** an. Beides in Manelly unter **Server → Agent** eintragen; Manelly
   zeigt dann, welche Werkzeuge gefunden wurden.

- Konfiguration in `agent\data\agent.json`: `port`, `token` (der Schlüssel), `tools` (Pfade, falls ein Werkzeug nicht
  gefunden wird; `-Install` trägt Werkzeuge ein, die nur über den PATH gefunden werden) und `roots` – eine Liste von Ordnern, auf die der Agent sich beschränken soll (leer: jeder Ordner, den
  Manelly nennt). Nach Änderungen den Agent neu starten.
- Netzwerk: Unter **Einstellungen → Netzwerk des Jellyfin-Servers** die Schnittstellen wählen, die das Dashboard zeigen
  soll, und ihnen **Rollen** geben (ab Agent 0.19.0): **Streaming** (zu den Abspielgeräten), **Management** (Verwaltung,
  z. B. Manelly) und **Storage** (zum Speicher mit den Filmen, z. B. dem NAS – diese zeigt Manelly bei den Umwandlungen).
  Hat der Server nicht für alles eine eigene Schnittstelle, bekommt eine Schnittstelle mehrere Rollen. Auf Windows liest
  der Agent die Zähler von Windows über PowerShell (ein Prozess, solange gemessen wird), auf Linux aus `/sys/class/net`.
- Aufzeichnung: `agent\data\history`, eine Datei pro Tag und Art (Messwerte, Streams). Löschen geht auch auf der Seite
  Troubleshooting.
- Protokoll: `agent\data\agent.log`. Entfernen: `.\scripts\start-agent.ps1 -Uninstall` (als Administrator, wegen der
  Firewall-Regel).
- Neu starten und Aktualisieren fragen nach, wenn gerade eine Umwandlung läuft (ab Agent 0.22.0 auch der Agent selbst):
  Ein Neustart unterbricht sie; danach macht sie weiter – eine Kopie dort, wo sie war, ein anderer Schritt von vorne. Startet eine Umwandlung erst, während
  ein Update baut, wartet der Neustart, bis sie fertig ist
- Update: in Manelly unter **Server → Agent** «Aktualisieren & neu starten» (ab Agent 0.9.0). Ab Agent 0.11.0 sucht
  der Agent zuerst eine neuere Version und startet nur neu, wenn es eine gibt; `git pull`, falls nötig `npm ci`, und den
  Build erledigt er, während er weiterläuft, und meldet dabei jeden Schritt. Neu starten lässt ihn danach
  `scripts\run-agent.ps1`, unter dem er läuft (ältere Agents aktualisiert dieses Skript nach dem Beenden). Scheitert
  ein Schritt, läuft die bisherige Version weiter; das Ergebnis steht auf derselben Seite und in `agent\data\agent.log`.
  Solange der Agent neu startet, zeigt Manelly auf allen Seiten den letzten Stand und **keine Fehlermeldungen** des
  Agents, nur einen Hinweis oben. Erst wenn er zurück ist – oder nach 2 Minuten (beim Aktualisieren nach 10) nicht –,
  erscheint das Ergebnis, auch auf anderen Seiten: ein Erfolg verschwindet nach ein paar Sekunden, ein Fehler bleibt,
  bis du ihn schliesst. «Nicht mehr warten» beendet das Warten vorher.
  Ältere Agents (und Änderungen am Installationsskript) brauchen einmal `git pull` und `.\scripts\start-agent.ps1 -Install`
  (als Administrator). Das Skript beendet den laufenden Agent – auch eine ältere Version – und startet den neuen; es
  meldet erst Erfolg, wenn die neue Version antwortet. Bleibt der Port belegt, nennt es das Programm, das ihn hält. Eine
  laufende Umwandlung wird dabei unterbrochen und macht danach weiter.
- Der Agent ist **kein Dienst**: Im Task-Manager steht er unter «Details» als `node.exe` (gestartet von einer
  `powershell.exe` mit `run-agent.ps1`); der Autostart ist die Aufgabe «Manelly Agent» in der Aufgabenplanung. Unter
  **Server → Agent** zeigt Manelly Version, Prozess-ID und Startzeit und kann ihn **beenden** (ab Agent 0.7.0). Wieder starten: Windows neu starten, `Start-ScheduledTask -TaskName 'Manelly
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
