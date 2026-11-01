---
name: profiling-client-performance
description: Use when diagnosing a hard client-side performance problem in Trilium — a stutter while typing, janky dragging, a slow widget, a periodic freeze, "why does this only lag on my real database?". Covers reading a recorded Chrome DevTools trace to find which subsystem is burning the main thread, then the in-app `debug_perf` profiler to measure what a specific operation costs. Includes analyze-trace.mjs; don't write a new trace parser or a throwaway timing harness.
---

# Profiling the Trilium client

Two tools, used in order. Skipping the first wastes the second on the wrong subsystem.

| | reads | answers | needs |
|---|---|---|---|
| `analyze-trace.mjs` | a recorded `.json`/`.json.gz` trace | *which subsystem is burning the main thread* | nothing — works on production builds and traces someone else recorded |
| `debug_perf` | a live session | *what does this specific operation cost, and how often* | source changes + a dev build |

## 1. Find the subsystem: analyze a trace

Ask for a DevTools Performance recording (Performance panel → record → download). Then:

```bash
# A 90MB trace needs the bigger heap; the default one dies parsing it.
node --max-old-space-size=8192 .claude/skills/profiling-client-performance/analyze-trace.mjs <trace> summary
node ... analyze-trace.mjs <trace> spikes      # self time inside the long tasks only — usually the answer
node ... analyze-trace.mjs <trace> profile 25  # top self/total time across the whole trace
node ... analyze-trace.mjs <trace> timeline    # ASCII busy-per-bucket, for spotting a beat
```

`spikes` is the one to reach for: a stutter *is* the long tasks, and aggregating self time inside
them with a stack attached names the culprit directly. `summary` prints each long task with the gap
from the previous one — a steady gap means a timer or a debounce, an erratic one means the user is
driving it.

Two trace-format traps the script already handles, and which will silently mislead a hand-rolled
parser:

- **Profiles are numbered per process.** Every process starts its `Profile`/`ProfileChunk` ids at
  the same value, so keying on `id` alone merges the browser process's profile into the renderer's
  and attributes main-process frames to page code.
- **The GPU process's vsync thread is busy for the whole trace by design.** Picking "the busiest
  thread" hands you 11.5s of nothing. The renderer main thread is `CrRendererMain`.

Chunk names in a production trace are hashed (`board-B_DI2aI3.js`). Resolve them by extracting from
the installed app rather than guessing:

```bash
npx --yes @electron/asar list "<install>/resources/app.asar" | grep <chunk>
# then extract via the node API with path.join("public","src",<chunk>) — the CLI mangles the separators
```

## 2. Measure the cost: `debug_perf`

`apps/client/src/services/debug_perf.ts`. **Nothing calls into it by default** — that is deliberate.
Add call sites for as long as the investigation takes, then take them back out.

```ts
import { perfCount, perfSpan } from "../services/debug_perf";

perfCount("board.card.render");                    // how often
const end = perfSpan("board.getBoardData");        // how long; end() also returns the ms
try { ... } finally { end(); }
```

Adding the first call site is what pulls the module into the bundle, which is also what puts
`triliumPerf` on `window`. There is nothing else to arm. Then, in the devtools console:

```js
triliumPerf.enable()    // also starts reporting stalls
// ...reproduce the problem...
triliumPerf.report()    // console.table of calls / total / avg / max
```

**Count before you time.** A counter is one line and often reframes the problem outright: "4858 card
renders" divided by 949 cards is *six full redraws*, not the one-per-pointer-move that had been
assumed, which changes what is worth fixing.

### Reproducing against a real database

Most of these only appear at real data volumes. Point a dev build at a **copy** of the user's data:

```powershell
$env:TRILIUM_DATA_DIR = "C:\path\to\a\copy-of-trilium-data"
pnpm desktop:start
```

## Interpreting what comes back

**A STALL line is not the cost of an operation.** It is the gap between animation frames, so on a
saturated main thread it spans *every* operation that fell inside one contiguous busy period. Two
runs are then not comparable — a "regression" from 434ms to 1196ms was two redraws landing in one
stall rather than anything getting slower. For "what did this cost", use a span; only its returned
duration is per-operation.

**Check for saturation first.** `summary` prints it. Above ~60% busy, stall durations stop meaning
much and the timeline stops having gaps to read.

**Long Tasks are Chromium-only.** Firefox has no `longtask` entry type, and
`observe({ entryTypes })` drops an unrecognized one with a console warning instead of throwing — so
a naive observer reports nothing at all, which reads as "no stalls happened". `debug_perf` checks
`supportedEntryTypes` and falls back to an animation-frame watchdog, and says which it is using.

**To separate JavaScript from layout and paint**, close a span in a `useLayoutEffect`: it runs after
Preact has mutated the DOM but before the browser paints. Compare its total against the stall total.
Most of the stall inside the span means JS; most of it outside means layout/paint, and no amount of
memoization will help.

**Dev-build numbers are inflated but proportionate** — roughly 1.5× against a production Electron
build in practice. Ratios and rankings transfer; absolute figures don't. Firefox's frame-gap
watchdog is coarser than Chromium's Long Tasks, so prefer the desktop app for final numbers.

## Method

**Measure before predicting, and say which you are doing.** Predictions from reading code have a
poor record here: "keying the fragment will speed up dragging" (no measurable change), "splitting
the context alone will change nothing" (halved the average stall), "the dragover DOM measuring is
the hot path" (12ms out of 5655ms). Every change that actually moved a number came from a
measurement first. When you must guess, state it as a hypothesis and name the number that would
confirm it.

**A null result is a result.** Land it if it's a correctness fix, say plainly that it bought
nothing, and put that in the commit message.

## Patterns that keep showing up

- **A context change re-renders every consumer, `memo` included.** A component reading a context
  that changes often cannot be memoized out of the render path at all. Split volatile state into its
  own context first; `memo()` is inert until then.
- **`Intl.*` constructors are ~30× the cost of using the formatter.** Anything constructing one per
  row per render is the leaf cost. `apps/client/src/utils/formatters.ts` memoizes on locale + option
  set; `formatters.bench.ts` guards it.
- **Change-detection predicates that are broader than they look.** `LoadResults.getNoteIds()` returns
  every note in the change set whatever changed about it, so a check meaning "did the title change?"
  also fires on every content autosave.
- **Keys belong on the element the `.map()` returns.** A key on a child inside a returned fragment
  identifies nothing, and the list reconciles positionally.

## When done

Take the call sites out — `grep -rn "perfSpan\|perfCount\|perfLog\|perfTime" apps/client/src` should
return only `debug_perf.ts` itself. Leaving them behind gathers measurements nobody reads. The module
stays; it is the tool, not the measurement.
