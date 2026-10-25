export type Limit = { kind: string; pct: number; resetsAt?: string }

export type Snap = {
  limits: Limit[]
  ctxTokens?: number
  ctxWindow: number
  lastReplyAt?: number
  model?: string
  /** Share of the last reply's input read from the cache, 0 to 100. */
  lastHit?: number
  /** Net cache savings in this session, in dollars. */
  saved?: number
}

/** One reply's tokens: input, output, cache read and cache write. */
export type Tokens = { in: number; out: number; cr: number; cw: number }

/** One reply the mod recorded: when, which model, how many tokens. */
export type Entry = Tokens & { t: number; fam: string }

/** How many 7D points rose for how many dollars of spend. */
export type Tally = { usd: number; pts: number }

/** What the mod has learned about how models use the weekly limit; kept across sessions. */
export type Learn = {
  entries: Entry[]
  perFamily: Record<string, Tally>
  global: Tally
  pending: Record<string, number>
  steps: number
  lastPct?: number
  lastReset?: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-ribbon': {
      snap: Snap | null
      isOpen: boolean
      tick: number
      model: string | null
      learn: Learn | null
    }
  }
}
