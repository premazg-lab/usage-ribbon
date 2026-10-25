import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-25T12:00:00Z')
const MIN = 60_000

const BAND = {
  plugin: 'usage-ribbon',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the band shows warm, and the open card shows pace and price, on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 500_000, tokens: 245_000, percent: 49 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 38, resetsAt: new Date(NOW + 100 * MIN).toISOString() },
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 81 * 60 * MIN).toISOString() },
      ],
    },
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })
  await clock.advance(7 * MIN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /WARM/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /lasts until reset/ })).toBeUndefined()

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /lasts until reset/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /^\$0\.05$/ })).toBeDefined()

  // third bar: Opus did all the work, so its estimate is the same pace as 7D (~79%)
  expect(await ui.find({ type: 'Text', text: /estimate · from prices/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^~79%$/ })).toBeDefined()
  // Sonnet is half the price: ~60%; Fable costs 2.5x: over the limit
  await ui.press({ key: 'model' })
  expect(await ui.find({ type: 'Text', text: /^Sonnet ›$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^~60%$/ })).toBeDefined()
  await ui.press({ key: 'model' })
  await ui.press({ key: 'model' })
  expect(await ui.find({ type: 'Text', text: /^Fable ›$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /runs out in/ })).toBeDefined()
  // closing the card puts the bar back on the current model
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /^Opus ›$/ })).toBeDefined()
  await ui.press({ key: 'toggle' })
  await ui.unmount()
})

test('the card shows the cache hit rate and the savings', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 500_000, tokens: 100_000, percent: 20 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 81 * 60 * MIN).toISOString() }],
    },
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 3_000, output_tokens: 500, cache_read_input_tokens: 97_000, cache_creation_input_tokens: 0 },
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /^97%$/ })).toBeDefined()
  // 97k cached tokens x ($4 - $0.20) per million
  expect(await ui.find({ type: 'Text', text: /^\$0\.37$/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
  await ui.unmount()
})

test('a 7D rise is credited to the model that spent', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 500_000 }, rateLimits: [] } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  const resetsAt = new Date(NOW + 81 * 60 * MIN).toISOString()
  const measure = (pct: number) =>
    $.session.measure({ context: { window: 500_000 }, rateLimits: [{ kind: 'seven_day', percentUsed: pct, resetsAt }], changed: ['rateLimits'] })
  const turn = (id: string) =>
    $.turn.complete({
      answer: 'ok', durationMs: 1, isAborted: false, turnId: id, reason: 'answer',
      usage: { model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await measure(40)
  for (let i = 0; i < 4; i++) {
    await turn(`t${i}`)
    await measure(41 + i)
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /estimate · learned \(4\)/ })).toBeDefined()
  await ui.unmount()
})

test('after an idle hour the band says cold', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 500_000, tokens: 245_000, percent: 49 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 71, resetsAt: new Date(NOW + 100 * MIN).toISOString() }],
    },
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })
  await clock.advance(61 * MIN)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /COLD/ })).toBeDefined()
  await ui.unmount()
})

test('with language hr the band speaks Croatian', { options: { language: 'hr' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 500_000, tokens: 245_000, percent: 49 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 38, resetsAt: new Date(NOW + 100 * MIN).toISOString() },
        { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(NOW + 81 * 60 * MIN).toISOString() },
      ],
    },
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /TOPLO/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: /stižeš do reseta/ })).toBeDefined()
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }
})
