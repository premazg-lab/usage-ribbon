# usage-ribbon

A free mod for Claude Code. It adds a slim band above your prompt that shows:

- **How much of your 5-hour and 7-day limits you have used**, when each one resets, and whether you will make it to the reset at your current pace.
- **What your week would look like on another model**: pick Fable, Opus, Sonnet or Haiku and see whether the same work on that model would run you out before the reset.
- **Whether your prompt cache is warm or cold**, what your next message costs, and how much the cache has saved you.

It installs once and is there in every session after that. No commands to learn.

## Install

The easy way: send this link to your agent and say "install this".

```
https://github.com/premazg-lab/usage-ribbon
```

### For agents

If you are an agent and your user asked you to install this, run this in a shell:

```
claude plugin install usage-ribbon --marketplace premazg-lab/usage-ribbon
```

It installs for the user (all their projects) and adds the marketplace on its own. Then tell your user: "usage-ribbon is installed. Start a new session to see the band above your prompt." Do not edit their settings file by hand.

### By hand

In a Claude Code terminal session, type:

```
/plugin install usage-ribbon --marketplace premazg-lab/usage-ribbon
```

1. Type `y` when it asks `Add marketplace?`.
2. Pick the **user** scope with Enter.
3. Start a new session.

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `premazg-lab/usage-ribbon`, then **Add plugin**.

## What you see

### The closed band

One row:

```
5H ▬▬▬|▭▭ 26%  3h 21m   7D ▬▬▬▬▬|▭ 77%  1d 21h   ♨ WARM 59m · $0.08   ⌃
```

- **5H** is your 5-hour window, **7D** your 7-day window. Each shows how much you have **used** and how long until it resets.
- **WARM** with the minutes the cache stays warm and what your next message costs, or **COLD** with the price first and how long it has been cold.
- The arrow on the right opens the card.

### How to read a bar

Every bar works the same way:

- **Solid colour** is what you have used.
- **The lighter part after it** is where you will end up at the reset if you keep going at the same pace.
- **The thin white mark** shows how much of the window has passed.

The colour tells you the verdict at a glance:

- **Blue**: you will make it to the reset.
- **Amber**: tight, you will end up between 80% and 100%.
- **Red**: at this pace you run out before the reset. The card says when.

### The open card

Three bars, each with a line under it:

- **5H session** and **7D week**: the verdict (`lasts until reset`, `tight`, or `runs out in ~1d 12h · 9h 25m before reset`) and when the window resets.
- **7D model**: the same week, but as if all your work had been done on one model. It follows the model you are using. Click the name to try another model. That choice holds until you switch models or close the card. It is marked **estimate**, because Claude Code does not report the weekly limit per model (more on this below).

Under the bars, the cache:

- **WARM 59m** with a small bar of how long you have been idle, or **COLD** with how long it has been cold.
- **CACHE 97% · SAVED $14.90**: how much of your last reply's input came from the cache, and how much the cache has saved you this session.
- **IN CACHE 402k tokens**, with how much of the context window that is.
- **NEXT**: what your next message costs on each model. Your current model is underlined. Only your model reads from the warm cache; any other model has to write the whole chat to the cache again.

### Fits any surface

- **Desktop app**: the bars are drawn and stretch to the width of the band.
- **Terminal**: the same facts as plain text bars.

## How the per-model estimate works

Claude Code reports only two limits: the 5-hour window and the 7-day window. There is no weekly figure per model, so the third bar is an estimate, built in two steps:

1. **From prices.** The mod records the tokens of every reply over the last 7 days. It reprices those tokens at the chosen model's price and scales the remaining part of your 7-day pace by the difference. Sonnet at half of Opus's price comes out at roughly half the extra usage.
2. **Learned.** Each time the 7-day percentage goes up a point, the mod credits that point to the model that did most of the spending since the last reading. Once it has seen enough points (3), it uses what it learned instead of prices alone. The label then reads `estimate · learned (n)`, where `n` is how many points it has seen. What it learns is kept across sessions.

Things it cannot see: usage from other sessions, from claude.ai or from the API raises your 7-day figure too, so the estimate can run a little high.

## Good to know

- **It costs nothing to run.** It reads Claude Code's own numbers and draws them. It never calls a model.
- **Prices are estimates.** They come from the table `PRICES` in `hooks/learn.ts`, not from your bill. If prices change, edit that table.
- **The cache is assumed to stay warm for 60 minutes** after your last reply. You can change this with the plugin option **Cache lifetime (minutes)**.
- **Subagents count toward savings and learning**, but only your main chat sets the cache clock and the hit rate.
- **Pace counts the whole window**, nights included, the same way the limits do.

## What is inside

```
usage-ribbon/
├── .claude-plugin/
│   ├── plugin.json         the mod's name, version and its one option
│   └── marketplace.json    makes this repository installable
├── hooks/
│   ├── hooks.json          points to the module
│   ├── register.tsx        the band: limits, pace, cache, layout
│   └── learn.ts            the price table and the per-model learning
├── types/index.d.ts        the shape of what the band remembers
└── tests/                  4 tests: warm and cold, pace and price, learning, terminal and desktop
```

## Remove it

```
claude plugin uninstall usage-ribbon
```

## Develop it

Load the folder without installing it:

```
claude --plugin-dir ./usage-ribbon
```

Run the tests:

```
claude plugin test ./usage-ribbon
```

## License

[MIT](LICENSE). You can use, change and share it freely, as long as the copyright notice stays with it.

The idea of a band above the prompt comes from [ribbon](https://github.com/robonuggets/ribbon) by Jay E (RoboNuggets). usage-ribbon is a separate mod written from scratch, with pace, verdicts and a per-model weekly estimate.

Made by Prema.
