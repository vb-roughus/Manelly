#!/usr/bin/env node
// Stand-in for makemkvcon in robot mode: one DVD drive, its disc described in the JSON file FAKE_MAKEMKV names.
const fs = require('node:fs');
const path = require('node:path');
const statePath = process.env.FAKE_MAKEMKV;
const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { disc: null };
const args = process.argv.slice(2);
const out = (line) => process.stdout.write(`${line}\n`);
const q = (text) => `"${String(text).replace(/"/g, '\\"')}"`;
out('MSG:1005,0,1,"MakeMKV v1.17.7 linux(x64-release) started","%1 started","MakeMKV v1.17.7 linux(x64-release)"');

const DISCS = {
  movie: [
    { duration: '1:58:32', chapters: 28, bytes: state.bytes ?? 600000 },
    { duration: '0:12:05', chapters: 1, bytes: 60000 },
    { duration: '0:00:45', chapters: 1, bytes: 4000 },
  ],
  series: [
    { duration: '1:28:40', chapters: 16, bytes: 480000 },
    { duration: '0:22:10', chapters: 4, bytes: 120000 },
    { duration: '0:22:05', chapters: 4, bytes: 120000 },
    { duration: '0:22:12', chapters: 4, bytes: 120000 },
    { duration: '0:22:13', chapters: 4, bytes: 120000 },
  ],
};

if (args.includes('disc:9999')) {
  const inserted = Boolean(state.disc);
  out(`DRV:0,${inserted ? 2 : 0},999,${inserted ? 1 : 0},${q('DVD-RW Fake Drive')},${q(inserted ? state.label : '')},${q(state.device ?? '/dev/sr0')}`);
  out('DRV:1,256,999,0,"","",""');
  process.exit(0);
}
if (!state.disc) {
  out('MSG:5010,0,0,"Failed to open disc","Failed to open disc"');
  process.exit(1);
}
const titles = DISCS[state.disc];
const command = args.find((arg) => arg === 'info' || arg === 'mkv');
if (command === 'info') {
  out(`PRGT:5018,0,${q('Opening DVD disc')}`);
  out(`PRGC:5018,0,${q('Opening DVD disc')}`);
  out('MSG:3007,0,0,"Using direct disc access mode","x"');
  out('MSG:1011,32,1,"Debug: tracing drive","x"');
  if (state.readError) out(`MSG:2003,0,3,${q(state.readError)},"x"`);
  if (state.readMs) {
    out(`PRGC:5003,0,${q('Scanning contents')}`);
    let step = 0;
    const timer = setInterval(() => {
      step++;
      out(`PRGV:${step * 6553},${step * 6553},65536`);
      if (step < 10) return;
      clearInterval(timer);
      describe();
    }, Math.floor(state.readMs / 10));
  } else describe();
}

function describe() {
  out(`CINFO:1,6206,${q('DVD disc')}`);
  out(`CINFO:2,0,${q(state.label)}`);
  out(`CINFO:32,0,${q(state.label)}`);
  out(`TCOUNT:${titles.length}`);
  titles.forEach((title, index) => {
    out(`TINFO:${index},2,0,${q(state.label)}`);
    out(`TINFO:${index},8,0,${q(title.chapters)}`);
    out(`TINFO:${index},9,0,${q(title.duration)}`);
    out(`TINFO:${index},11,0,${q(title.bytes)}`);
    out(`TINFO:${index},27,0,${q(`title_t0${index}.mkv`)}`);
    out(`SINFO:${index},0,1,6201,"Video"`);
    out(`SINFO:${index},0,6,0,"Mpeg2"`);
    out(`SINFO:${index},0,19,0,"720x576"`);
    out(`SINFO:${index},0,20,0,"16:9"`);
    out(`SINFO:${index},1,1,6202,"Audio"`);
    out(`SINFO:${index},1,3,0,"deu"`);
    out(`SINFO:${index},1,4,0,"German"`);
    out(`SINFO:${index},1,6,0,"AC3"`);
    out(`SINFO:${index},1,40,0,"5.1(side)"`);
    out(`SINFO:${index},2,1,6202,"Audio"`);
    out(`SINFO:${index},2,3,0,"eng"`);
    out(`SINFO:${index},2,4,0,"English"`);
    out(`SINFO:${index},2,6,0,"AC3"`);
    out(`SINFO:${index},2,40,0,"stereo"`);
    out(`SINFO:${index},3,1,6203,"Subtitles"`);
    out(`SINFO:${index},3,3,0,"deu"`);
    out(`SINFO:${index},3,4,0,"German"`);
  });
  process.exit(0);
}
if (command === 'mkv') {
  const title = Number(args[args.length - 2]);
  const directory = args[args.length - 1];
  const bytes = titles[title].bytes;
  const steps = 10;
  out(`PRGT:5018,0,${q('Opening DVD disc')}`);
  out('PRGV:0,65536,65536');
  out(`PRGT:5017,0,${q('Saving to MKV file')}`);
  if (state.fail) {
    out(`MSG:5003,0,2,${q(`Failed to save title ${title} to file ${directory}`)},"x"`);
    process.exit(1);
  }
  if (state.noFile) {
    out(`MSG:5037,0,2,${q('Copy complete. 0 titles saved, 1 failed.')},"x"`);
    process.exit(0);
  }
  const file = path.join(directory, `${state.label}_t0${title}.mkv`);
  let step = 0;
  const timer = setInterval(() => {
    step++;
    fs.appendFileSync(file, Buffer.alloc(Math.floor(bytes / steps)));
    out(`PRGV:${step * 6553},${step * 6553},65536`);
    if (step < steps) return;
    clearInterval(timer);
    out(`MSG:5036,0,1,${q('Copy complete. 1 titles saved.')},"x"`);
    process.exit(0);
  }, Math.max(1, Math.floor((state.ripMs ?? 50) / steps)));
} else if (command !== 'info') {
  process.exit(2);
}
