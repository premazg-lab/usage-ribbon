import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionRateLimit, SessionContextUsage } from 'claude-code'

import type { Learn, Limit, Snap } from '../types'
import { FAMILIES, PRICES, emptyLearn, estimateFor, familyOf, hitOf, learnMeasure, learnTurn, savedOf } from './learn'
import type { Family } from './learn'
import { stringsFor } from './i18n'
import type { Strings } from './i18n'

const snap = atom({ plugin: 'usage-ribbon', key: 'snap' } as const, null)
const isOpen = atom({ plugin: 'usage-ribbon', key: 'isOpen' } as const, false)
const tick = atom({ plugin: 'usage-ribbon', key: 'tick' } as const, 0)
const chosen = atom({ plugin: 'usage-ribbon', key: 'model' } as const, null)
const learned = atom({ plugin: 'usage-ribbon', key: 'learn' } as const, null)

const C = { blue: '#5b9be0', amber: '#f5a623', red: '#e5534b', track: '#8d877540', mark: '#e8e2d2' }
const H = 3600_000
const DIVIDER = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="40" viewBox="0 0 1 40"><rect width="1" height="40" fill="${C.track}"/></svg>`
const WINDOWS: Record<string, number> = { five_hour: 5 * H, seven_day: 7 * 24 * H }

const tempoColor = (p: number) => (p < 80 ? C.blue : p < 100 ? C.amber : C.red)

function dur(ms: number) {
  const min = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

const clock = (ms: number, days: readonly string[]) => {
  const t = new Date(ms)
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return ms - Date.now() > 20 * H ? `${days[t.getDay()]} ${hm}` : hm
}

function windowOf(kind: string) {
  if (WINDOWS[kind]) return WINDOWS[kind]
  if (kind.startsWith('seven_day')) return WINDOWS.seven_day
  if (kind.startsWith('five_hour')) return WINDOWS.five_hour
  return undefined
}

function labelOf(kind: string, t: Strings): [string, string] {
  if (kind === 'five_hour') return ['5H', t.session]
  if (kind === 'seven_day') return ['7D', t.week]
  const model = kind.replace(/^(seven_day|five_hour)_?/, '')
  const name = model ? model.charAt(0).toUpperCase() + model.slice(1) : kind
  return [kind.startsWith('five_hour') ? '5H' : '7D', name]
}

type Pace = { kind: string; label: string; sub: string; used: number; elapsed: number; projected: number; resetIn: number; resetsAt: number }

function pace(l: Limit, now: number, t: Strings): Pace | undefined {
  const win = windowOf(l.kind)
  if (!win || !l.resetsAt) return undefined
  const resetsAt = Date.parse(l.resetsAt)
  const resetIn = Math.max(0, resetsAt - now)
  const elapsed = Math.min(1, Math.max(0, 1 - resetIn / win))
  const used = Math.round(l.pct)
  const projected = elapsed > 0.03 ? Math.round(l.pct / elapsed) : used
  const [label, sub] = labelOf(l.kind, t)
  return { kind: l.kind, label, sub, used, elapsed: elapsed * 100, projected, resetIn, resetsAt }
}

function verdict(p: Pace, t: Strings): [string, string] {
  if (p.projected >= 100 && p.used < 100) {
    const rate = (p.projected - p.used) / Math.max(1, p.resetIn)
    const hit = (100 - p.used) / rate
    return [t.runsOutIn(dur(hit)), t.beforeReset(dur(p.resetIn - hit))]
  }
  if (p.used >= 100) return [t.usedUp, t.waitingForReset]
  return [p.projected < 80 ? t.lastsUntilReset : t.tight, t.atThisPace(p.projected)]
}

// stretched bar: the svg is oversized (4000) and its box narrows it to its own width; the time mark stays thin
function stretchSvg(p: Pace, height: number) {
  const k = tempoColor(p.projected)
  const pad = 3
  const total = height + pad * 2
  const x = (v: number) => Math.min(100, Math.max(0, v)) * 10
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${total}" viewBox="0 0 1000 ${total}" preserveAspectRatio="none">`
    + `<rect x="0" y="${pad}" width="1000" height="${height}" fill="${C.track}"/>`
    + `<rect x="${x(p.used)}" y="${pad}" width="${Math.max(0, x(p.projected) - x(p.used))}" height="${height}" fill="${k}" fill-opacity="0.35"/>`
    + `<rect x="0" y="${pad}" width="${x(p.used)}" height="${height}" fill="${k}"/>`
    + `<line x1="${x(p.elapsed)}" y1="0" x2="${x(p.elapsed)}" y2="${total}" stroke="${C.mark}" stroke-width="2" vector-effect="non-scaling-stroke"/>`
    + `</svg>`
}

