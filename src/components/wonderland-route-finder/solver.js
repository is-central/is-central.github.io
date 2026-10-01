// Wonderland map solver — pure functions, no DOM. Used by the browser UI and the node tests.
// Image coordinates: x to the right, y downward. Grid cells are indexed (r, c) from 0.

const WL = (() => {

  function toGray(img) {
    const { width: W, height: H, data } = img;
    // luminance for the grid profiles, plus the three colour channels for bridge tests: a pink
    // bridge on a pink background can match the background in brightness but never in R and G.
    const g = new Float32Array(W * H), ch = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      ch[0][i] = data[j]; ch[1][i] = data[j + 1]; ch[2][i] = data[j + 2];
      g[i] = (data[j] + data[j + 1] + data[j + 2]) / 3;
    }
    return { g, ch, W, H };
  }

  // ---------- grid detection ----------
  // Node boxes are dense with edges (icon + frame); the gaps between them hold only thin bridges.
  // The horizontal-gradient energy, projected on each axis, is therefore periodic with the grid pitch.
  // Profiles use the central band of the image only (12–88 % of the height), which keeps the
  // game HUD at the top and the toolbar at the bottom from swamping the periodic signal.
  function edgeProfiles({ g, W, H }) {
    const b0 = Math.round(0.12 * H), b1 = Math.round(0.88 * H);
    const col = new Float64Array(W), row = new Float64Array(b1 - b0);
    for (let y = b0; y < b1; y++) {
      const o = y * W;
      for (let x = 1; x < W - 1; x++) {
        const e = Math.abs(g[o + x + 1] - g[o + x - 1]);
        col[x] += e; row[y - b0] += e;
      }
    }
    return { col, row, b0 };
  }

  function boxSmooth(p, w) {
    w = Math.max(1, Math.round(w));
    const n = p.length, out = new Float64Array(n), cs = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + p[i];
    const h = Math.floor(w / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
      out[i] = (cs[b] - cs[a]) / (b - a);
    }
    return out;
  }

  function estimatePitch(p) {
    const n = p.length;
    // remove slow background trends so the autocorrelation sees only the periodic part
    const trend = boxSmooth(p, n / 4);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = p[i] - trend[i];
    const lo = 40, hi = Math.round(n / 2.2);
    const r = new Float64Array(hi + 2);
    let e0 = 0; for (let i = 0; i < n; i++) e0 += d[i] * d[i];
    for (let L = lo; L <= hi + 1; L++) {
      let s = 0; for (let i = 0; i + L < n; i++) s += d[i] * d[i + L];
      r[L] = s / e0 * n / (n - L);
    }
    const peaks = [];
    for (let L = lo + 1; L <= hi; L++) if (r[L] > r[L - 1] && r[L] >= r[L + 1] && r[L] > 0) peaks.push(L);
    if (!peaks.length) return null;
    const best = Math.max(...peaks.map(L => r[L]));
    const L = peaks.find(L => r[L] >= 0.8 * best);
    // parabolic sub-pixel refinement
    const a = r[L - 1], b = r[L], c = r[L + 1], den = a - 2 * b + c;
    return L + (den ? 0.5 * (a - c) / den : 0);
  }

  function estimatePhase(p, P) {
    const s = boxSmooth(p, 0.45 * P);
    const Pi = Math.round(P), f = new Float64Array(Pi);
    for (let i = 0; i < p.length; i++) {
      const ph = ((i % P) + P) % P;
      f[Math.min(Pi - 1, Math.floor(ph))] += s[i];
    }
    let bi = 0; for (let i = 1; i < Pi; i++) if (f[i] > f[bi]) bi = i;
    return bi;
  }

  function centers(phase, P, n, margin) {
    const out = [];
    let x = phase; while (x - P >= margin) x -= P;
    for (; x + margin <= n; x += P) if (x - margin >= 0) out.push(x);
    return out;
  }

  // ---------- bridge detection ----------
  // A bridge is a thin bar: along its whole length the bar pixel differs, in the same direction,
  // from the pixels a few px away on both sides. A step edge (one side only) scores zero, which is
  // what rejects background shading and scenery.
  function barProfile({ ch, W, H }, horiz, pos, a0, a1, o) {
    const out = [];
    for (let t = Math.round(a0); t < Math.round(a1); t++) {
      let i0, iu, iv;
      if (horiz) {
        const y = Math.round(pos), x = t;
        if (y - o < 0 || y + o >= H || x < 0 || x >= W) continue;
        i0 = y * W + x; iu = (y - o) * W + x; iv = (y + o) * W + x;
      } else {
        const x = Math.round(pos), y = t;
        if (x - o < 0 || x + o >= W || y < 0 || y >= H) continue;
        i0 = y * W + x; iu = y * W + x - o; iv = y * W + x + o;
      }
      let best = 0;
      for (let k = 0; k < 3; k++) {
        const c = ch[k][i0], d1 = c - ch[k][iu], d2 = c - ch[k][iv];
        if (d1 * d2 > 0) { const m = Math.min(Math.abs(d1), Math.abs(d2)); if (m > best) best = m; }
      }
      out.push(best);
    }
    return out;
  }
  function pct(arr, q) {
    if (!arr.length) return 0;
    const s = Float64Array.from(arr).sort();
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }
  // best score of a bar scanned across a window; bar must cover >= 75 % of the span
  function scanBar(G, horiz, posC, halfWin, a0, a1, o) {
    let best = 0, bestPos = posC;
    for (let p = Math.round(posC - halfWin); p <= Math.round(posC + halfWin); p++) {
      for (const oo of [o, Math.round(o * 1.6)]) {
        const s = pct(barProfile(G, horiz, p, a0, a1, oo), 0.25);
        if (s > best) { best = s; bestPos = p; }
      }
    }
    return { score: best, pos: bestPos };
  }

  // Layout fractions of the pitch, measured on the game's node art (box ±0.23·Px wide,
  // label bar below the box reaching ≈ +0.47·Py, next box starting ≈ −0.28·Py).
  const F = { hGap0: 0.27, hGap1: 0.73, hWin: 0.15, vGap0: 0.52, vGap1: 0.66, vWin: 0.12 };

  function measureBridges(G, grid) {
    const { xs, ys, Px, Py } = grid;
    const oy = Math.max(3, Math.round(0.035 * Py)), ox = Math.max(3, Math.round(0.03 * Px));
    const H = [], V = [];
    for (let r = 0; r < ys.length; r++) for (let c = 0; c + 1 < xs.length; c++) {
      const m = scanBar(G, true, ys[r], F.hWin * Py, xs[c] + F.hGap0 * Px, xs[c] + F.hGap1 * Px, oy);
      H.push({ r, c, score: m.score, pos: m.pos });
    }
    for (let r = 0; r + 1 < ys.length; r++) for (let c = 0; c < xs.length; c++) {
      const m = scanBar(G, false, xs[c], F.vWin * Px, ys[r] + F.vGap0 * Py, ys[r] + F.vGap1 * Py, ox);
      V.push({ r, c, score: m.score, pos: m.pos });
    }
    return { H, V };
  }

  // Refine row/column centres with the bridges themselves: horizontal bridges sit exactly on the
  // box centre line, vertical ones exactly on the box centre column. Fit a line through rows/cols
  // that show bridges so the pitch is exact across the whole map.
  function refineAxis(meas, isRow, n, coarse, P, thr) {
    const pts = [];
    for (let k = 0; k < n; k++) {
      const ms = meas.filter(m => (isRow ? m.r : m.c) === k && m.score >= thr);
      if (!ms.length) continue;
      const w = ms.reduce((s, m) => s + m.score, 0);
      pts.push([k, ms.reduce((s, m) => s + m.pos * m.score, 0) / w, w]);
    }
    if (pts.length < 2) return coarse;
    let sw = 0, sk = 0, sp = 0, skk = 0, skp = 0;
    for (const [k, p, w] of pts) { sw += w; sk += w * k; sp += w * p; skk += w * k * k; skp += w * k * p; }
    const den = sw * skk - sk * sk;
    if (!den) return coarse;
    const slope = (sw * skp - sk * sp) / den, icpt = (sp - slope * sk) / sw;
    if (Math.abs(slope - P) > 0.08 * P) return coarse;
    return coarse.map((_, k) => icpt + slope * k);
  }

  function detectGrid(G) {
    const { col, row, b0 } = edgeProfiles(G);
    const Px = estimatePitch(col), Py = estimatePitch(row);
    if (!Px || !Py) return null;
    const xs = centers(estimatePhase(col, Px), Px, G.W, 0.3 * Px);
    const ys = centers(b0 + estimatePhase(row, Py), Py, G.H, 0.3 * Py);
    return { Px, Py, xs, ys };
  }

  function gridFromParams(W, H, p) {
    return { Px: p.Px, Py: p.Py, xs: centers(p.x0, p.Px, W, 0.3 * p.Px), ys: centers(p.y0, p.Py, H, 0.3 * p.Py) };
  }

  const THR = 6;      // bar score at or above → bridge (colour-channel units)
  const UNSURE = 4; // scores in [UNSURE, 1.5·THR) are flagged for the user to check

  function analyse(G, gridIn) {
    let grid = gridIn || detectGrid(G);
    if (!grid) return null;
    // two refinement passes: rows from horizontal bridges, then columns from vertical ones
    for (let it = 0; it < 2; it++) {
      let m = measureBridges(G, grid);
      const ys = refineAxis(m.H, true, grid.ys.length, grid.ys, grid.Py, THR);
      grid = { ...grid, ys, Py: ys.length > 1 ? (ys[ys.length - 1] - ys[0]) / (ys.length - 1) : grid.Py };
      m = measureBridges(G, grid);
      const xs = refineAxis(m.V, false, grid.xs.length, grid.xs, grid.Px, THR);
      grid = { ...grid, xs, Px: xs.length > 1 ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) : grid.Px };
    }
    const meas = measureBridges(G, grid);
    const edges = [];
    for (const m of meas.H) edges.push({ a: [m.r, m.c], b: [m.r, m.c + 1], score: m.score, on: m.score >= THR, unsure: m.score >= UNSURE && m.score < THR * 1.5 });
    for (const m of meas.V) edges.push({ a: [m.r, m.c], b: [m.r + 1, m.c], score: m.score, on: m.score >= THR, unsure: m.score >= UNSURE && m.score < THR * 1.5 });
    return { grid, edges };
  }

  // Start = the cell whose bridges are pink (revealed) — the explored junction. Falls back to the
  // grid cell nearest the image centre.
  function guessStart(img, grid, edges) {
    const { width: W, data } = img;
    const pinkAt = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      let n = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const j = ((y + dy) * W + (x + dx)) * 4;
        const R = data[j], Gc = data[j + 1], B = data[j + 2];
        if (R > 190 && R - Gc > 90 && B > 80 && B < 210) n++;
      }
      return n > 6;
    };
    const score = new Map();
    for (const e of edges) if (e.on) {
      const [r1, c1] = e.a, [r2, c2] = e.b;
      const x = (grid.xs[c1] + grid.xs[c2]) / 2, y = (grid.ys[r1] + grid.ys[r2]) / 2;
      // sample near the start end of each half of the bridge
      const pts = r1 === r2 ? [[grid.xs[c1] + 0.3 * grid.Px, y], [grid.xs[c2] - 0.3 * grid.Px, y]]
        : [[x, grid.ys[r1] + 0.5 * grid.Py], [x, grid.ys[r2] - 0.35 * grid.Py]];
      const pk = pts.some(([px, py]) => pinkAt(px, py));
      if (pk) for (const k of [e.a.join(','), e.b.join(',')]) score.set(k, (score.get(k) || 0) + 1);
    }
    let best = null, bs = -Infinity;
    const cx = img.width / 2, cy = img.height / 2;
    for (let r = 0; r < grid.ys.length; r++) for (let c = 0; c < grid.xs.length; c++) {
      const s = (score.get(r + ',' + c) || 0) * 1e6 - Math.hypot(grid.xs[c] - cx, grid.ys[r] - cy);
      if (s > bs) { bs = s; best = [r, c]; }
    }
    return best;
  }

  // ---------- solver ----------
  // Exploring a node reveals its neighbours. A node can be explored once revealed. The start is
  // explored for free. Minimise explorations so every node in the region is revealed.
  // Equivalently: smallest set S with S ∪ {start} connected and dominating every node.
  function buildGraph(edges, start, region) {
    const key = (r, c) => r + ',' + c;
    const inR = ([r, c]) => !region || (r >= region.r0 && r <= region.r1 && c >= region.c0 && c <= region.c1);
    const adj = new Map();
    const add = k => { if (!adj.has(k)) adj.set(k, new Set()); };
    add(key(...start));
    for (const e of edges) if (e.on && inR(e.a) && inR(e.b)) {
      const a = key(...e.a), b = key(...e.b); add(a); add(b); adj.get(a).add(b); adj.get(b).add(a);
    }
    // keep only the component that contains the start; report the rest as unreachable
    const s = key(...start), seen = new Set([s]), st = [s];
    while (st.length) { const u = st.pop(); for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); st.push(v); } }
    const unreachable = [...adj.keys()].filter(k => !seen.has(k));
    for (const k of unreachable) adj.delete(k);
    for (const [, s2] of adj) for (const v of [...s2]) if (!adj.has(v)) s2.delete(v);
    return { adj, start: s, unreachable };
  }

  // opts.reveal: keys that must end up revealed (default: every node)
  // opts.explore: keys that must themselves be explored
  function solve(adj, start, maxSolutions = 500, budgetMs = 8000, opts = {}) {
    const nodes = [...adj.keys()], N = nodes.length, id = new Map(nodes.map((k, i) => [k, i]));
    const nb = nodes.map(k => [...adj.get(k)].map(v => id.get(v)));
    const S0 = id.get(start);
    // forced nodes: (a) the only neighbour of a leaf; (b) any cut vertex that separates the start
    // from part of the map — everything beyond it can only be revealed through it.
    const needR = new Uint8Array(N), needE = new Uint8Array(N);
    for (let i = 0; i < N; i++) needR[i] = opts.reveal ? 0 : 1;
    for (const k of opts.reveal || []) if (id.has(k)) needR[id.get(k)] = 1;
    for (const k of opts.explore || []) if (id.has(k)) needE[id.get(k)] = 1;
    needR[S0] = 0; needE[S0] = 0;
    const forced = new Set();
    for (let i = 0; i < N; i++) if (needE[i]) forced.add(i);
    for (let i = 0; i < N; i++) if (needR[i] && !needE[i] && i !== S0 && nb[i].length === 1 && nb[i][0] !== S0) forced.add(nb[i][0]);
    for (let v = 0; v < N; v++) {
      if (v === S0) continue;
      const seen = new Uint8Array(N); seen[S0] = 1; seen[v] = 1; const st = [S0];
      while (st.length) { const u = st.pop(); for (const w of nb[u]) if (!seen[w]) { seen[w] = 1; st.push(w); } }
      for (let j = 0; j < N; j++) if (!seen[j] && (needR[j] || needE[j])) { forced.add(v); break; }
    }
    forced.delete(S0);
    // candidates: nodes with ≥2 neighbours that aren't forced (a leaf never needs exploring)
    const cand = [];
    for (let i = 0; i < N; i++) if (i !== S0 && !forced.has(i) && nb[i].length > 1) cand.push(i);
    // order candidates by BFS distance from start so connectivity pruning bites early
    const dist = new Array(N).fill(1e9); dist[S0] = 0; const q = [S0];
    while (q.length) { const u = q.shift(); for (const w of nb[u]) if (dist[w] > dist[u] + 1) { dist[w] = dist[u] + 1; q.push(w); } }
    cand.sort((a, b) => dist[a] - dist[b]);

    const state = new Int8Array(N); // 1 in, 0 undecided, -1 out
    state[S0] = 1; for (const f of forced) state[f] = 1;
    for (let i = 0; i < N; i++) if (state[i] === 0 && !cand.includes(i)) state[i] = -1;

    let best = Infinity; const sols = []; let nodesVisited = 0; const t0 = Date.now(); let timedOut = false;
    const feasible = () => {
      // every node must be in, or next to, a node that is in or undecided
      for (let i = 0; i < N; i++) {
        if (state[i] >= 0 || !needR[i]) continue;
        let ok = false; for (const w of nb[i]) if (state[w] >= 0) { ok = true; break; }
        if (!ok) return false;
      }
      // all "in" nodes must be connectable through in/undecided nodes
      const seen = new Uint8Array(N); seen[S0] = 1; const st = [S0];
      while (st.length) { const u = st.pop(); for (const w of nb[u]) if (!seen[w] && state[w] >= 0) { seen[w] = 1; st.push(w); } }
      for (let i = 0; i < N; i++) if (state[i] === 1 && !seen[i]) return false;
      return true;
    };
    const complete = () => {
      for (let i = 0; i < N; i++) if (state[i] !== 1 && needR[i]) {
        let ok = false; for (const w of nb[i]) if (state[w] === 1) { ok = true; break; }
        if (!ok) return false;
      }
      const seen = new Uint8Array(N); seen[S0] = 1; const st = [S0];
      while (st.length) { const u = st.pop(); for (const w of nb[u]) if (!seen[w] && state[w] === 1) { seen[w] = 1; st.push(w); } }
      for (let i = 0; i < N; i++) if (state[i] === 1 && !seen[i]) return false;
      return true;
    };
    let inCount = 1 + forced.size;
    const rec = (k) => {
      if (timedOut) return;
      if ((++nodesVisited & 1023) === 0 && Date.now() - t0 > budgetMs) { timedOut = true; return; }
      if (inCount - 1 > best) return;
      if (!feasible()) return;
      if (k === cand.length) {
        if (!complete()) return;
        const steps = inCount - 1;
        if (steps < best) { best = steps; sols.length = 0; }
        if (sols.length < maxSolutions) sols.push(nodes.filter((_, i) => state[i] === 1 && i !== S0));
        return;
      }
      const v = cand[k];
      // try "out" first: finds small solutions early and tightens the bound
      state[v] = -1; rec(k + 1);
      state[v] = 1; inCount++; rec(k + 1); inCount--;
      state[v] = 0;
    };
    rec(0);
    const forcedKeys = [...forced].map(i => nodes[i]);
    return { steps: best, solutions: sols, forced: forcedKeys, truncated: sols.length >= maxSolutions, timedOut };
  }

  // Exploration order: depth-first from the start through the chosen set, so each branch is
  // finished before the next (every node is explored only after a neighbour has revealed it).
  function order(adj, start, set) {
    const S = new Set(set), out = [], seen = new Set([start]);
    const parse = k => k.split(',').map(Number);
    const dirRank = (from, to) => {
      const [r1, c1] = parse(from), [r2, c2] = parse(to);
      return r2 < r1 ? 0 : c2 > c1 ? 1 : r2 > r1 ? 2 : 3; // up, right, down, left
    };
    const revealed = new Set([start, ...adj.get(start)]);
    const visit = (u) => {
      const nx = [...adj.get(u)].filter(v => S.has(v) && !seen.has(v)).sort((a, b) => dirRank(u, a) - dirRank(u, b));
      for (const v of nx) {
        if (seen.has(v)) continue;
        seen.add(v);
        const reveals = [...adj.get(v)].filter(w => !revealed.has(w));
        reveals.forEach(w => revealed.add(w));
        out.push({ node: v, from: u, reveals });
        visit(v);
      }
    };
    visit(start);
    return out;
  }


  // ---------- layout ----------
  // Regular maps start in the centre of a 5-wide view; the variant starts at (3,1) of a 5×5 map.
  // Look at the largest connected group of detected nodes. If it spans exactly 5×5, the start is
  // whichever of the centre and the middle-left cell looks more like a bare junction.
  function components(edges) {
    const adj = new Map(), key = (r, c) => r + ',' + c;
    for (const e of edges) if (e.on) {
      const a = key(...e.a), b = key(...e.b);
      if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b); adj.get(b).push(a);
    }
    const seen = new Set(), comps = [];
    for (const k of adj.keys()) if (!seen.has(k)) {
      const comp = [k], st = [k]; seen.add(k);
      while (st.length) { const u = st.pop(); for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); comp.push(v); st.push(v); } }
      comps.push(comp);
    }
    return { comps, adj };
  }
  function startLikeness(G, grid, edges, r, c) {
    const inc = edges.filter(e => e.on && ((e.a[0] === r && e.a[1] === c) || (e.b[0] === r && e.b[1] === c)));
    if (inc.length < 2) return 0;
    const j = junctionScore(G, grid, r, c).dirs; // right, left, down, up
    let n = 0;
    for (const e of inc) {
      const o = (e.a[0] === r && e.a[1] === c) ? e.b : e.a;
      const d = o[1] > c ? 0 : o[1] < c ? 1 : o[0] > r ? 2 : 3;
      if (j[d] >= THR) n++;
    }
    return n / inc.length;
  }
  function detectLayout(G, img, grid, edges) {
    const { comps } = components(edges);
    if (!comps.length) return { variant: false, start: guessStart(img, grid, edges) };
    const big = comps.sort((a, b) => b.length - a.length)[0].map(k => k.split(',').map(Number));
    const r0 = Math.min(...big.map(p => p[0])), r1 = Math.max(...big.map(p => p[0]));
    const c0 = Math.min(...big.map(p => p[1])), c1 = Math.max(...big.map(p => p[1]));
    const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
    if (rows === 5 && cols === 5) {
      const mid = startLikeness(G, grid, edges, r0 + 2, c0 + 2), left = startLikeness(G, grid, edges, r0 + 2, c0);
      if (left > mid) return { variant: true, start: [r0 + 2, c0], bbox: { r0, r1, c0, c1 } };
      return { variant: false, start: [r0 + 2, c0 + 2], bbox: { r0, r1, c0, c1 } };
    }
    if (rows === 5 && cols % 2 === 1) return { variant: false, start: [r0 + 2, (c0 + c1) / 2], bbox: { r0, r1, c0, c1 } };
    return { variant: false, start: guessStart(img, grid, edges), bbox: { r0, r1, c0, c1 } };
  }

  // ---------- tavern search (evil variant) ----------
  // Best order to explore a fixed set: every step must already be revealed, and the candidates
  // should come as early as possible (smallest sum of their step numbers = highest chance of having
  // found the Tavern after each step, all candidates equally likely). Exact DP over subsets.
  function bestOrder(adj, start, set, cands) {
    const nodes = [...set], n = nodes.length, idx = new Map(nodes.map((k, i) => [k, i]));
    const isC = nodes.map(k => cands.has(k) ? 1 : 0);
    const nbm = nodes.map(k => { let m = 0; for (const v of adj.get(k)) if (idx.has(v)) m |= 1 << idx.get(v); return m; });
    const rootAdj = nodes.map(k => adj.get(start).has(k));
    const memo = new Map();
    const f = mask => {
      if (mask === (1 << n) - 1) return [0, -1];
      if (memo.has(mask)) return memo.get(mask);
      const pos = popcount(mask) + 1; let best = [Infinity, -1];
      for (let i = 0; i < n; i++) if (!(mask >> i & 1) && (rootAdj[i] || (nbm[i] & mask))) {
        const v = f(mask | 1 << i)[0] + (isC[i] ? pos : 0);
        if (v < best[0]) best = [v, i];
      }
      memo.set(mask, best); return best;
    };
    const out = []; let mask = 0, cost = f(0)[0];
    while (mask !== (1 << n) - 1) { const i = f(mask)[1]; if (i < 0) return null; out.push(nodes[i]); mask |= 1 << i; }
    return { seq: out, cost };
  }
  function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

  // every connected set S (start not counted) with |S| <= k, each exactly once
  function enumConnected(adj, start, k, cb, budgetMs = 4000) {
    const t0 = Date.now(); let stop = false, cnt = 0;
    const inSet = new Set([start]), list = [];
    const rec = (frontier, banned) => {
      if (stop) return;
      if ((++cnt & 4095) === 0 && Date.now() - t0 > budgetMs) { stop = true; return; }
      cb(list);
      if (list.length === k) return;
      const f = frontier.slice(), ban = new Set(banned);
      while (f.length) {
        const v = f.pop(); ban.add(v);
        inSet.add(v); list.push(v);
        const nf = f.slice();
        for (const w of adj.get(v)) if (!inSet.has(w) && !ban.has(w) && !nf.includes(w)) nf.push(w);
        rec(nf, ban);
        inSet.delete(v); list.pop();
        if (stop) return;
      }
    };
    rec([...adj.get(start)], new Set([start]));
    return !stop;
  }

  // Best order for a fixed explored set when a candidate counts as found once it is revealed:
  // minimise the sum of the steps at which candidates first appear (exact DP over subsets).
  function bestOrderReveal(adj, start, set, cands) {
    const nodes = [...set], n = nodes.length, idx = new Map(nodes.map((k, i) => [k, i]));
    const cl = [...cands], ci = new Map(cl.map((k, i) => [k, i]));
    const cm = k => { let m = 0; for (const v of adj.get(k)) if (ci.has(v)) m |= 1 << ci.get(v); return m; };
    const cmask = nodes.map(cm), base = cm(start);
    const nbm = nodes.map(k => { let m = 0; for (const v of adj.get(k)) if (idx.has(v)) m |= 1 << idx.get(v); return m; });
    const rootAdj = nodes.map(k => adj.get(start).has(k));
    const memo = new Map();
    const f = mask => {
      if (mask === (1 << n) - 1) return [0, -1];
      if (memo.has(mask)) return memo.get(mask);
      let rev = base; for (let i = 0; i < n; i++) if (mask >> i & 1) rev |= cmask[i];
      const pos = popcount(mask) + 1; let best = [Infinity, -1];
      for (let i = 0; i < n; i++) if (!(mask >> i & 1) && (rootAdj[i] || (nbm[i] & mask))) {
        const v = f(mask | 1 << i)[0] + pos * popcount(cmask[i] & ~rev);
        if (v < best[0]) best = [v, i];
      }
      memo.set(mask, best); return best;
    };
    const out = []; let mask = 0; const cost = f(0)[0];
    while (mask !== (1 << n) - 1) { const i = f(mask)[1]; if (i < 0) return null; out.push(nodes[i]); mask |= 1 << i; }
    return { seq: out, cost };
  }

  // Split an exploration order into independent paths: each explored node hangs from the earliest
  // explored neighbour (or the start); every leaf of that tree ends one path. Candidates that are
  // only revealed hang from the node that revealed them as dashed stubs.
  function splitPaths(adj, start, seq, cands) {
    const parent = new Map(), done = [start], children = new Map([[start, []]]);
    for (const v of seq) {
      const p = done.find(u => adj.get(u).has(v));
      parent.set(v, p); children.get(p).push(v); children.set(v, []); done.push(v);
    }
    const explored = new Set(seq);
    const stubs = [];
    for (const c of cands) if (!explored.has(c)) {
      const p = done.find(u => adj.get(u).has(c));
      if (p !== undefined) stubs.push({ from: p, to: c });
    }
    const leaves = seq.filter(v => children.get(v).length === 0);
    const paths = leaves.map(leaf => {
      const nodes = []; let v = leaf;
      while (v !== start) { nodes.unshift(v); v = parent.get(v); }
      return { nodes, stubs: [] };
    });
    // order paths by when their first own node is explored
    const step = new Map(seq.map((v, i) => [v, i]));
    const own = p => Math.min(...p.nodes.filter(v => paths.filter(q => q.nodes.includes(v)).length === 1).map(v => step.get(v)), Infinity);
    paths.sort((a, b) => own(a) - own(b));
    for (const s of stubs) {
      const p = paths.find(q => q.nodes[q.nodes.length - 1] === s.from) || paths.find(q => q.nodes.includes(s.from));
      if (p) p.stubs.push(s.to);
      else paths.push({ nodes: s.from === start ? [] : [s.from], stubs: [s.to] });
    }
    return paths;
  }

  // Candidates: nodes with exactly three bridges, except the start and any node already confirmed
  // not to be the Tavern. A candidate is found once it is revealed.
  // budget: how many explorations the player can spend. If checking every candidate fits, that is
  // the plan; otherwise the plan reveals as many candidates as the budget allows.
  function tavernPlan(adj, start, budget, exclude = []) {
    const ex = new Set(exclude);
    const cands = new Set([...adj.keys()].filter(k => k !== start && adj.get(k).size === 3 && !ex.has(k)));
    const empty = { route: [], paths: [], count: 0 };
    if (!cands.size) return { cands, steps: 0, paths: [], nSets: 1, budget, chosen: empty, fitsAll: true };
    const R = solve(adj, start, 300, 6000, { reveal: [...cands], explore: [] });
    let best = null;
    for (const S of R.solutions) {
      const o = bestOrderReveal(adj, start, S, cands);
      if (o && (!best || o.cost < best.cost)) best = o;
    }
    const route = best ? best.seq : [];
    const plan = { cands, steps: R.steps, nSets: R.solutions.length, route, budget, timedOut: R.timedOut,
      paths: splitPaths(adj, start, route, cands) };
    plan.fitsAll = isFinite(R.steps) && R.steps <= budget;
    if (plan.fitsAll) plan.chosen = { route, paths: plan.paths, count: cands.size, exhaustive: true };
    else if (budget < 1) plan.chosen = { ...empty, exhaustive: true };
    else {
      const base = new Set([start, ...adj.get(start)]);
      let top = -1, tops = [];
      const complete = enumConnected(adj, start, budget, list => {
        const rev = new Set(base); for (const v of list) for (const w of adj.get(v)) rev.add(w);
        let c = 0; for (const x of cands) if (rev.has(x)) c++;
        if (c > top) { top = c; tops = [list.slice()]; }
        else if (c === top && tops.length < 600) tops.push(list.slice());
      });
      let bo = null;
      for (const S of tops) {
        const o = bestOrderReveal(adj, start, S, cands);
        if (o && (!bo || S.length < bo.len || (S.length === bo.len && o.cost < bo.cost))) bo = { ...o, len: S.length };
      }
      const r2 = bo ? bo.seq : [];
      plan.chosen = { route: r2, paths: splitPaths(adj, start, r2, cands), count: Math.max(0, top), exhaustive: complete };
    }
    return plan;
  }

  // ---------- node names ----------
  // The name sits in a bar under the box. Text pixels are those clearly brighter than the bar.
  // Rows that are bright across almost the whole width are background (white scenery), not text.
  // The text block is cropped and resampled to 48×12, then compared with stored word templates.
  const TW = 48, TH = 12;
  function labelFeature(img, grid, r, c) {
    const { width: W, height: H, data } = img;
    const x0 = Math.round(grid.xs[c] - 0.29 * grid.Px), x1 = Math.round(grid.xs[c] + 0.29 * grid.Px);
    const y0 = Math.round(grid.ys[r] + 0.27 * grid.Py), y1 = Math.round(grid.ys[r] + 0.53 * grid.Py);
    if (x0 < 0 || y0 < 0 || x1 >= W || y1 >= H) return null;
    const w = x1 - x0, h = y1 - y0, b = new Float32Array(w * h), mn = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = ((y0 + y) * W + x0 + x) * 4, R = data[j], G = data[j + 1], B = data[j + 2];
      b[y * w + x] = (R + G + B) / 3; mn[y * w + x] = Math.min(R, G, B);
    }
    const med = Float32Array.from(b).sort()[b.length >> 1];
    const m = new Uint8Array(w * h);
    const rowN = new Array(h).fill(0);
    for (let i = 0; i < w * h; i++) if (b[i] > med + 30 && mn[i] > 170) { m[i] = 1; rowN[(i / w) | 0]++; }
    for (let y = 0; y < h; y++) if (rowN[y] > 0.8 * w) { rowN[y] = 0; for (let x = 0; x < w; x++) m[y * w + x] = 0; }
    // largest run of consecutive rows that contain text
    let best = null, cur = null;
    for (let y = 0; y <= h; y++) {
      if (y < h && rowN[y] >= 2) { if (!cur) cur = { a: y, n: 0 }; cur.n += rowN[y]; cur.b = y; }
      else if (cur) { if (!best || cur.n > best.n) best = cur; cur = null; }
    }
    if (!best || best.n < 25 || best.b - best.a + 1 < 0.05 * grid.Py) return null;
    let cx0 = w, cx1 = -1;
    for (let y = best.a; y <= best.b; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; }
    const bw = cx1 - cx0 + 1, bh = best.b - best.a + 1;
    // area-average resample to TW×TH
    const v = new Float64Array(TW * TH);
    for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
      const sx0 = cx0 + tx * bw / TW, sx1 = cx0 + (tx + 1) * bw / TW, sy0 = best.a + ty * bh / TH, sy1 = best.a + (ty + 1) * bh / TH;
      let s = 0, n = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) { s += m[y * w + x]; n++; }
      v[ty * TW + tx] = n ? s / n : 0;
    }
    if (bw / bh > 7) return null;                         // a full-width bright band, not a word
    return { v: normalise(blur(v)), aspect: bw / bh };
  }
  function blur(v) {
    const o = new Float64Array(v.length);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= TH || xx < 0 || xx >= TW) continue;
        s += v[yy * TW + xx]; n++;
      }
      o[y * TW + x] = s / n;
    }
    return o;
  }
  // correlation allowing the word to sit up to 2 columns / 1 row off
  function corr(t, f) {
    let best = -1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      let s = 0;
      for (let y = 0; y < TH; y++) { const yy = y + dy; if (yy < 0 || yy >= TH) continue;
        for (let x = 0; x < TW; x++) { const xx = x + dx; if (xx < 0 || xx >= TW) continue; s += t[y * TW + x] * f[yy * TW + xx]; } }
      if (s > best) best = s;
    }
    return best;
  }
  function normalise(v) {
    let mu = 0; for (const x of v) mu += x; mu /= v.length;
    let nn = 0; const o = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) { o[i] = v[i] - mu; nn += o[i] * o[i]; }
    nn = Math.sqrt(nn) || 1; for (let i = 0; i < v.length; i++) o[i] /= nn;
    return o;
  }
  let TEMPLATES = {}; // word -> Float64Array, filled by setTemplates
  function setTemplates(t) {
    TEMPLATES = {};
    for (const [k, b64] of Object.entries(t)) {
      const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
      const v = new Float64Array(TW * TH); for (let i = 0; i < v.length; i++) v[i] = bin.charCodeAt(i) / 255;
      TEMPLATES[k] = normalise(v);
    }
  }
  const MATCH = 0.65;
  function readLabel(img, grid, r, c) {
    const f = labelFeature(img, grid, r, c);
    if (!f) return { word: null, score: 0 };              // no text: unrevealed node
    let word = null, score = -1;
    for (const [k, t] of Object.entries(TEMPLATES)) { const s = corr(t, f.v); if (s > score) { score = s; word = k; } }
    return score >= MATCH ? { word, score } : { word: '?', score, guess: word };
  }

  // The start is a bare junction: its bridges run on into the cell centre, where every other
  // cell has a node box. Count directions with a bar between 0.10 and 0.21 of the pitch out.
  function junctionScore(G, grid, r, c) {
    const x = grid.xs[c], y = grid.ys[r], Px = grid.Px, Py = grid.Py;
    const oy = Math.max(3, Math.round(0.035 * Py)), ox = Math.max(3, Math.round(0.03 * Px));
    const dirs = [
      scanBar(G, true, y, 0.04 * Py, x + 0.10 * Px, x + 0.21 * Px, oy).score,
      scanBar(G, true, y, 0.04 * Py, x - 0.21 * Px, x - 0.10 * Px, oy).score,
      scanBar(G, false, x, 0.04 * Px, y + 0.12 * Py, y + 0.25 * Py, ox).score,
      scanBar(G, false, x, 0.04 * Px, y - 0.25 * Py, y - 0.12 * Py, ox).score];
    return { dirs, n: dirs.filter(s => s >= THR).length };
  }

  return { toGray, junctionScore, detectLayout, tavernPlan, bestOrder, splitPaths, labelFeature, setTemplates, readLabel, TW, TH, detectGrid, gridFromParams, analyse, guessStart, buildGraph, solve, order, THR, UNSURE, F };
})();

export default WL;
