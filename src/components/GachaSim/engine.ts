// Pull engine for the Arknights headhunting simulator.
// Rules are taken from the Arknights wiki (arknights.wiki.gg/wiki/Headhunting) and the game's own data tables.

export interface Op { n: string; r: number; c: string; a: string; l: number; p: number }
export interface Banner {
  id: string;
  name: string;
  type: 'lt' | 'lim' | 'link';
  start: string;
  end: string;
  focused: boolean;
  guarantee?: number;
  up6: string[];
  up5: string[];
  up4: string[];
  primary?: string[];
  limited6?: string[];
}
export interface Data { banners: Banner[]; ops: Record<string, Op> }

export interface Pity { s6: number; s5: number }
export interface BannerState { pulls: number; focusedDone: boolean; targetDone: boolean; contracts: number }
export interface Totals { pulls: number; spent: number; r6: number; r5: number; r4: number; r3: number }
export interface Save {
  balance: number;
  pity: Record<string, Pity>;
  banners: Record<string, BannerState>;
  owned: string[];
  totals: Totals;
}
export interface PullResult { id: string; r: number; pityBefore: number; bannerPull: number }

export const COST = 600;
export const BASE6 = 0.02;
export const BASE5 = 0.08;
export const BASE4 = 0.5;
export const BASE3 = 0.4;
export const SOFT_PITY_START = 50; // after 50 pulls without a 6*, +2% per pull
export const FOCUSED_AFTER = 150;
export const SPARK_6 = 300;
export const SPARK_5 = 75;

export function newSave(balance = 6000): Save {
  return {
    balance,
    pity: {},
    banners: {},
    owned: [],
    totals: { pulls: 0, spent: 0, r6: 0, r5: 0, r4: 0, r3: 0 },
  };
}

/** Limited-Time banners share one pity counter ("standard"); limited and crossover banners are tracked on their own. */
export function seriesKey(b: Banner): string {
  return b.type === 'lt' ? 'standard' : b.id;
}

export function rate6(sinceLast6: number): number {
  if (sinceLast6 < SOFT_PITY_START) return BASE6;
  return Math.min(1, BASE6 + 0.02 * (sinceLast6 - SOFT_PITY_START + 1));
}

export function bannerState(save: Save, b: Banner): BannerState {
  return (save.banners[b.id] ??= { pulls: 0, focusedDone: false, targetDone: false, contracts: 0 });
}
export function pityState(save: Save, b: Banner): Pity {
  return (save.pity[seriesKey(b)] ??= { s6: 0, s5: 0 });
}

function pickUniform<T>(list: T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)];
}
function pickWeighted(list: { id: string; w: number }[], rng: () => number): string {
  const total = list.reduce((s, x) => s + x.w, 0);
  let t = rng() * total;
  for (const x of list) {
    t -= x.w;
    if (t < 0) return x.id;
  }
  return list[list.length - 1].id;
}

/** Operators that can come out of the non-rate-up part of a banner. */
export function offPool(data: Data, b: Banner, rarity: number): string[] {
  const exclude = new Set([...b.up6, ...b.up5, ...b.up4]);
  const out: string[] = [];
  for (const [id, o] of Object.entries(data.ops)) {
    if (o.r === rarity && o.p && !o.l && o.a <= b.start && !exclude.has(id)) out.push(id);
  }
  return out;
}

/** Weighted candidates for the non-primary 30% of a Limited Headhunting 6* pull. */
function limitedOff6(data: Data, b: Banner): { id: string; w: number }[] {
  const primary = new Set(b.primary ?? []);
  const list: { id: string; w: number }[] = [];
  for (const id of b.up6) if (!primary.has(id)) list.push({ id, w: 5 }); // secondary rate-up: 5x weight
  for (const id of offPool(data, b, 6)) list.push({ id, w: 1 });
  return list;
}