function fillSvg(pct: number, color: string | undefined) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3" viewBox="0 0 1000 3" preserveAspectRatio="none">`
    + `<rect width="1000" height="3" fill="${C.track}"/>`
    + (color ? `<rect width="${Math.min(100, Math.max(0, pct)) * 10}" height="3" fill="${color}"/>` : '')
    + `</svg>`
}

function barSvg(p: Pace, width: number, height: number) {
  const k = tempoColor(p.projected)
  const pad = 3
  const total = height + pad * 2
  const x = (v: number) => (Math.min(100, Math.max(0, v)) / 100) * width
  const r = height / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">`
    + `<rect x="0" y="${pad}" width="${width}" height="${height}" rx="${r}" fill="${C.track}"/>`
    + `<rect x="${x(p.used)}" y="${pad}" width="${Math.max(0, x(p.projected) - x(p.used))}" height="${height}" fill="${k}" fill-opacity="0.35"/>`
    + `<rect x="0" y="${pad}" width="${x(p.used)}" height="${height}" rx="${r}" fill="${k}"/>`
    + `<rect x="${Math.max(0, x(p.elapsed) - 1)}" y="0" width="2" height="${total}" rx="1" fill="${C.mark}"/>`
    + `</svg>`
}

function plainBar(p: Pace, cells: number) {
  const used = Math.round((Math.min(100, p.used) / 100) * cells)
  const proj = Math.round((Math.min(100, p.projected) / 100) * cells)
  return '█'.repeat(used) + '▓'.repeat(Math.max(0, proj - used)) + '░'.repeat(Math.max(0, cells - Math.max(used, proj)))
}

const money = (usd: number) => `$${usd.toFixed(2)}`

type Cache = { isWarm: boolean; left: number; idle: number; tokens: number; family?: Family }

function cacheOf(s: Snap, now: number, ttlMs: number): Cache | undefined {
  if (s.lastReplyAt === undefined) return undefined
  const idle = now - s.lastReplyAt
  return { isWarm: idle < ttlMs, left: ttlMs - idle, idle, tokens: s.ctxTokens ?? 0, family: familyOf(s.model) }
}

function nextCost(c: Cache, f: Family) {
  const price = PRICES[f]
  const perToken = c.isWarm && c.family === f ? price.read : price.input * 2
  return (c.tokens / 1_000_000) * perToken
}

const limitsOf = (limits: SessionRateLimit[]): Limit[] => limits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt }))

// an empty reading (no reply yet) keeps the limits the band already has
function snapFrom(limits: SessionRateLimit[], context: SessionContextUsage, prev: Snap | null): Snap {
  const fresh = limitsOf(limits)
  return {
    ...prev,
    limits: fresh.length ? fresh : prev?.limits ?? [],
    ctxTokens: context.tokens ?? prev?.ctxTokens,
    ctxWindow: context.window,
  }
}

// the last limits any session read, so a new session's band shows them before its first reply
async function remember($: EngineInterface, limits: SessionRateLimit[]) {
  if (limits.length) await $.store.set('limits', limitsOf(limits))
}

async function recall($: EngineInterface, now: number): Promise<Limit[]> {
  const stored = ((await $.store.get('limits')) as Limit[] | undefined) ?? []
  return stored.filter(l => l.resetsAt && Date.parse(l.resetsAt) > now)
}

async function learn($: EngineInterface, fn: (l: Learn) => Learn) {
  const next = fn((await read($, learned)) ?? emptyLearn())
  await update($, learned, () => next)
  await $.store.set('learn', next)
}

const familyName = (f: Family) => f.charAt(0) + f.slice(1).toLowerCase()

