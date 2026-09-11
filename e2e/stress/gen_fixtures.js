#!/usr/bin/env node
/* Stress fixture generator — real multi-GB logcat files with exact expectations.
 *
 *   node e2e/stress/gen_fixtures.js          (writes e2e/stress/_big/*.log + expectations.json)
 *   KEEP=1 node ...                          (keep existing files: skip if expectations exist)
 *
 * Files: stress_a.log (2 GB, marker + gap), stress_b.log (2 GB, plain), stress_c.log (1.5 GB, boot reset).
 * Line:  `MM-DD HH:MM:SS.mmm  1234  5678 L TagN : STRESS line DDDDDDDDD latency 12ms`
 *        + every 1000th line carries a VIN (search/mask target).
 * Timestamps advance 1 ms per line from 08-25 00:00:00 (~26.7M lines ≈ 7.4 h per 2 GB file).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.STRESS_DIR || path.join(os.tmpdir(), 'loglens_stress');   // local disk — OneDrive-synced folders starve multi-GB IO
const EXP = path.join(DIR, 'expectations.json');
const GB = 1024 * 1024 * 1024;

function fmtTs(ms) {
  const h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
  return '08-25 ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(f).padStart(3, '0');
}
function line(i, ms, extra) {
  const lvl = i % 5 === 0 ? 'E' : ['D', 'I', 'W'][i % 3];
  const tag = 'Tag' + (i % 7);
  let s = fmtTs(ms) + '  1234  5678 ' + lvl + ' ' + tag + ' : STRESS line ' + String(i).padStart(9, '0') + ' latency ' + (i % 300) + 'ms';
  if (i % 1000 === 0) s += ' vin=YV4STR0SS12345678';
  if (extra) s += ' ' + extra;
  return s + '\n';
}

function gen(name, targetBytes) {
  const file = path.join(DIR, name);
  const t0 = Date.now();
  const ws = fs.createWriteStream(file);
  let bytes = 0, i = 0, ms = 0;
  const st = { name, eLines: 0, vinLines: 0, lines: 0 };
  let pending = [];
  let pendingBytes = 0;
  const flush = () => new Promise((res, rej) => {
    if (!pending.length) return res();
    const buf = Buffer.from(pending.join(''), 'utf8');
    pending = []; pendingBytes = 0;
    ws.write(buf, err => err ? rej(err) : res());
  });
  return new Promise(async (res, rej) => {
    ws.on('error', rej);
    try {
      while (bytes < targetBytes) {
        i++; ms = i;                                    // 1 ms per line
        const L = line(i, ms);
        if (i % 5 === 0) st.eLines++;
        if (i % 1000 === 0) st.vinLines++;
        bytes += Buffer.byteLength(L);
        pending.push(L); pendingBytes += Buffer.byteLength(L);
        if (pendingBytes >= 8 * 1024 * 1024) await flush();
      }
      await flush();
      ws.end(() => {
        st.bytes = fs.statSync(file).size;
        st.lines = i;
        st.seconds = (Date.now() - t0) / 1000;
        console.log(name + ': ' + (st.bytes / GB).toFixed(2) + ' GB · ' + st.lines.toLocaleString() + ' lines · ' + st.seconds.toFixed(0) + ' s');
        res(st);
      });
    } catch (e) { rej(e); }
  });
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  if (process.env.KEEP && fs.existsSync(EXP)) { console.log('KEEP=1 and expectations exist — nothing to do'); return; }

  // --- stress_a.log: 2 GB · RAREBEACON marker block at ~90% · 10 s ts gap at ~60%
  // Implemented as a custom loop (needs ms mutation mid-stream):
  async function genA() {
    const file = path.join(DIR, 'stress_a.log');
    const target = 2 * GB;
    const ws = fs.createWriteStream(file);
    let bytes = 0, i = 0, ms = 0, gapDone = false, markerDone = false, markerLeft = 0;
    const st = { name: 'stress_a.log', eLines: 0, vinLines: 0, lines: 0, gapLine: 0, markerLine: 0, markerByte: 0 };
    let pending = [], pendingBytes = 0;
    const flush = () => new Promise((res, rej) => {
      if (!pending.length) return res();
      const buf = Buffer.from(pending.join(''), 'utf8'); pending = []; pendingBytes = 0;
      ws.write(buf, e => e ? rej(e) : res());
    });
    await new Promise((res, rej) => {
      ws.on('error', rej);
      (async function loop() {
        try {
          while (bytes < target) {
            i++; ms = i;
            if (!gapDone && bytes >= target * 0.6) { ms += 10000; gapDone = true; st.gapLine = i; }   // 10 s silence
            let extra = null;
            if (!markerDone && bytes >= target * 0.9) { markerDone = true; markerLeft = 20; st.markerLine = i; st.markerByte = bytes; }
            if (markerLeft > 0) { extra = 'RAREBEACON'; markerLeft--; }
            const L = line(i, ms, extra);
            if (i % 5 === 0) st.eLines++;
            if (i % 1000 === 0) st.vinLines++;
            bytes += Buffer.byteLength(L);
            pending.push(L); pendingBytes += Buffer.byteLength(L);
            if (pendingBytes >= 8 * 1024 * 1024) await flush();
          }
          await flush();
          ws.end(() => {
            st.bytes = fs.statSync(file).size; st.lines = i;
            console.log('stress_a.log: ' + (st.bytes / GB).toFixed(2) + ' GB · ' + st.lines.toLocaleString() + ' lines · gap at line ' + st.gapLine + ' · marker at line ' + st.markerLine);
            res(st);
          });
        } catch (e) { rej(e); }
      })();
    });
    return st;
  }

  // --- stress_c.log: 1.5 GB · boot reset (−2 h) at ~40%
  async function genC() {
    const file = path.join(DIR, 'stress_c.log');
    const target = 1.5 * GB;
    const ws = fs.createWriteStream(file);
    let bytes = 0, i = 0, ms = 0, bootDone = false;
    const st = { name: 'stress_c.log', eLines: 0, vinLines: 0, lines: 0, bootLine: 0 };
    let pending = [], pendingBytes = 0;
    const flush = () => new Promise((res, rej) => {
      if (!pending.length) return res();
      const buf = Buffer.from(pending.join(''), 'utf8'); pending = []; pendingBytes = 0;
      ws.write(buf, e => e ? rej(e) : res());
    });
    await new Promise((res, rej) => {
      ws.on('error', rej);
      (async function loop() {
        try {
          while (bytes < target) {
            i++; ms = i;
            if (!bootDone && bytes >= target * 0.4) { ms -= 7200000; if (ms < 0) ms = 0; bootDone = true; st.bootLine = i; }   // clock jumps back 2 h
            const L = line(i, ms);
            if (i % 5 === 0) st.eLines++;
            if (i % 1000 === 0) st.vinLines++;
            bytes += Buffer.byteLength(L);
            pending.push(L); pendingBytes += Buffer.byteLength(L);
            if (pendingBytes >= 8 * 1024 * 1024) await flush();
          }
          await flush();
          ws.end(() => {
            st.bytes = fs.statSync(file).size; st.lines = i;
            console.log('stress_c.log: ' + (st.bytes / GB).toFixed(2) + ' GB · ' + st.lines.toLocaleString() + ' lines · boot reset at line ' + st.bootLine);
            res(st);
          });
        } catch (e) { rej(e); }
      })();
    });
    return st;
  }

  const a = await genA();
  const b = await gen('stress_b.log', 2 * GB);
  const c = await genC();
  const exp = { files: [a, b, c], totals: {
    lines: a.lines + b.lines + c.lines,
    eLines: a.eLines + b.eLines + c.eLines,
    vinLines: a.vinLines + b.vinLines + c.vinLines,
    bytes: a.bytes + b.bytes + c.bytes,
  } };
  fs.writeFileSync(EXP, JSON.stringify(exp, null, 1));
  console.log('expectations → ' + EXP);
  console.log('TOTAL: ' + (exp.totals.bytes / GB).toFixed(2) + ' GB · ' + exp.totals.lines.toLocaleString() + ' lines · ' + exp.totals.eLines.toLocaleString() + ' E · ' + exp.totals.vinLines.toLocaleString() + ' VIN');
})().catch(e => { console.error('GEN FATAL', e); process.exit(1); });
