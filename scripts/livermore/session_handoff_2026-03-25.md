# Livermore Rebuild Handoff

## Goal

Rebuild the `admin/MH/index` Livermore price record feature from the source rules in:

- [`scripts/livermore/livermore.md`](/Users/myunghoon/my-stock-scheduler/scripts/livermore/livermore.md)

using ATR-based thresholds instead of Livermore's fixed point thresholds.

## Source Rule Mapping

Current working interpretation:

- original `6 points` -> `reversalThreshold = ATR20 * reversalMultiplier`
- original `3 points` -> `confirmThreshold = ATR20 * confirmMultiplier`

Default values currently set:

- `reversalMultiplier = 3.0`
- `confirmMultiplier = 1.5`

Updated in:

- [`src/app/admin/MH/index/page.tsx`](/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/index/page.tsx)
- [`src/app/api/livermore/kospi/route.ts`](/Users/myunghoon/my-stock-scheduler/src/app/api/livermore/kospi/route.ts)
- [`src/lib/livermoreRecordEngine.ts`](/Users/myunghoon/my-stock-scheduler/src/lib/livermoreRecordEngine.ts)

## Files Added / Changed

- [`scripts/livermore/livermore_atr_spec.md`](/Users/myunghoon/my-stock-scheduler/scripts/livermore/livermore_atr_spec.md)
  - ATR adaptation notes and provisional design spec
- [`src/lib/livermoreRecordEngine.ts`](/Users/myunghoon/my-stock-scheduler/src/lib/livermoreRecordEngine.ts)
  - new engine under active redesign
- [`src/lib/livermoreStateMachine.ts`](/Users/myunghoon/my-stock-scheduler/src/lib/livermoreStateMachine.ts)
  - currently re-exports the new engine
- [`src/components/LivermoreStateChart.tsx`](/Users/myunghoon/my-stock-scheduler/src/components/LivermoreStateChart.tsx)
  - marker display changed to use `pivot_*_date` and show `S/B/SS/BB`
- [`src/app/api/livermore/kospi/route.ts`](/Users/myunghoon/my-stock-scheduler/src/app/api/livermore/kospi/route.ts)
  - warmup history added before trimming to requested display period

## What Was Learned

The original pre-rebuild implementation had become unreliable because:

- display pivots and transition references were mixed together
- bootstrap rules were mixed into the real Livermore rules
- `secondary` states were being produced too aggressively
- chart markers did not always correspond to true pivot dates

The most important rule clarification from `livermore.md`:

After `upward_trend -> natural_reaction`, recovery works like this:

1. first a rally of about `6 points` must occur from the last `Natural Reaction` recorded price
2. then:
   - if price exceeds the last `Upward Trend` recorded price -> `Upward Trend`
   - else if price exceeds the last `Natural Rally` recorded price -> `Natural Rally`
   - else -> `Secondary Rally`

The symmetric rule applies on the downside.

## Current Engine Status

The engine was reworked several times.

Current file:

- [`src/lib/livermoreRecordEngine.ts`](/Users/myunghoon/my-stock-scheduler/src/lib/livermoreRecordEngine.ts)

Current direction:

- separate `ledger(last recorded price)` from `extreme`
- use ATR-based `reversalThreshold` / `confirmThreshold`
- warm up with extra history before showing requested range

Important:

- the engine is still not considered final
- it compiles as a standalone TypeScript file
- but rule fidelity is still under review

## Verified Problems Still Remaining

These are the important unresolved issues as of this handoff.

### 1. Engine Still Leans Toward State-Machine Logic Instead Of Column-Recording Logic

The current implementation still decides state transitions directly, instead of first simulating
which column each date would be recorded into and then deriving pivots/states from that ledger.

This is the main reason confidence is still low.

### 2. `ledger` vs `extreme` Separation Is Still Incomplete

Banach reported that even after rework, some `trend` ledger values are still effectively being used
like extremes, which can distort comparisons against:

- last `Upward Trend` recorded price
- last `Downward Trend` recorded price
- last `Natural Rally` recorded price
- last `Natural Reaction` recorded price

This needs another pass.

### 3. `secondary` Handling Is Better Than Before But Still Suspect

Symptoms observed by the user:

- Samsung Electronics over 5 years sometimes shows too many `secondary_rally` / `secondary_reaction`
- query-window changes like `4 years` vs `5 years` still produce materially different state history

Warmup history should reduce this, but the engine still needs direct validation against real examples.

### 4. Bootstrap Is Still A Practical Approximation

Bootstrap is now less naive than before, but it is still an implementation convenience, not an explicit
rule from the source text.

## Banach Findings Worth Carrying Forward

`Banach` is the rule-checking agent used in this session.

Most useful conclusions from its audits:

- same-bar `trend -> natural -> same-bar immediate trend re-entry` was too aggressive in one version
- `entry-lock` added to stop that turned out to be too strong and caused excessive `secondary` states
- current logic improved some of that, but the deeper issue is that rule execution is still modeled as
  a state machine before it is modeled as a recording procedure
- the clean solution is likely:
  1. simulate daily column recording
  2. maintain per-column last recorded price
  3. maintain separate extremes where the source rules imply them
  4. derive `S/B/SS/BB`
  5. derive current state for chart/display

## Recommended Next Step

Do not continue patching the current engine in small steps.

Instead, rebuild the engine around a true recording ledger.

Suggested design:

### Step 1

Create a new internal model like:

- `recordedColumnByDate`
- `lastRecorded.upwardTrend`
- `lastRecorded.downwardTrend`
- `lastRecorded.naturalRally`
- `lastRecorded.naturalReaction`
- `lastRecorded.secondaryRally`
- `lastRecorded.secondaryReaction`
- `extremeSinceColumnEntry.*`
- `linedPivot.*`

### Step 2

Implement source rules in recording order, not state order:

- 6-A
- 6-B
- 6-C
- 6-D
- 6-E
- 6-F
- 6-G
- 6-H
- then 5-A / 5-B confirmations

### Step 3

Only after the column ledger is stable:

- derive pivots `S/B/SS/BB`
- derive display state for each day
- feed the chart

## Practical Test Cases For Next Session

Use these exact checks next time:

1. Samsung Electronics (`005930`) with `4 years` vs `5 years`
   - verify whether warmup reduced divergence
2. find a period where:
   - `upward_trend -> natural_reaction`
   - then test whether recovery becomes:
     - `upward_trend`
     - `natural_rally`
     - or `secondary_rally`
     according to the source rule order
3. inspect whether `secondary_*` appears only when:
   - reversal threshold is met
   - but the last natural column recorded price is not exceeded

## Notes For The Next Session

- Start by reading this file
- Then re-read [`scripts/livermore/livermore.md`](/Users/myunghoon/my-stock-scheduler/scripts/livermore/livermore.md)
- Treat the current engine as provisional
- Prefer rewriting around ledger simulation over further local fixes
