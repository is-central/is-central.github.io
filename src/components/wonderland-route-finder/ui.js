import WL from './solver.js';
import templates from './templates.json';
import regular from './samples/regular.jpg?url';
import variant from './samples/variant.jpg?url';
import good from './samples/good.jpg?url';

const SAMPLES = { regular, variant, good };
WL.setTemplates(templates);

/** Wire up one tool instance inside `root` (the .wl element). */
export function init(host, opts = {}) {
  const root = host.shadowRoot.querySelector('.wl'); // everything lives in the shadow tree
const $ = id => root.querySelector('#' + id);
const view = $('view'), ctx = view.getContext('2d');
const FONT = () => css('--body') || 'system-ui, sans-serif';
const css = n => getComputedStyle(root).getPropertyValue(n).trim();
const St = { img: null, imgData: null, G: null, grid: null, edges: [], start: null, variant: false, layout: null,
  unreachable: [], result: null, sol: 0, orders: [], graph: null, origin: [0, 0], evil: false, reads: [],
  tav: null, tavOrder: [], view: 'full', locked: false, rawEdges: [] };

function setStatus(t) { $('status').textContent = t; }

function loadSrc(src, name, lockAfter = false) {
  St.locked = false; St.lockAfter = lockAfter;
  const im = new Image();
  im.onload = () => {
    St.img = im;
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    St.imgData = cx.getImageData(0, 0, c.width, c.height);
    St.G = WL.toGray(St.imgData);
    St.name = name || 'map';
    analyse(null);
  };
  im.onerror = () => setStatus('That file could not be read as an image. Try a PNG or JPEG screenshot.');
  im.src = src;
}
function loadFile(f) {
  if (!f || !f.type.startsWith('image/')) { setStatus('Drop or choose an image file (PNG or JPEG).'); return; }
  const r = new FileReader(); r.onload = () => loadSrc(r.result, f.name.replace(/\.[^.]+$/, '')); r.readAsDataURL(f);
}

function analyse(gridIn) {
  setStatus('Finding the grid and bridges…');
  setTimeout(() => {
    const t0 = performance.now();
    const A = WL.analyse(St.G, gridIn);
    if (!A) { setStatus('No regular grid of nodes found. Set the spacing under Grid calibration.'); St.grid = null; draw(); return; }
    St.grid = A.grid; St.rawEdges = A.edges;
    St.layout = WL.detectLayout(St.G, St.imgData, St.grid, St.rawEdges);
    St.view = 'tavern';   // falls back to the whole map when the map isn't evil
    applyLayout();
    fillGridInputs();
    setStatus(`${St.imgData.width}×${St.imgData.height} px · node spacing ${A.grid.Px.toFixed(1)} × ${A.grid.Py.toFixed(1)} px · ${Math.round(performance.now() - t0)} ms`);
    if (St.lockAfter) { St.locked = true; St.lockAfter = false; }
    solve();
  }, 20);
}

// start cell and map type from the detection, unless the user picked the type
function applyLayout() {
  const L = St.layout, mode = $('layoutMode').value;
  if (!L) return;
  if (mode === 'auto') { St.variant = L.variant; St.start = L.start; }
  else {
    St.variant = mode === 'variant';
    if (L.bbox && L.bbox.r1 - L.bbox.r0 === 4) St.start = [L.bbox.r0 + 2, St.variant ? L.bbox.c0 : Math.round((L.bbox.c0 + L.bbox.c1) / 2)];
    else St.start = L.start;
  }
  clipEdges();
}
// An ED4 Wonderland has no nodes outside its 5 × 5, so anything detected beyond it is scenery.
function clipEdges() {
  const q = square();
  const inside = ([r, c]) => q && r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1;
  St.edges = St.variant ? St.rawEdges.filter(e => inside(e.a) && inside(e.b)) : St.rawEdges;
}

function fillGridInputs() {
  const g = St.grid; if (!g) return;
  $('px').value = g.Px.toFixed(1); $('py').value = g.Py.toFixed(1);
  $('x0').value = Math.round(g.xs[0]); $('y0').value = Math.round(g.ys[0]);
}

// the 5 × 5 being solved: centred on the start (Wander into Wonderland), or to its right (ED4)
function square() {
  if (!St.start) return null;
  const [r, c] = St.start;
  return St.variant ? { r0: r - 2, r1: r + 2, c0: c, c1: c + 4, n: 5 } : { r0: r - 2, r1: r + 2, c0: c - 2, c1: c + 2, n: 5 };
}
function region() { return $('regionMode').value === 'square' ? square() : null; }

function solve() {
  if (!St.grid || !St.start) { draw(); return; }
  const reg = region();
  const G = WL.buildGraph(St.edges, St.start, reg);
  St.graph = G; St.unreachable = G.unreachable;
  const R = WL.solve(G.adj, G.start);
  St.result = R; St.sol = 0;
  const sq = square();
  if (reg) St.origin = [reg.r0, reg.c0];
  else if (sq) St.origin = [sq.r0, sq.c0];
  else { const ks = [...G.adj.keys()].map(k => k.split(',').map(Number)); St.origin = [Math.min(...ks.map(k => k[0])), Math.min(...ks.map(k => k[1]))]; }
  St.orders = R.solutions.map(s => WL.order(G.adj, G.start, s));
  checkEvil();
  planTavern();
  renderResults(); draw();
}

const lab = k => { const [r, c] = k.split(',').map(Number); return `(${r - St.origin[0] + 1},${c - St.origin[1] + 1})`; };
const key = (r, c) => r + ',' + c;

// ---------- evil check: the start's three neighbours (2,1), (3,2), (4,1) ----------
function checkEvil() {
  St.reads = []; St.evil = false; St.evilAuto = null;
  if (!St.variant) return;
  const [r, c] = St.start;
  const cells = [[r - 1, c], [r, c + 1], [r + 1, c]];
  St.reads = cells.map(([rr, cc]) => {
    const inGrid = rr >= 0 && rr < St.grid.ys.length && cc >= 0 && cc < St.grid.xs.length;
    const R = inGrid ? WL.readLabel(St.imgData, St.grid, rr, cc) : { word: null, score: 0 };
    return { k: key(rr, cc), ...R };
  });
  const known = x => x.word && x.word !== '?' && x.word !== 'Tavern';
  St.evilAuto = St.reads.every(known) ? true : St.reads.some(x => x.word === 'Tavern') ? false : null;
  const m = $('evilMode').value;
  St.evil = m === 'yes' ? true : m === 'no' ? false : St.evilAuto === true;
}

const PATH_COLORS = ['#ffcf3f', '#4fd1ff', '#c39bff', '#7ee08a', '#ff9f5a', '#ff7eb6'];
const LETTERS = 'ABCDEFGH';
function planTavern() {
  St.tav = null; St.tavOrder = [];
  if (!St.evil) return;
  // candidates and routes always come from the 5 × 5
  const G = WL.buildGraph(St.edges, St.start, square());
  const budget = Math.max(0, parseInt($('limit').value));
  const known = x => x.word && x.word !== '?' && x.word !== 'Tavern';
  const exclude = St.reads.filter(known).map(x => x.k);   // already shown not to be the Tavern
  const P = WL.tavernPlan(G.adj, G.start, isNaN(budget) ? 7 : budget, exclude);
  P.adj = G.adj; P.startKey = G.start; P.excluded = exclude;
  St.tav = P;
  // which full path each explored node belongs to (first path that contains it)
  const pathOf = v => P.paths.findIndex(p => p.nodes.includes(v));
  const rev = new Set([G.start, ...G.adj.get(G.start)]);
  const m = P.cands.size; let found = [...P.cands].filter(c => rev.has(c)).length;
  const chosen = new Set(P.chosen.route);
  St.tavOrder = P.chosen.route.map(v => {
    const reveals = [...G.adj.get(v)].filter(w => !rev.has(w)); reveals.forEach(w => rev.add(w));
    found += reveals.filter(w => P.cands.has(w)).length;
    // path letter: the full path this step belongs to whose remaining nodes are also chosen, else the first
    let pi = P.paths.findIndex(p => p.nodes.includes(v) && p.nodes.every(x => chosen.has(x)));
    if (pi < 0) pi = pathOf(v);
    return { node: v, reveals, cand: reveals.some(w => P.cands.has(w)), p: m ? found / m : 1, path: pi };
  });
}

function renderResults() {
  const R = St.result, G = St.graph;
  // map card
  const sq = square();
  $('layoutLine').textContent = St.variant
    ? `ED4 Wonderland. The start is at (3,1) and the 5 × 5 runs to its right.`
    : `Wander into Wonderland. The start is at (3,3), the centre of the 5 × 5.`;
  $('evilBox').hidden = !St.variant;
  if (St.variant) {
    const pill = $('evilPill');
    const m = $('evilMode').value;
    if (St.evil) { pill.className = 'pill evil'; pill.textContent = 'Evil wonderland'; }
    else if (St.evilAuto === null && m === 'auto') { pill.className = 'pill unk'; pill.textContent = 'Not sure'; }
    else { pill.className = 'pill ok'; pill.textContent = 'Not evil'; }
    $('evilWhy').textContent = m !== 'auto' ? 'Set by hand in Settings.'
      : St.evilAuto === true ? 'None of the start\'s neighbours is a Tavern.'
      : St.evilAuto === false ? 'A Tavern sits next to the start.'
      : 'Some names could not be read. Set it under Settings.';
    $('reads').innerHTML = '';
    for (const x of St.reads) {
      const s = document.createElement('span');
      s.textContent = `${lab(x.k)} ${x.word === null ? 'no name' : x.word === '?' ? 'unreadable' : x.word}`;
      $('reads').appendChild(s);
    }
  }
  // whole-map card
  const n = G.adj.size;
  $('steps').textContent = isFinite(R.steps) ? R.steps : '–';
  $('stepsLbl').textContent = R.steps === 1 ? 'exploration' : 'explorations';
  const nSol = R.solutions.length;
  const every = nSol ? R.solutions.reduce((acc, s) => acc.filter(k => s.includes(k)), R.solutions[0]) : [];
  $('summary').textContent = !isFinite(R.steps) ? 'No route reveals every node.' :
    `${n} nodes reachable from the start` + (region() ? ' in the 5 × 5' : ' in the screenshot') +
    `. ${nSol}${R.truncated ? '+' : ''} shortest route${nSol === 1 ? '' : 's'}; ${every.length} of the ${R.steps} explorations appear in every one.`;
  const w = [];
  if (R.timedOut) w.push('The search hit its time limit, so this may not be the minimum.');
  if (St.unreachable.length) w.push(`${St.unreachable.length} detected node${St.unreachable.length === 1 ? ' is' : 's are'} not connected to the start and ${St.unreachable.length === 1 ? 'was' : 'were'} left out. If one is a real node, click to add its missing bridge.`);
  $('warn').hidden = !w.length; $('warn').textContent = w.join(' ');
  const chips = $('chips'); chips.innerHTML = '';
  R.solutions.slice(0, 200).forEach((_, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Route ' + (i + 1);
    b.setAttribute('aria-pressed', i === St.sol);
    b.onclick = () => { St.sol = i; setView('full'); renderResults(); draw(); };
    chips.appendChild(b);
  });
  if (nSol > 1 && St.sol > 0) {
    const a = R.solutions[0], b = R.solutions[St.sol];
    const out = a.filter(k => !b.includes(k)).map(lab), inn = b.filter(k => !a.includes(k)).map(lab);
    $('diff').textContent = `Route ${St.sol + 1} explores ${inn.join(', ')} instead of ${out.join(', ')} (compared with route 1).`;
  } else $('diff').textContent = nSol > 1 ? 'Pick a route to see how it differs from route 1.' : nSol === 1 ? 'There is only one shortest route.' : '';
  const tb = $('order'); tb.innerHTML = '';
  (St.orders[St.sol] || []).forEach((o, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="n">${i + 1}</td><td>${lab(o.node)}</td><td>${o.reveals.map(lab).join(' ') || '—'}</td>`;
    tb.appendChild(tr);
  });
  // tavern card
  const T = St.tav;
  $('vTavern').hidden = !T; $('legGold').hidden = !T;
  // An evil ED4 Wonderland is about finding the Tavern before anything else, so its card and
  // toggle come first; exploring everything stays available below it.
  const panel = $('exploreCard').parentNode, seg = $('viewSeg');
  if (T) { panel.insertBefore($('tavCard'), $('exploreCard')); seg.insertBefore($('vTavern'), $('vFull')); }
  else { panel.insertBefore($('tavCard'), $('exploreCard').nextSibling); seg.appendChild($('vTavern')); }
  $('tPriority').hidden = !T; $('ePriority').hidden = !T;
  if (!T && St.view === 'tavern') St.view = 'full';
  $('legPath').hidden = !T;
  if (T) {
    const m = T.cands.size;
    $('tSteps').textContent = isFinite(T.steps) ? T.steps : '–';
    const exc3 = T.excluded.filter(k => T.adj.has(k) && T.adj.get(k).size === 3);
    $('tSummary').textContent = !m ? 'No node other than the start has exactly three bridges.' :
      `${m} candidate${m === 1 ? '' : 's'} with exactly three bridges: ${[...T.cands].map(lab).join(', ')}.` +
      (exc3.length ? ` ${exc3.map(lab).join(' and ')} also ${exc3.length === 1 ? 'has' : 'have'} three bridges but already ${exc3.length === 1 ? 'reads' : 'read'} as another node, so ${exc3.length === 1 ? 'it is' : 'they are'} left out.` : '');
    const chosen = new Set(T.chosen.route);
    const box = $('tPaths'); box.innerHTML = '';
    T.paths.forEach((p, i) => {
      const d = document.createElement('div');
      const all = p.nodes.every(v => chosen.has(v));
      if (!all) d.className = 'off';
      d.innerHTML = `<b style="background:${PATH_COLORS[i % PATH_COLORS.length]}">${LETTERS[i]}</b><span>${p.nodes.length} step${p.nodes.length === 1 ? '' : 's'}: ${p.nodes.map(lab).join(' → ')}${p.stubs.length ? `, which reveals ${p.stubs.map(lab).join(' and ')}` : ''}</span>`;
      box.appendChild(d);
    });
    const c = T.chosen.count, pct = m ? Math.round(100 * c / m) : 100;
    let verdict;
    if (!m) verdict = '';
    else if (T.fitsAll) verdict = `Your ${T.budget} step${T.budget === 1 ? '' : 's'} cover every candidate, since revealing all ${m} takes ${T.steps}. The paths are numbered in the order that finds candidates soonest.`;
    else if (!T.chosen.route.length) verdict = `${T.budget} steps can't reveal any new candidate.`;
    else {
      const used = T.chosen.route.length;
      const whole = T.paths.map((p, i) => p.nodes.every(v => chosen.has(v)) ? LETTERS[i] : null).filter(Boolean);
      verdict = `Revealing every candidate needs ${T.steps} steps, more than your ${T.budget}. ` +
        (whole.length ? `Follow path ${whole.join(' and ')} (${used} step${used === 1 ? '' : 's'}): ` : `The best ${used} step${used === 1 ? '' : 's'} `) +
        `it reveals ${c} of the ${m} candidates, so the chance of finding the Tavern is ${pct}%.`;
      if (!T.chosen.exhaustive) verdict += ' The search ran out of time, so a better choice may exist.';
    }
    $('tVerdict').textContent = verdict;
    const tb2 = $('tOrder'); tb2.innerHTML = '';
    St.tavOrder.forEach((o, i) => {
      const tr = document.createElement('tr'); if (o.cand) tr.className = 'cand';
      const col = PATH_COLORS[(o.path < 0 ? 0 : o.path) % PATH_COLORS.length];
      tr.innerHTML = `<td class="n">${i + 1}</td><td class="pl"><b style="background:${col}">${o.path < 0 ? '·' : LETTERS[o.path]}</b></td><td>${lab(o.node)}</td><td>${o.reveals.map(w => lab(w) + (T.cands.has(w) ? ' ★' : '')).join(' ') || '—'}</td><td class="pct">${Math.round(100 * o.p)}%</td>`;
      tb2.appendChild(tr);
    });
  }
  setView(St.view);
  applyMode();
  if (St.locked) makeExport();
}

function applyMode() {
  const L = St.locked;
  $('lockBtn').hidden = L; $('editBtn').hidden = !L; $('viewSeg').hidden = !L || !St.tav;
  $('stageLbl').textContent = L ? 'Locked' : 'Step 1 · Check the map';
  $('legEdit').hidden = L; $('legLocked').hidden = !L; $('hintEdit').hidden = L; $('hintLocked').hidden = !L;
  $('checkCard').hidden = L; $('settingsCard').hidden = L;
  $('exploreCard').hidden = !L; $('exportCard').hidden = !L; $('tavCard').hidden = !L || !St.tav;
  view.style.cursor = L ? 'default' : 'crosshair';
  if (!L && St.grid) {
    const q = region(), inR = ([r, c]) => !q || (r >= q.r0 && r <= q.r1 && c >= q.c0 && c <= q.c1);
    const es = St.edges.filter(e => inR(e.a) && inR(e.b));
    const nOn = es.filter(e => e.on).length, faint = es.filter(e => e.unsure);
    $('checkText').textContent = `${St.variant ? 'ED4 Wonderland' : 'Wander into Wonderland'}: ${nOn} bridges found ${q ? 'in the 5 × 5' : 'in the screenshot'}` +
      (St.variant ? ', and anything outside the 5 × 5 was discarded.' : '.') + ' The pink lines on the map are what the routes will use.';
    $('checkFaint').hidden = !faint.length;
    $('checkFaint').textContent = faint.length ? `${faint.length} faint bridge${faint.length === 1 ? '' : 's'} to check (amber): ` +
      faint.map(e => `${lab(e.a.join(','))}–${lab(e.b.join(','))} ${e.on ? 'counted' : 'not counted'}`).join(', ') + '.' : '';
  }
}
function setLocked(v) {
  St.locked = v;
  if (v && St.view !== 'tavern' && St.tav) St.view = 'tavern';
  applyMode(); setView(St.view); draw();
  if (v) makeExport();
}

function setView(v) {
  St.view = v;
  $('vFull').setAttribute('aria-pressed', v === 'full'); $('vTavern').setAttribute('aria-pressed', v === 'tavern');
}

// ---------- drawing ----------
function drawSeq(c, g, seq, startKey, color, adjForPos) {
  const pos = k => { const [r, cc] = k.split(',').map(Number); return [g.xs[cc], g.ys[r]]; };
  const R = Math.max(12, 0.16 * Math.min(g.Px, g.Py));
  c.lineCap = 'round';
  for (const o of seq) {
    const [x1, y1] = pos(o.from), [x2, y2] = pos(o.node);
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = R * 0.42; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = color; c.lineWidth = R * 0.24; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  seq.forEach((o, i) => {
    const [x, y] = pos(o.node);
    c.fillStyle = '#11161b'; c.strokeStyle = color; c.lineWidth = R * 0.2;
    c.beginPath(); c.arc(x, y, R, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = `700 ${R * (i + 1 >= 10 ? 0.95 : 1.15)}px ${FONT()}`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x, y + R * 0.05);
  });
}
function drawStart(c, g, startKey, pink) {
  const [r, cc] = startKey.split(',').map(Number), x = g.xs[cc], y = g.ys[r];
  const R = Math.max(12, 0.16 * Math.min(g.Px, g.Py));
  c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
  c.fillStyle = pink; c.strokeStyle = '#fff'; c.lineWidth = R * 0.14;
  c.fillRect(-R * 0.8, -R * 0.8, R * 1.6, R * 1.6); c.strokeRect(-R * 0.8, -R * 0.8, R * 1.6, R * 1.6); c.restore();
  c.fillStyle = '#fff'; c.font = `700 ${R * 1.05}px ${FONT()}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('S', x, y + R * 0.04);
}
function drawCands(c, g, gold) {
  if (!St.tav) return;
  const R = Math.max(12, 0.16 * Math.min(g.Px, g.Py));
  for (const k of St.tav.cands) {
    const [r, cc] = k.split(',').map(Number), x = g.xs[cc], y = g.ys[r];
    const hw = 0.27 * g.Px, hh = 0.33 * g.Py;
    c.save();
    c.lineWidth = R * 0.42; c.strokeStyle = 'rgba(0,0,0,.45)'; c.strokeRect(x - hw, y - hh, 2 * hw, 2 * hh);
    c.lineWidth = R * 0.24; c.strokeStyle = '#ffffff'; c.setLineDash([R * 0.55, R * 0.3]); c.strokeRect(x - hw, y - hh, 2 * hw, 2 * hh);
    c.restore();
  }
}
// Independent paths as coloured lanes (shared stretches run side by side). Segments the budget
// covers are solid; the rest are faded. Dashed hops end on a candidate the path only reveals.
function drawTavern(c, g) {
  const T = St.tav; if (!T) return;
  const pos = k => { const [r, cc] = k.split(',').map(Number); return [g.xs[cc], g.ys[r]]; };
  const R = Math.max(12, 0.16 * Math.min(g.Px, g.Py)), lane = R * 0.34;
  const chosen = new Set([T.startKey, ...T.chosen.route]);
  const full = T.paths.map(p => p.nodes.every(v => chosen.has(v)));
  const owner = new Map(St.tavOrder.map(o => [o.node, o.path]));
  const segs = [];
  T.paths.forEach((p, i) => {
    const chain = [T.startKey, ...p.nodes];
    for (let j = 1; j < chain.length; j++) segs.push({ a: chain[j - 1], b: chain[j], i, dash: false });
    const end = chain[chain.length - 1];
    for (const s of p.stubs) {
      const from = [...T.adj.get(s)].find(u => chain.includes(u) && chain.indexOf(u) >= 0) || end;
      segs.push({ a: from, b: s, i, dash: true });
    }
  });
  const useCount = new Map();
  const sk = s => [s.a, s.b].sort().join('|');
  for (const s of segs) { const k = sk(s); if (!useCount.has(k)) useCount.set(k, []); if (!useCount.get(k).includes(s.i)) useCount.get(k).push(s.i); }
  c.save(); c.lineCap = 'round';
  const solidFirst = segs.map(s => ({ s, on: chosen.has(s.a) && (s.dash || chosen.has(s.b)) && (full[s.i] || owner.get(s.dash ? s.a : s.b) === s.i) }));
  segs.sort((x, y) => (solidFirst.find(t => t.s === x).on ? 1 : 0) - (solidFirst.find(t => t.s === y).on ? 1 : 0));
  for (const pass of [0, 1]) for (const s of segs) {
    const users = useCount.get(sk(s)), li = users.indexOf(s.i), off = (li - (users.length - 1) / 2) * lane;
    let [x1, y1] = pos(s.a), [x2, y2] = pos(s.b);
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    x1 += nx * off; y1 += ny * off; x2 += nx * off; y2 += ny * off;
    // solid only in the colour of a path that is actually being followed
    const own = s.dash ? s.a : s.b;
    const on = chosen.has(s.a) && (s.dash || chosen.has(s.b)) && (full[s.i] || owner.get(own) === s.i);
    c.globalAlpha = on ? 1 : 0.38;
    c.setLineDash(s.dash ? [R * 0.5, R * 0.45] : []);
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
    if (pass === 0) { c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = R * 0.42; }
    else { c.strokeStyle = PATH_COLORS[s.i % PATH_COLORS.length]; c.lineWidth = R * 0.26; }
    c.stroke();
  }
  c.restore();
  St.tavOrder.forEach((o, i) => {
    const [x, y] = pos(o.node);
    c.fillStyle = '#11161b'; c.strokeStyle = PATH_COLORS[(o.path < 0 ? 0 : o.path) % PATH_COLORS.length]; c.lineWidth = R * 0.22;
    c.beginPath(); c.arc(x, y, R, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = `700 ${R * (i + 1 >= 10 ? 0.95 : 1.15)}px ${FONT()}`;
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x, y + R * 0.05);
  });
}
function drawOverlay(c, g, colors, withRings, which = St.view) {
  if (which === 'tavern' && St.tav) {
    drawCands(c, g, colors.gold);
    drawTavern(c, g);
  } else {
    if (St.tav) drawCands(c, g, colors.gold);
    const ord = St.orders[St.sol];
    if (ord) {
      const R = Math.max(12, 0.16 * Math.min(g.Px, g.Py));
      const explored = new Set(ord.map(o => o.node));
      for (const k of St.graph.adj.keys()) if (withRings && !explored.has(k) && k !== St.graph.start) {
        const [r, cc] = k.split(',').map(Number), x = g.xs[cc], y = g.ys[r];
        c.lineWidth = R * 0.18; c.strokeStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.arc(x, y, R * 0.5, 0, 7); c.stroke();
        c.lineWidth = R * 0.1; c.strokeStyle = '#11161b'; c.beginPath(); c.arc(x, y, R * 0.5, 0, 7); c.stroke();
      }
      drawSeq(c, g, ord, St.graph.start, colors.jade);
    }
  }
  if (St.graph) drawStart(c, g, St.graph.start, colors.pink);
}

function draw() {
  if (!St.img) return;
  const W = St.img.naturalWidth, H = St.img.naturalHeight;
  if (view.width !== W) view.width = W; if (view.height !== H) view.height = H;
  ctx.drawImage(St.img, 0, 0);
  const g = St.grid; if (!g) return;
  const colors = { pink: css('--bridge') || '#e04a86', amber: css('--amber') || '#b7791f', jade: css('--jade') || '#14866a', gold: css('--gold') || '#b07d12' };
  const reg = square();
  if (reg) {
    const x0 = g.xs[0] + (reg.c0 - 0.5) * g.Px, y0 = g.ys[0] + (reg.r0 - 0.5) * g.Py;
    ctx.save(); ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = colors.jade;
    ctx.strokeRect(x0, y0, 5 * g.Px, 5 * g.Py); ctx.restore();
  }
  if (!St.locked) {
    ctx.strokeStyle = 'rgba(20,134,106,.8)'; ctx.lineWidth = 2;
    const q = region();
    g.ys.forEach((y, r) => g.xs.forEach((x, c) => {
      if (q && (r < q.r0 || r > q.r1 || c < q.c0 || c > q.c1)) return;
      ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
    }));
    const unr = new Set(St.unreachable);
    for (const e of St.edges) {
      if (!e.on && !e.unsure) continue;
      const [r1, c1] = e.a, [r2, c2] = e.b;
      let x1 = g.xs[c1], y1 = g.ys[r1], x2 = g.xs[c2], y2 = g.ys[r2];
      if (r1 === r2) { x1 += 0.26 * g.Px; x2 -= 0.26 * g.Px; } else { y1 += 0.3 * g.Py; y2 -= 0.3 * g.Py; }
      const ignored = unr.has(e.a.join(',')) || unr.has(e.b.join(','));
      ctx.save(); ctx.lineCap = 'round';
      ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(0,0,0,.45)';
      if (!e.on) ctx.setLineDash([10, 9]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineWidth = 5; ctx.strokeStyle = !e.on ? colors.amber : ignored ? 'rgba(200,200,200,.8)' : (e.unsure ? colors.amber : colors.pink);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }
  }
  if (!St.locked) { if (St.graph) drawStart(ctx, g, St.graph.start, colors.pink); return; }
  if (St.graph) drawOverlay(ctx, g, colors, true);
}

// One labelled image per view: the whole-map route, and on an evil map the Tavern search too.
function makeExport() {
  if (!St.img || !St.grid || !St.graph) return;
  const views = St.tav ? ['tavern', 'full'] : ['full'];
  const box = $('exports'); box.innerHTML = '';
  St.exports = {};
  for (const v of views) {
    const c = document.createElement('canvas'); c.width = St.img.naturalWidth; c.height = St.img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(St.img, 0, 0);
    drawOverlay(x, St.grid, { jade: '#14866a', pink: '#e04a86', gold: '#d9a21b' }, true, v);
    const url = c.toDataURL('image/png');
    St.exports[v] = { canvas: c, url };
    const fig = document.createElement('figure');
    fig.style.margin = '0'; fig.style.display = 'grid'; fig.style.gap = '6px';
    const title = v === 'tavern' ? 'Tavern search' : 'Explore all';
    fig.innerHTML = `<figcaption class="sub" style="color:var(--ink);font-weight:500">${title}</figcaption>
      <img alt="${title}, labelled on the map" src="${url}">
      <div class="bar"><button type="button" class="primary" data-dl="${v}">Download PNG</button><button type="button" data-copy="${v}">Copy image</button></div>`;
    box.appendChild(fig);
  }
}

// ---------- interaction ----------
view.addEventListener('click', ev => {
  const g = St.grid; if (!g || St.locked) return;
  const rect = view.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * view.width / rect.width, y = (ev.clientY - rect.top) * view.height / rect.height;
  let bc = null, bd = 1e9;
  g.ys.forEach((yy, r) => g.xs.forEach((xx, c) => { const d = Math.hypot((x - xx) / g.Px, (y - yy) / g.Py); if (d < bd) { bd = d; bc = [r, c]; } }));
  if (bd < 0.24) { St.start = bc; clipEdges(); setStatus(`Start moved to the node at row ${bc[0] + 1}, column ${bc[1] + 1} of the grid.`); solve(); return; }
  let be = null, bdd = 1e9;
  for (const e of St.edges) {
    const mx = (g.xs[e.a[1]] + g.xs[e.b[1]]) / 2, my = (g.ys[e.a[0]] + g.ys[e.b[0]]) / 2;
    const d = Math.hypot((x - mx) / g.Px, (y - my) / g.Py); if (d < bdd) { bdd = d; be = e; }
  }
  if (be && bdd < 0.32) { be.on = !be.on; be.unsure = false; setStatus(be.on ? 'Bridge added.' : 'Bridge removed.'); solve(); }
});

$('file').addEventListener('change', e => loadFile(e.target.files[0]));
$('exRegular').addEventListener('click', () => loadSrc(SAMPLES.regular, 'regular-example'));
$('exVariant').addEventListener('click', () => loadSrc(SAMPLES.variant, 'evil-variant-example'));
$('exGood').addEventListener('click', () => loadSrc(SAMPLES.good, 'tavern-variant-example'));
const box = $('box');
box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('over'); });
box.addEventListener('dragleave', () => box.classList.remove('over'));
box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });
window.addEventListener('paste', e => {
  if (!host.matches(':hover') && !host.contains(document.activeElement)) return; // only when the tool is in use
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (it) loadFile(it.getAsFile());
});
$('lockBtn').addEventListener('click', () => setLocked(true));
$('lockBtn2').addEventListener('click', () => setLocked(true));
$('editBtn').addEventListener('click', () => setLocked(false));
$('vFull').addEventListener('click', () => { setView('full'); draw(); });
$('vTavern').addEventListener('click', () => { setView('tavern'); draw(); });
$('regionMode').addEventListener('change', () => { clipEdges(); solve(); });
$('layoutMode').addEventListener('change', () => { applyLayout(); solve(); });
$('evilMode').addEventListener('change', solve);
$('limit').addEventListener('change', () => { planTavern(); renderResults(); draw(); });
$('applyGrid').addEventListener('click', () => {
  if (!St.G) return;
  const p = { Px: +$('px').value, Py: +$('py').value, x0: +$('x0').value, y0: +$('y0').value };
  if (!(p.Px > 20 && p.Py > 20)) { setStatus('Spacing must be more than 20 px.'); return; }
  analyse(WL.gridFromParams(St.G.W, St.G.H, p));
});
$('autoGrid').addEventListener('click', () => St.G && analyse(null));
$('exports').addEventListener('click', async ev => {
  const dlBtn = ev.target.closest('[data-dl]'), cpBtn = ev.target.closest('[data-copy]');
  if (cpBtn) {
    const ex = St.exports?.[cpBtn.dataset.copy]; if (!ex) return;
    try {
      const blob = new Promise(res => ex.canvas.toBlob(res, 'image/png'));
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => setStatus('Labelled image copied.'))
        .catch(() => setStatus('Copying was blocked here. Right-click or long-press the labelled image to save it.'));
    } catch { setStatus('Copying is not available here. Right-click or long-press the labelled image to save it.'); }
    return;
  }
  if (!dlBtn) return;
  const v = dlBtn.dataset.dl, ex = St.exports?.[v]; if (!ex) return;
  const filename = (St.name || 'map').replace(/[^\w.-]+/g, '-') + (v === 'tavern' ? '-tavern' : '-route') + '.png';
  const a = document.createElement('a'); a.href = ex.url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
});
document.fonts?.ready.then(() => { if (St.graph) { draw(); makeExport(); } });
if (SAMPLES[opts.sample]) loadSrc(SAMPLES[opts.sample], opts.sample + '-example', true);

// The shadow root can't see <html>'s theme, so mirror it onto the tool and repaint the canvas.
const syncTheme = () => {
  const h = document.documentElement;
  const t = h.dataset.theme || (h.classList.contains('dark') ? 'dark' : h.classList.contains('light') ? 'light' : '');
  if (root.dataset.theme !== t) { root.dataset.theme = t; draw(); }
};
syncTheme();
new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
// remember whether the guide is open, per viewer
try { if (localStorage.getItem('wl-guide') === 'closed') $('guide').open = false; } catch {}
$('guide').addEventListener('toggle', () => { try { localStorage.setItem('wl-guide', $('guide').open ? 'open' : 'closed'); } catch {} });
}