export const register: Register = (on, options) => {
  const ttlMs = (Number(options.cacheTtlMinutes) || 60) * 60_000
  const t = stringsFor(options.language)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    const kept = await recall($, await $.clock.now())
    await update($, snap, prev => snapFrom(usage.rateLimits, usage.context, { ctxWindow: 0, ...prev, limits: prev?.limits.length ? prev.limits : kept }))
    await remember($, usage.rateLimits)
    const stored = (await $.store.get('learn')) as Learn | undefined
    await update($, learned, () => stored ?? emptyLearn())
    $.clock.every(30_000, () => void update($, tick, n => (n ?? 0) + 1))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, snap, prev => snapFrom(e.rateLimits, e.context, prev ?? null))
    await remember($, e.rateLimits)
    const week = e.rateLimits.find(l => l.kind === 'seven_day')
    if (week) await learn($, l => learnMeasure(l, week.percentUsed, week.resetsAt))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const fam = familyOf(e.usage?.model)
    const u = e.usage
    const tokens = u && { in: u.input_tokens, out: u.output_tokens, cr: u.cache_read_input_tokens, cw: u.cache_creation_input_tokens }
    if (tokens && fam) await learn($, l => learnTurn(l, now, fam, tokens))
    const saved = tokens && fam ? savedOf(fam, tokens) : 0
    const isMain = e.agentId === undefined && !e.isAborted
    await update($, snap, prev => ({
      limits: [],
      ctxWindow: 0,
      ...prev,
      saved: (prev?.saved ?? 0) + saved,
      ...(isMain && { lastReplyAt: now, model: u?.model ?? prev?.model, lastHit: tokens ? hitOf(tokens) ?? prev?.lastHit : prev?.lastHit }),
    }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    await read($, tick)
    if (e.props.hasSurvey || !s) return next(e)

    const now = await $.clock.now()
    const paces = s.limits.map(l => pace(l, now, t)).filter((p): p is Pace => p !== undefined)
    const cache = cacheOf(s, now, ttlMs)
    if (paces.length === 0 && !cache) return next(e)

    const open = (await read($, isOpen)) ?? false
    const toggle = async () => {
      await update($, isOpen, v => !v)
      if (open) await update($, chosen, () => null)
    }
    const main = paces.filter(p => p.kind === 'five_hour' || p.kind === 'seven_day')
    const mood = cache ? (cache.isWarm ? { word: t.warm, icon: '♨', color: C.amber } : { word: t.cold, icon: '❄', color: C.blue }) : undefined
    const myCost = cache?.family ? money(nextCost(cache, cache.family)) : undefined
    const moodValue = cache ? (cache.isWarm ? [dur(cache.left), myCost] : [myCost, dur(cache.idle)]).filter(Boolean) : []

    // third bar: estimated 7D if the same work were done by the chosen model alone
    const week = paces.find(p => p.kind === 'seven_day')
    // follows the current model; a manual pick ("CHOSEN|CURRENT") holds until the model changes or the card closes
    const current: Family = cache?.family ?? 'OPUS'
    const [manual, base] = ((await read($, chosen)) ?? '').split('|')
    const pick: Family = manual && base === current && manual in PRICES ? (manual as Family) : current
    const est = week ? estimateFor((await read($, learned)) ?? emptyLearn(), pick) : undefined
    const modelPace: Pace | undefined = week && est
      ? { ...week, sub: pick, projected: Math.round(week.used + (week.projected - week.used) * est.factor) }
      : undefined
    const cycle = () => update($, chosen, () => `${FAMILIES[(FAMILIES.indexOf(pick) + 1) % FAMILIES.length]}|${current}`)
    const [modelSay, modelMore] = modelPace ? verdict(modelPace, t) : [t.learning, t.needsMoreReplies]
    const modelColor = modelPace ? tempoColor(modelPace.projected) : C.mark
    const basis = est ? `${t.estimate} · ${est.basis === 'learned' ? t.learned(est.steps) : t.fromPrices}` : t.estimate
    // the closed row repeats the model estimate after 7D, once a reply has told which model is current
    const rowPace = cache?.family ? modelPace : undefined
    const abbr = pick.slice(0, 2)

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {open && paces.map(p => {
            const [say, more] = verdict(p, t)
            return (
              <Box key={`t-${p.label}-${p.sub}`} gap={1}>
                <Text dimColor>{p.label} {p.sub.padEnd(7)}</Text>
                <Text color={tempoColor(p.projected)}>{plainBar(p, 20)} {p.used}%</Text>
                <Text color={tempoColor(p.projected)}>{say}</Text>
                <Text dimColor>{more} · {t.resets} {dur(p.resetIn)}</Text>
              </Box>
            )
          })}
          {open && week && (
            <Box key="t-model" gap={1}>
              <Text dimColor>7D</Text>
              <Button key="model" plain onPress={cycle}>{familyName(pick).padEnd(6)} ›</Button>
              <Text color={modelColor}>{plainBar(modelPace ?? week, 20)} {modelPace ? `~${modelPace.projected}` : week.used}%</Text>
              <Text color={modelColor}>{modelSay}</Text>
              <Text dimColor>{modelMore} · {basis}</Text>
            </Box>
          )}
          <Box gap={1}>
            {main.map(p => (
              <Text key={`r-${p.label}`}>
                <Text dimColor>{p.label} </Text>
                <Text color={tempoColor(p.projected)}>{plainBar(p, 8)}</Text> {p.used}% <Text dimColor>{dur(p.resetIn)}</Text>
                {p.kind === 'seven_day' && rowPace && (
                  <Text> <Text dimColor>·</Text> <Text color={C.amber}>{abbr}</Text> <Text color={tempoColor(rowPace.projected)}>~{rowPace.projected}%</Text></Text>
                )}
              </Text>
            ))}
            {mood && <Text color={mood.color}>{mood.word}</Text>}
            {mood && <Text>{moodValue.join(' · ')}</Text>}
            <Button key="toggle" plain label={open ? '▾' : '▴'} onPress={toggle} />
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const small = (p: Pace) => <Svg key={`b-${p.label}`} source={barSvg(p, 90, 4)} alt={`${p.label} ${p.used}%, tempo ${p.projected}%`} width={90} height={10} />

    const row = (
      // same indent as the open card's content (its paddingX), so 5H sits under 5H
      <Box flexDirection="row" alignItems="center" gap={1} paddingX={1}>
        {main.map(p => (
          <Box key={`m-${p.label}`} flexDirection="row" alignItems="center" gap={1}>
            <Text dimColor>{p.label}</Text>
            {small(p)}
            <Text>{p.used}%</Text>
            <Text dimColor>{dur(p.resetIn)}</Text>
            {p.kind === 'seven_day' && rowPace && <Text dimColor>·</Text>}
            {p.kind === 'seven_day' && rowPace && <Text color={C.amber}>{abbr}</Text>}
            {p.kind === 'seven_day' && rowPace && <Text color={tempoColor(rowPace.projected)}>~{rowPace.projected}%</Text>}
          </Box>
        ))}
        {mood && (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={mood.color}>{mood.icon} {mood.word}</Text>
            <Text color={cache && !cache.isWarm ? C.blue : undefined}>{moodValue[0]}</Text>
            {moodValue[1] && <Text dimColor>·</Text>}
            {moodValue[1] && <Text>{moodValue[1]}</Text>}
          </Box>
        )}
        <Box flexGrow={1} />
        <Button key="toggle" plain label={open ? '⌄' : '⌃'} onPress={toggle} />
      </Box>
    )

    if (!open) return row

    // every bar has the same columns in both rows: label, subtitle, middle (bar / description) and percent,
    // so the bars start and end at the same place and the description runs exactly under its bar
    const LABEL = 3
    const SUB = 7
    const PCT = 6
    const gauge = (
      key: string,
      label: string,
      sub: RenderChildren,
      source: string,
      alt: string,
      pct: string,
      color: string,
      say: string,
      more: string,
      right: string,
    ) => (
      <Box key={key} flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Box width={LABEL} flexShrink={0}><Text dimColor>{label}</Text></Box>
          <Box width={SUB} flexShrink={0}>{sub}</Box>
          <Box flexGrow={1} minWidth={0}><Svg source={source} alt={alt} height={11} /></Box>
          <Box width={PCT} flexShrink={0} justifyContent="flex-end"><Text color={color}>{pct}</Text></Box>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Box width={LABEL} flexShrink={0} />
          <Box width={SUB} flexShrink={0} />
          <Box flexGrow={1} minWidth={0} flexDirection="row" gap={1}>
            <Text color={color}>{say}</Text>
            <Text dimColor>{more}</Text>
            <Box flexGrow={1} />
            <Text dimColor>{right}</Text>
          </Box>
          <Box width={PCT} flexShrink={0} />
        </Box>
      </Box>
    )

    const blocks = paces.map(p => {
      const [say, more] = verdict(p, t)
      return gauge(
        `p-${p.label}-${p.sub}`,
        p.label,
        <Text dimColor>{p.sub}</Text>,
        stretchSvg(p, 5),
        `${p.label} ${p.sub}: ${p.used}%, ${say}`,
        `${p.used}%`,
        tempoColor(p.projected),
        say,
        more,
        `${t.resets} ${dur(p.resetIn)} · ${clock(p.resetsAt, t.days)}`,
      )
    })

    const modelBlock = week && gauge(
      'p-model',
      '7D',
      // the button has its own inner padding: it is shifted left (into the gap after "7D") so the name starts in the session/week column
      <Box marginLeft={-1}>
        <Button key="model" plain onPress={cycle}><Text color={C.amber}>{familyName(pick)} ›</Text></Button>
      </Box>,
      stretchSvg(modelPace ?? { ...week, projected: week.used }, 5),
      `7D ${familyName(pick)}: ${t.estimate} ${modelPace ? `~${modelPace.projected}%` : t.noData}`,
      modelPace ? `~${modelPace.projected}%` : `${week.used}%`,
      modelColor,
      modelSay,
      modelMore,
      basis,
    )

    const pctCtx = s.ctxWindow ? Math.round(((cache?.tokens ?? 0) / s.ctxWindow) * 100) : 0
    const ctxBar = fillSvg(pctCtx, cache?.isWarm ? mood?.color : undefined)
    const idleBar = cache?.isWarm
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="3" viewBox="0 0 50 3"><rect width="50" height="3" rx="1.5" fill="${C.track}"/><rect width="${Math.min(1, cache.idle / ttlMs) * 50}" height="3" rx="1.5" fill="${C.amber}"/></svg>`
      : ''

    const bottom = cache && mood && (
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" gap={0}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={mood.color}>{mood.icon} {mood.word}</Text>
            <Text>{cache.isWarm ? dur(cache.left) : dur(cache.idle)}</Text>
            {idleBar && <Svg source={idleBar} alt={`${t.idle} ${dur(cache.idle)}`} width={50} height={3} />}
          </Box>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text dimColor>{t.cache}</Text>
            <Text color={s.lastHit !== undefined && s.lastHit < 50 ? C.blue : undefined}>{s.lastHit !== undefined ? `${s.lastHit}%` : '–'}</Text>
            <Text dimColor>·</Text>
            <Text dimColor>{t.saved}</Text>
            <Text>{money(Math.max(0, s.saved ?? 0))}</Text>
          </Box>
        </Box>
        <Svg source={DIVIDER} alt="" width={1} height={40} />
        <Box flexDirection="column" gap={0} flexGrow={1}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
              <Text dimColor>{t.inCache}</Text>
              <Text>{cache.isWarm ? `${Math.round(cache.tokens / 1000)}k` : '0'}</Text>
              <Text dimColor>{t.tokens}</Text>
            </Box>
            <Box flexGrow={1} minWidth={0}><Svg source={ctxBar} alt={`${t.context} ${pctCtx}%`} height={3} /></Box>
            <Box flexShrink={0}>
              <Text dimColor>
                {cache.isWarm ? `${pctCtx}% ${t.of} ${Math.round(s.ctxWindow / 1000)}k` : `${t.resend} ${Math.round(cache.tokens / 1000)}k`}
              </Text>
            </Box>
          </Box>
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Text dimColor>{t.next}</Text>
            {FAMILIES.map(f => (
              <Box key={`c-${f}`} flexDirection="row" alignItems="center" gap={1}>
                <Text color={f === cache.family ? mood.color : undefined} dimColor={f !== cache.family} underline={f === cache.family}>{f}</Text>
                <Text dimColor={f !== cache.family}>{money(nextCost(cache, f))}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="column" gap={0} borderStyle="round" paddingX={1}>
          {blocks}
          {modelBlock}
          {bottom}
        </Box>
        {row}
      </Box>
    )
  })
}
