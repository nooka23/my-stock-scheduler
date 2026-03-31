# AGENTS.md

## Purpose

This file records chart-specific implementation rules and follow-up plans so future work on files in `src/components/` can stay consistent with the current `KLineChart`-based stock chart experience.

Primary reference implementation:
- `/Users/myunghoon/my-stock-scheduler/src/components/StockChart.tsx`
- `/Users/myunghoon/my-stock-scheduler/src/app/admin/MH/chart/page.tsx`

## Current Chart Standard

When updating or creating other chart components in `src/components/`, follow these rules unless a specific page requires different behavior.

### Library Choice

- Prefer `klinecharts` for interactive price-chart style components.
- Avoid mixing new drawing features into `lightweight-charts` components unless there is a clear reason to keep that library.
- Preserve current visual behavior when migrating older chart components.

### Main Price Chart Rules

- Main price axis should use integer precision.
- Apply `chart.setPriceVolumePrecision(0, 0)` for stock price charts unless decimal pricing is explicitly needed.
- Initial visible area should default to the most recent `250` bars.
- Full fetched history can remain larger, but the first view should emphasize recent action.

### Indicator Rules

- Keep the main candle pane visually clean.
- Volume and RS should live in separate lower panes.
- MACD is currently removed from the MH chart flow and should not be reintroduced unless requested.
- RS should be centered around `0` when the metric can be positive or negative.
- For RS in `klinecharts`, do not rely on `minValue` / `maxValue` via `overrideIndicator` in `9.8.12`.
  The library has a bug where `maxValue` is not applied correctly.
- Current RS workaround:
  add invisible upper/lower bound lines in the indicator result so the pane scale is forced to a symmetric `-bound ~ +bound` range.

### Legend Rules

- Do not let indicator legends cover candles or chart controls.
- Prefer page-level legends placed near the title/metadata area rather than absolute overlays inside the chart.
- `StockChart.tsx` exposes `onLegendChange` so pages can render legends outside the chart surface.

### Drawing Tool Rules

- Drawing tools should not cover the plot area.
- For the MH chart page, tools are rendered in the page header next to the stock name, not inside the chart body.
- Keep the tool UI compact, rectangular, and low-noise.
- Use `KLineChart` built-in overlays for drawing features.

Current drawing tools in use:
- `segment`: trend line
- `straightLine`: extended trend line
- `horizontalStraightLine`: horizontal line
- `parallelStraightLine`: parallel line
- `verticalStraightLine`: vertical line

### Drawing Interaction Rules

- Use `strong_magnet` mode for drawing overlays so lines snap closer to candle price points.
- Hide large default point handles by making overlay point styles transparent with zero radius.
- Keep drawing line color consistent unless a page explicitly needs multiple colors.

## Reuse Guidance For Other Components

If another chart in `src/components/` needs to adopt today's behavior:

1. Use `StockChart.tsx` as the canonical implementation for:
   - pane layout
   - legend callback pattern
   - drawing tool API
   - RS scaling workaround
2. If moving an older `lightweight-charts` component to `klinecharts`, migrate in this order:
   - candle + volume
   - indicator panes
   - legend externalization
   - drawing tools
3. If a page already has a title/header area, place chart tools there instead of overlaying them on the canvas.
4. Keep toolbar actions page-owned when placement near title text is desired.
   `StockChart.tsx` should expose imperative methods through a ref rather than rendering heavy chart-local toolbars.

## Known Technical Notes

- `klinecharts@9.8.12` is installed.
- There is a library bug in indicator override handling:
  `maxValue` is effectively misrouted internally.
- Because of that, indicator scaling that depends on runtime override should be avoided when possible.
- If future work upgrades `klinecharts`, re-check whether the RS bound workaround is still necessary.

## Future Plan: Chart Persistence

The project may later support saving chart settings and drawings. The recommended rollout is:

### Phase 1: Local Persistence

- Save per-user, per-symbol chart state in `localStorage`.
- Suggested saved fields:
  - selected timeframe
  - visible range / zoom preference
  - drawing overlays
  - indicator visibility flags
  - optional legend display preferences
- Restore this state automatically when reopening the same symbol.

### Phase 2: Drawing Serialization

- Track created overlays in app-managed state instead of treating them as chart-only side effects.
- Store, at minimum:
  - overlay name
  - overlay id
  - group id
  - points
  - style overrides
  - lock/visibility flags if used
- Add helper functions:
  - `serializeDrawings(chart)`
  - `restoreDrawings(chart, savedDrawings)`

### Phase 3: Backend Persistence

- After local persistence is stable, add user-level storage in Supabase.
- Recommended table shape:
  - `user_id`
  - `chart_key` or `page_key`
  - `symbol`
  - `timeframe`
  - `settings_json`
  - `updated_at`
- Keep payloads JSON-based so drawing/tool state can evolve without frequent schema changes.

### Phase 4: UX Additions

- Add explicit save/reset actions in the page header if automatic persistence is not enough.
- Add “reset drawings only” and “reset chart layout” as separate actions.
- Consider versioning saved payloads to support future migrations safely.

## If Extending This Later

- Prefer small, reversible steps.
- Verify drawing behavior after any `klinecharts` version bump.
- Keep new chart UI out of the plot area unless the user explicitly asks for floating controls.
