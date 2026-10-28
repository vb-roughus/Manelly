# Manelly – Hinweise für Claude

## Arbeitsweise

- Jede Änderung über einen Pull Request auf `main` und den PR **sofort squash-mergen**, sobald die CI grün ist
  (ausdrücklicher Wunsch des Repo-Besitzers). So holt `git pull` auf `main` immer den neuesten Stand.
- Keinen Mock- oder Demo-Server ins Repo aufnehmen. Tests nutzen ein Fake-`fetch` in der Testdatei.
- UI-Texte und README auf Deutsch in Schweizer Schreibweise («ss» statt «ß»), Code und Kommentare auf Englisch.
- Datenraten (Tempo, Limits, Auslastung) immer in bit/s anzeigen und eingeben lassen (Mbit/s, Gbit/s), nicht in MB/s –
  ausser der Besitzer wünscht es ausdrücklich anders. Dateigrössen bleiben in Bytes (MB, GB).

## Befehle

- Vor jedem Push: `npm run typecheck`, `npm test`, `npm run build`
- Entwicklung: `npm run dev` (Server auf Port 3000, Vite auf Port 5173)
