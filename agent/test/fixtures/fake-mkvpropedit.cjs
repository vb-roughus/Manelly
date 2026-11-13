#!/usr/bin/env node
// Stand-in for mkvpropedit: sets default flags in the JSON "Matroska file" of fake-mkvmerge.cjs.
const fs = require('node:fs');
const [file, ...args] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--edit') continue;
  const number = Number(args[i + 1].replace('track:@', ''));
  const [name, value] = args[i + 3].split('=');
  const track = data.tracks.find((entry) => entry.properties.number === number);
  if (!track || name !== 'flag-default') {
    console.error(`Error: no track ${args[i + 1]}`);
    process.exit(2);
  }
  track.properties.default_track = value === '1';
  i += 3;
}
fs.writeFileSync(file, JSON.stringify(data));
