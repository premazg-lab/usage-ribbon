import type { Entry, Learn, Tally, Tokens } from '../types'

// $/MTok: input, output and cache read; writing the 1h cache costs 2x input
export const PRICES = {
  FABLE: { input: 10, output: 50, read: 0.25 },
  OPUS: { input: 4, output: 20, read: 0.2 },
  SONNET: { input: 2, output: 10, read: 0.2 },
  HAIKU: { input: 0.1, output: 0.5, read: 0.01 },
} as const
export type Family = keyof typeof PRICES
export const FAMILIES = Object.keys(PRICES) as Family[]

const WEEK = 7 * 24 * 3600_000
const MAX_ENTRIES = 3000
// 7D steps a model needs before its own ratio counts for more than prices
const MIN_POINTS = 3
// share of spend above which a 7D step is credited to one model
const DOMINANT = 0.9

export const emptyLearn = (): Learn => ({ entries: [], perFamily: {}, global: { usd: 0, pts: 0 }, pending: {}, steps: 0 })

export function familyOf(model?: string): Family | undefined {
  const id = (model ?? '').toLowerCase()
  return FAMILIES.find(f => id.includes(f.toLowerCase()))
}

export function usdOf(fam: Family, t: Tokens) {
  const p = PRICES[fam]
  return (t.in * p.input + t.out * p.output + t.cr * p.read + t.cw * p.input * 2) / 1_000_000
}

/** What the cache saved on these tokens: reads instead of full input, less the extra paid to write it. */
export function savedOf(fam: Family, t: Tokens) {
  const p = PRICES[fam]
  return (t.cr * (p.input - p.read) - t.cw * p.input) / 1_000_000
}

/** Share of input read from the cache, 0 to 100; undefined when there was no input. */
export function hitOf(t: Tokens) {
  const total = t.in + t.cr + t.cw
  return total > 0 ? Math.round((t.cr / total) * 100) : undefined
}

const isFamily =(f: string): f is Family => f in PRICES

/** Record a reply: its tokens go into the history, its cost waits for the next 7D step. */
export function learnTurn(l: Learn, now: number, fam: Family, t: Tokens): Learn {
  const entries = [...l.entries, { ...t, t: now, fam }].filter(x => x.t > now - WEEK).slice(-MAX_ENTRIES)
  const pending = { ...l.pending, [fam]: (l.pending[fam] ?? 0) + usdOf(fam, t) }
  return { ...l, entries, pending }
}

const add = (a: Tally | undefined, usd: number, pts: number): Tally => ({ usd: (a?.usd ?? 0) + usd, pts: (a?.pts ?? 0) + pts })

/** A new 7D reading: the rise is credited to the spend since the last reading. */
export function learnMeasure(l: Learn, pct: number, resetsAt?: string): Learn {
  const isNewWindow = l.lastPct === undefined || l.lastReset !== resetsAt || pct < l.lastPct
  if (isNewWindow) return { ...l, lastPct: pct, lastReset: resetsAt, pending: {} }

  const delta = pct - (l.lastPct ?? pct)
  const total = Object.values(l.pending).reduce((a, b) => a + b, 0)
  if (delta <= 0 || total <= 0) return { ...l, lastPct: pct }

  const perFamily = { ...l.perFamily }
  const top = Object.entries(l.pending).sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] / total >= DOMINANT) perFamily[top[0]] = add(perFamily[top[0]], total, delta)

  return { ...l, perFamily, global: add(l.global, total, delta), pending: {}, steps: l.steps + 1, lastPct: pct }
}

/** 7D points per dollar for a model: its learned ratio, else the shared one, else 1 (prices alone). */
function pointsPerUsd(l: Learn, fam: Family) {
  const own = l.perFamily[fam]
  if (own && own.pts >= MIN_POINTS && own.usd > 0) return own.pts / own.usd
  if (l.global.pts >= MIN_POINTS && l.global.usd > 0) return l.global.pts / l.global.usd
  return 1
}

export type ModelEstimate = { factor: number; basis: 'prices' | 'learned'; steps: number }

/**
 * How much faster (or slower) 7D would grow if the chosen model did all the work:
 * the same tokens, repriced at its price and its learned ratio.
 */
export function estimateFor(l: Learn, fam: Family): ModelEstimate | undefined {
  let actual = 0
  let asFam = 0
  for (const x of l.entries as Entry[]) {
    if (!isFamily(x.fam)) continue
    actual += usdOf(x.fam, x) * pointsPerUsd(l, x.fam)
    asFam += usdOf(fam, x) * pointsPerUsd(l, fam)
  }
  if (actual <= 0) return undefined
  const isLearned = l.global.pts >= MIN_POINTS
  return { factor: asFam / actual, basis: isLearned ? 'learned' : 'prices', steps: l.steps }
}
