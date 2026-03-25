# Livermore Record Rules Adapted To ATR

## Goal

Rebuild the Livermore price record engine from the source rules in `scripts/livermore/livermore.md`,
but replace the fixed point distances with ATR-based thresholds.

## Column / State Mapping

- `upward_trend`: Upward Trend column
- `downward_trend`: Downward Trend column
- `natural_rally`: Natural Rally column
- `natural_reaction`: Natural Reaction column
- `secondary_rally`: Secondary Rally column
- `secondary_reaction`: Secondary Reaction column

All state decisions use `close`, not intraday `high`/`low`.

## ATR Mapping

Original Livermore thresholds:

- `6 points`: enough movement to start a natural reaction or natural rally
- `3 points`: enough movement to confirm resumption or failure of the prior trend

ATR adaptation:

- `reversalThreshold = ATR20 * reversalMultiplier`
- `confirmThreshold = ATR20 * confirmMultiplier`

Recommended interpretation:

- original `6 points` -> `reversalThreshold`
- original `3 points` -> `confirmThreshold`

## Pivotal Point Definitions

These are the display pivots and must stay separate from internal running extremes.

- `SS`: the last recorded price in `upward_trend` when recording first starts in `natural_reaction`
- `BB`: the last recorded price in `downward_trend` when recording first starts in `natural_rally`
- `S`: the extreme price of the just-finished `natural_rally`, confirmed when recording next starts in `natural_reaction` or `downward_trend`
- `B`: the extreme price of the just-finished `natural_reaction`, confirmed when recording next starts in `natural_rally` or `upward_trend`

In the ATR version, all four pivots are based on highest/lowest recorded `close`.

## Running Extremes

These are internal references, not display pivots.

- `uptrendExtreme`: highest recorded close while in `upward_trend`
- `downtrendExtreme`: lowest recorded close while in `downward_trend`
- `naturalRallyExtreme`: highest recorded close while in `natural_rally`
- `naturalReactionExtreme`: lowest recorded close while in `natural_reaction`
- `secondaryRallyExtreme`: highest recorded close while in `secondary_rally`
- `secondaryReactionExtreme`: lowest recorded close while in `secondary_reaction`

## Transition Rules

### 1. Upward Trend

- Continue while a higher close is recorded.
- When price reacts down by at least `reversalThreshold` from `uptrendExtreme`:
  - mark `SS = uptrendExtreme`
  - start `natural_reaction`

### 2. Downward Trend

- Continue while a lower close is recorded.
- When price rallies up by at least `reversalThreshold` from `downtrendExtreme`:
  - mark `BB = downtrendExtreme`
  - start `natural_rally`

### 3. Natural Reaction

- Continue while lower closes are recorded.
- If price falls below the last `BB`, move to `downward_trend`.
  - This is the direct resume-down case from the Livermore rules.
- When price rallies up by at least `reversalThreshold` from `naturalReactionExtreme`:
  - confirm `B = naturalReactionExtreme`
  - if price is still below the last `S`, move to `secondary_rally`
  - if price reaches or exceeds the last `S`, move to `natural_rally`
  - if price reaches or exceeds the last `SS` by `confirmThreshold`, move to `upward_trend`

### 4. Natural Rally

- Continue while higher closes are recorded.
- If price rises above the last `SS`, move to `upward_trend`.
  - This is the direct resume-up case from the Livermore rules.
- When price reacts down by at least `reversalThreshold` from `naturalRallyExtreme`:
  - confirm `S = naturalRallyExtreme`
  - if price is still above the last `B`, move to `secondary_reaction`
  - if price reaches or falls below the last `B`, move to `natural_reaction`
  - if price reaches or falls below the last `BB` by `confirmThreshold`, move to `downward_trend`

### 5. Secondary Rally

- Continue while higher closes are recorded within `secondary_rally`.
- If price reaches or exceeds the last `S`, move to `natural_rally`.
- If price reaches or exceeds the last `SS` by `confirmThreshold`, move to `upward_trend`.

### 6. Secondary Reaction

- Continue while lower closes are recorded within `secondary_reaction`.
- If price reaches or falls below the last `B`, move to `natural_reaction`.
- If price reaches or falls below the last `BB` by `confirmThreshold`, move to `downward_trend`.

## Practical Notes

- The current implementation mixes display pivots with internal state references. The rebuild must not do that.
- Every pivot should store both `price` and `date`.
- The chart should plot only confirmed pivots:
  - `SS` when `upward_trend -> natural_reaction`
  - `BB` when `downward_trend -> natural_rally`
  - `S` when `natural_rally -> natural_reaction` or `natural_rally -> downward_trend`
  - `B` when `natural_reaction -> natural_rally` or `natural_reaction -> upward_trend`

## Bootstrap Rule

The source excerpt explains transitions, not the very first initialized state.
So bootstrap must be isolated as an implementation detail and must not redefine the Livermore rules.

Recommended bootstrap:

- wait until `ATR20` is available
- use the first ATR-available bar as the initial recorded point
- infer the first trend from price movement over the initial ATR window
- mark bootstrap-generated pivots as provisional until the first true natural reaction or natural rally occurs

This keeps the first real `SS / BB / S / B` aligned with the Livermore rules instead of with bootstrap noise.
