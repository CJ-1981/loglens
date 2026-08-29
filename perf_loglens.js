const fs = require('fs');
const html = fs.readFileSync('loglens.html', 'utf8');
const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
const CORE = new Function(m[1] + '\nreturn CORE;')();

// synthetic file: 600k lines (~180MB equivalent content) from demo + filler
const fillers = [
  '08-24 12:01:01.001  1520  1520 D ConnectivityService: NetworkReassignment : no changes',
  '08-24 12:01:01.002  6538  6800 I Render: context_create: ctxt_id 77, sync_type 1',
  '08-24 12:01:01.003  3914  3974 I Settings: No settings key found for preferred-languages',
  '08-24 12:01:01.004  3807  7681 I DemoApp:Heartbeat: idle — nothing to do',
  '08-24 12:01:01.005  1532  1873 D JobQueue: Processing event 6 for <10>com.example.demoapp',
];
let parts = [];
const N = 120000; // 5 lines per iter
for (let i = 0; i < N; i++) parts.push(fillers.join('\n'));
const text = parts.join('\n');
console.log('synthetic size:', (text.length / 1048576).toFixed(1), 'MB, lines:', 5 * N);

const cm = CORE.compile(CORE.DEFAULT_MASK, 'mask').map(c => ({ ...c, rx: new RegExp(c.rx.source, 'g') }));
const st = CORE.newState();
const opts = {
  include: CORE.compile([{ name: 'demo', pattern: 'demoapp' }], 'extract'),
  exclude: [], levels: new Set(['V','D','I','W','E','F']),
  fromTs: null, toTs: null, applyMask: true, maskCompiled: cm, hardCap: 200000
};
const t0 = Date.now();
CORE.processText(text, 'synthetic.log', opts, st);
const ms = Date.now() - t0;
console.log('processText took', ms, 'ms ->', (text.length / 1048576 / (ms / 1000)).toFixed(0), 'MB/s');
console.log('matched:', st.matched, '(expect', 2 * N, ')  total:', st.total);
console.log('top tags:', Object.entries(st.byTag).sort((a, b) => b[1] - a[1]).slice(0, 3));
if (st.matched !== 2 * N) process.exit(1);
console.log('PERF OK');
