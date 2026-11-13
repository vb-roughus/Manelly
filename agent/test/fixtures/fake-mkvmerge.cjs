#!/usr/bin/env node
// Stand-in for mkvmerge: a "Matroska file" here is JSON with its tracks and some padding; -J describes it, -o writes
// it anew with --default-track-flag and --track-order applied.
const fs = require('node:fs');
const args = process.argv.slice(2);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
if (args[0] === '-J') {
  let file;
  try {
    file = read(args[1]);
  } catch {
    process.stdout.write(JSON.stringify({ errors: ['The type of file could not be recognized.'] }));
    process.exit(2);
  }
  process.stdout.write(JSON.stringify({ container: { type: 'Matroska' }, tracks: file.tracks }));
  process.exit(0);
}
if (args[0] === '-o') {
  if (process.env.FAKE_MKVMERGE_FAIL) {
    console.error('Error: no space left on device');
    process.exit(2);
  }
  const output = args[1];
  const input = read(args[args.length - 1]);
  const flags = new Map();
  let order = null;
  for (let i = 2; i < args.length - 1; i++) {
    if (args[i] === '--default-track-flag') {
      const [id, value] = args[++i].split(':');
      flags.set(Number(id), value === '1');
    } else if (args[i] === '--track-order') order = args[++i].split(',').map((entry) => Number(entry.split(':')[1]));
  }
  let tracks = input.tracks.map((track) => ({ ...track, properties: { ...track.properties, default_track: flags.has(track.id) ? flags.get(track.id) : track.properties.default_track } }));
  if (order) tracks = order.map((id) => tracks.find((track) => track.id === id));
  tracks = tracks.map((track, index) => ({ ...track, id: index, properties: { ...track.properties, number: index + 1 } }));
  fs.writeFileSync(output, JSON.stringify({ ...input, tracks }));
  process.exit(0);
}
console.error(`unexpected ${args.join(' ')}`);
process.exit(2);