function pick6(data: Data, b: Banner, bs: BannerState, rng: () => number): string {
  if (b.type === 'link') {
    const target = b.up6;
    if (!bs.targetDone && bs.pulls >= (b.guarantee ?? 120)) return pickUniform(target, rng);
    if (target.length && rng() < 0.5) return pickUniform(target, rng);
    return pickUniform(offPool(data, b, 6), rng);
  }
  if (b.type === 'lim') {
    const prim = b.primary ?? [];
    if (prim.length && rng() < 0.7) return pickUniform(prim, rng);
    return pickWeighted(limitedOff6(data, b), rng);
  }
  // limited-time
  if (b.focused && !bs.focusedDone && bs.pulls > FOCUSED_AFTER && b.up6.length) return pickUniform(b.up6, rng);
  if (b.up6.length && rng() < 0.5) return pickUniform(b.up6, rng);
  return pickUniform(offPool(data, b, 6), rng);
}

function pickLower(data: Data, b: Banner, rarity: number, rng: () => number): string {
  const ups = rarity === 5 ? b.up5 : rarity === 4 ? b.up4 : [];
  const chance = rarity === 4 ? 0.2 : 0.5;
  if (ups.length && rng() < chance) return pickUniform(ups, rng);
  return pickUniform(offPool(data, b, rarity), rng);
}

/** One headhunting pull. Mutates `save` (pity, counters, totals) but does not touch the balance. */
export function pullOnce(data: Data, b: Banner, save: Save, rng: () => number = Math.random): PullResult {
  const pity = pityState(save, b);
  const bs = bannerState(save, b);
  bs.pulls += 1;
  const pityBefore = pity.s6;

  let p6 = rate6(pity.s6);
  const rest = 1 - p6;
  const p5 = (BASE5 / (1 - BASE6)) * rest;
  const p4 = (BASE4 / (1 - BASE6)) * rest;

  let rarity: number;
  const forcedTarget = b.type === 'link' && !bs.targetDone && bs.pulls >= (b.guarantee ?? 120);
  if (forcedTarget) {
    rarity = 6;
  } else {
    const x = rng();
    rarity = x < p6 ? 6 : x < p6 + p5 ? 5 : x < p6 + p5 + p4 ? 4 : 3;
    // a 5* or higher is guaranteed within every 10 pulls: the 10th pull is lifted to 5* if it would have been lower
    if (rarity < 5 && pity.s5 >= 9) rarity = 5;
  }

  let id: string;
  if (rarity === 6) {
    id = pick6(data, b, bs, rng);
    pity.s6 = 0;
    pity.s5 = 0;
    if (b.type === 'lt' && b.focused && b.up6.includes(id)) bs.focusedDone = true;
    if (b.type === 'link' && b.up6.includes(id)) bs.targetDone = true;
  } else if (rarity === 5) {
    id = pickLower(data, b, 5, rng);
    pity.s6 += 1;
    pity.s5 = 0;
  } else {
    id = pickLower(data, b, rarity, rng);
    pity.s6 += 1;
    pity.s5 += 1;
  }
  if (b.type === 'lim') bs.contracts += 1;

  save.totals.pulls += 1;
  save.totals[`r${rarity}` as 'r6' | 'r5' | 'r4' | 'r3'] += 1;
  return { id, r: rarity, pityBefore, bannerPull: bs.pulls };
}

/** Per-pull probability of each rate-up operator at base rates (before pity), for display. */
export function baseOdds(data: Data, b: Banner): { id: string; rate: number }[] {
  const out: { id: string; rate: number }[] = [];
  if (b.type === 'lim') {
    const prim = b.primary ?? [];
    for (const id of prim) out.push({ id, rate: (BASE6 * 0.7) / prim.length });
    const off = limitedOff6(data, b);
    const total = off.reduce((s, x) => s + x.w, 0);
    for (const x of off) if (b.up6.includes(x.id)) out.push({ id: x.id, rate: (BASE6 * 0.3 * x.w) / total });
  } else {
    for (const id of b.up6) out.push({ id, rate: (BASE6 * 0.5) / b.up6.length });
  }
  for (const id of b.up5) out.push({ id, rate: (BASE5 * 0.5) / b.up5.length });
  for (const id of b.up4) out.push({ id, rate: (BASE4 * 0.2) / b.up4.length });
  return out;
}
