export type LivermoreState =
  | 'secondary_rally'
  | 'natural_rally'
  | 'upward_trend'
  | 'downward_trend'
  | 'natural_reaction'
  | 'secondary_reaction';

export type ExtendedLivermoreState = LivermoreState | 'insufficient_data';

export type PriceRow = {
  date: string;
  open: number;
  high: number | null;
  low: number | null;
  close: number;
};

export type LivermoreComputedRow = {
  date: string;
  open: number;
  high: number | null;
  low: number | null;
  close: number;
  atr20: number | null;
  state: ExtendedLivermoreState;
  state_changed: boolean;
  reason: string;
  reversal_threshold_value: number | null;
  confirm_threshold_value: number | null;
  pivot_high: number | null;
  pivot_low: number | null;
  pivot_ss: number | null;
  pivot_bb: number | null;
};

export type LivermoreParams = {
  reversalMultiplier: number;
  confirmMultiplier: number;
  momentumLookback: number;
};

const DEFAULT_PARAMS: LivermoreParams = {
  reversalMultiplier: 4.0,
  confirmMultiplier: 2.0,
  momentumLookback: 60,
};

function roundValue(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function computeAtr20(rows: PriceRow[]): Array<number | null> {
  const trValues: number[] = [];
  const atr: Array<number | null> = Array(rows.length).fill(null);

  for (let i = 0; i < rows.length; i += 1) {
    const current = rows[i];
    const prevClose = i > 0 ? rows[i - 1].close : current.close;
    const high = current.high ?? current.close;
    const low = current.low ?? current.close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );

    trValues.push(tr);

    if (i >= 19) {
      let sum = 0;
      for (let j = i - 19; j <= i; j += 1) {
        sum += trValues[j];
      }
      atr[i] = sum / 20;
    }
  }

  return atr;
}

export function computeLivermoreStateRows(
  inputRows: PriceRow[],
  inputParams?: Partial<LivermoreParams>,
): LivermoreComputedRow[] {
  const rows = [...inputRows].sort((a, b) => a.date.localeCompare(b.date));
  const params = { ...DEFAULT_PARAMS, ...inputParams };
  const atr20 = computeAtr20(rows);

  const results: LivermoreComputedRow[] = [];
  let currentState: LivermoreState | null = null;
  let sPivot: number | null = null;
  let bPivot: number | null = null;
  let ssPivot: number | null = null;
  let bbPivot: number | null = null;

  let naturalReactionLow: number | null = null;
  let naturalRallyHigh: number | null = null;
  let currentReactionSsRef: number | null = null;
  let currentRallyBbRef: number | null = null;
  let lastNaturalRallySS: number | null = null;
  let lastNaturalReactionBB: number | null = null;

  let allTimeHighSeen: number | null = null;
  let allTimeLowSeen: number | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const atr = atr20[i];
    const priorAllTimeHigh = allTimeHighSeen;
    const priorAllTimeLow = allTimeLowSeen;

    if (atr === null) {
      results.push({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        atr20: null,
        state: 'insufficient_data',
        state_changed: false,
        reason: 'ATR20 unavailable',
        reversal_threshold_value: null,
        confirm_threshold_value: null,
        pivot_high: null,
        pivot_low: null,
        pivot_ss: null,
        pivot_bb: null,
      });
      allTimeHighSeen = allTimeHighSeen === null ? row.close : Math.max(allTimeHighSeen, row.close);
      allTimeLowSeen = allTimeLowSeen === null ? row.close : Math.min(allTimeLowSeen, row.close);
      continue;
    }

    const reversalThreshold = atr * params.reversalMultiplier;
    const confirmThreshold = atr * params.confirmMultiplier;

    let stateChanged = false;
    let reason = 'No rule for current state (pending redesign)';

    if (currentState === null) {
      const anchorIndex = Math.max(0, i - params.momentumLookback);
      const anchorClose = rows[anchorIndex].close;
      const lookbackRows = rows.slice(Math.max(0, i - 19), i);

      if (lookbackRows.length > 0) {
        sPivot = lookbackRows.reduce((maxValue, r) => Math.max(maxValue, r.close), lookbackRows[0].close);
        bPivot = lookbackRows.reduce((minValue, r) => Math.min(minValue, r.close), lookbackRows[0].close);
      } else {
        sPivot = row.close;
        bPivot = row.close;
      }

      currentState = row.close >= anchorClose ? 'upward_trend' : 'downward_trend';

      if (currentState === 'upward_trend') {
        sPivot = Math.max(sPivot ?? row.close, row.close);
      } else {
        bPivot = Math.min(bPivot ?? row.close, row.close);
      }

      stateChanged = true;
      reason = `Initial state by ${i - anchorIndex}-day momentum (S/B pivots set from prior 19 bars)`;
    } else if (currentState === 'upward_trend') {
      const sRef = sPivot ?? row.close;
      const bRef = bPivot ?? row.close;

      if (row.close > sRef) {
        currentState = 'upward_trend';
        sPivot = row.close;
        reason = 'Uptrend continued (S pivot updated)';
      } else if (row.close <= sRef - confirmThreshold) {
        if (row.close < bRef) {
          currentState = 'downward_trend';
          stateChanged = true;
          bPivot = row.close;
          naturalReactionLow = null;
          naturalRallyHigh = null;
          currentReactionSsRef = null;
          currentRallyBbRef = null;
          reason = 'Uptrend -> Downtrend (confirm drop from S and break below B)';
        } else {
          currentState = 'natural_reaction';
          stateChanged = true;
          currentReactionSsRef = sRef;
          ssPivot = sRef; // mark SS at the latest uptrend high
          naturalReactionLow = row.close;
          reason = 'Uptrend -> Natural reaction (confirm drop from S)';
        }
      } else {
        reason = 'Uptrend maintained';
      }
    } else if (currentState === 'downward_trend') {
      const sRef = sPivot ?? row.close;
      const bRef = bPivot ?? row.close;

      if (row.close < bRef) {
        currentState = 'downward_trend';
        bPivot = row.close;
        reason = 'Downtrend continued (B pivot updated)';
      } else if (row.close >= bRef + confirmThreshold) {
        if (row.close > sRef) {
          currentState = 'upward_trend';
          stateChanged = true;
          sPivot = row.close;
          naturalReactionLow = null;
          naturalRallyHigh = null;
          currentReactionSsRef = null;
          currentRallyBbRef = null;
          reason = 'Downtrend -> Uptrend (confirm rise from B and break above S)';
        } else {
          currentState = 'natural_rally';
          stateChanged = true;
          currentRallyBbRef = bRef;
          bbPivot = bRef; // mark BB at the latest downtrend low
          naturalRallyHigh = row.close;
          reason = 'Downtrend -> Natural rally (confirm rise from B)';
        }
      } else {
        reason = 'Downtrend maintained';
      }
    } else if (currentState === 'natural_reaction') {
      naturalReactionLow = naturalReactionLow === null ? row.close : Math.min(naturalReactionLow, row.close);
      const reactionLowRef = naturalReactionLow;
      const bRef = bPivot ?? row.close;
      const ssRef = currentReactionSsRef ?? ssPivot ?? sPivot ?? row.close;

      const brokeB = row.close < bRef;
      const brokeAllTimeLow = priorAllTimeLow !== null && row.close < priorAllTimeLow;
      if (brokeB || brokeAllTimeLow) {
        currentState = 'downward_trend';
        stateChanged = true;
        bPivot = row.close;
        lastNaturalReactionBB = reactionLowRef;
        bbPivot = reactionLowRef;
        naturalReactionLow = null;
        currentReactionSsRef = null;
        naturalRallyHigh = null;
        currentRallyBbRef = null;
        reason = brokeAllTimeLow
          ? 'Natural reaction -> Downtrend (broke all-time low)'
          : 'Natural reaction -> Downtrend (broke B pivot)';
      } else if (row.close >= reactionLowRef + confirmThreshold) {
        // Mark BB when leaving natural reaction toward rally/uptrend.
        lastNaturalReactionBB = reactionLowRef;
        bbPivot = reactionLowRef;

        const prevNaturalRallySS = lastNaturalRallySS;
        if (prevNaturalRallySS !== null) {
          if (row.close >= prevNaturalRallySS) {
            if (row.close > ssRef) {
              currentState = 'upward_trend';
              stateChanged = true;
              sPivot = row.close;
              bPivot = reactionLowRef;
              naturalReactionLow = null;
              currentReactionSsRef = null;
              naturalRallyHigh = null;
              currentRallyBbRef = null;
              reason = 'Natural reaction -> Uptrend (rebound >= previous natural-rally SS and above current SS)';
            } else {
              currentState = 'natural_rally';
              stateChanged = true;
              naturalRallyHigh = row.close;
              currentRallyBbRef = reactionLowRef;
              naturalReactionLow = null;
              currentReactionSsRef = null;
              reason = 'Natural reaction -> Natural rally (rebound >= previous natural-rally SS)';
            }
          } else {
            currentState = 'secondary_rally';
            stateChanged = true;
            naturalRallyHigh = row.close;
            currentRallyBbRef = reactionLowRef;
            naturalReactionLow = null;
            currentReactionSsRef = null;
            reason = 'Natural reaction -> Secondary rally (rebound below previous natural-rally SS)';
          }
        } else if (row.close > ssRef) {
          currentState = 'upward_trend';
          stateChanged = true;
          sPivot = row.close;
          bPivot = reactionLowRef;
          naturalReactionLow = null;
          currentReactionSsRef = null;
          naturalRallyHigh = null;
          currentRallyBbRef = null;
          reason = 'Natural reaction -> Uptrend (no previous natural-rally SS, rebound above current SS)';
        } else {
          currentState = 'natural_rally';
          stateChanged = true;
          naturalRallyHigh = row.close;
          currentRallyBbRef = reactionLowRef;
          naturalReactionLow = null;
          currentReactionSsRef = null;
          reason = 'Natural reaction -> Natural rally (no previous natural-rally SS)';
        }
      } else {
        reason = 'Natural reaction maintained';
      }
    } else if (currentState === 'natural_rally') {
      naturalRallyHigh = naturalRallyHigh === null ? row.close : Math.max(naturalRallyHigh, row.close);
      const rallyHighRef = naturalRallyHigh;
      const sRef = sPivot ?? row.close;
      const bbRef = currentRallyBbRef ?? bbPivot ?? bPivot ?? row.close;

      const brokeSPivot = row.close > sRef;
      const brokeAllTimeHigh = priorAllTimeHigh !== null && row.close > priorAllTimeHigh;
      if (brokeSPivot || brokeAllTimeHigh) {
        currentState = 'upward_trend';
        stateChanged = true;
        sPivot = row.close;
        lastNaturalRallySS = rallyHighRef;
        ssPivot = rallyHighRef; // mark SS when rally ends in uptrend
        naturalRallyHigh = null;
        currentRallyBbRef = null;
        naturalReactionLow = null;
        currentReactionSsRef = null;
        reason = brokeAllTimeHigh
          ? 'Natural rally -> Uptrend (broke all-time high)'
          : 'Natural rally -> Uptrend (broke S pivot)';
      } else if (row.close <= rallyHighRef - confirmThreshold) {
        // Mark SS when leaving natural rally toward reaction/downtrend.
        lastNaturalRallySS = rallyHighRef;
        ssPivot = rallyHighRef;

        const prevNaturalReactionBB = lastNaturalReactionBB;
        if (prevNaturalReactionBB !== null) {
          if (row.close <= prevNaturalReactionBB) {
            if (row.close < bbRef) {
              currentState = 'downward_trend';
              stateChanged = true;
              bPivot = row.close;
              naturalRallyHigh = null;
              currentRallyBbRef = null;
              naturalReactionLow = null;
              currentReactionSsRef = null;
              reason = 'Natural rally -> Downtrend (confirm drop <= previous natural-reaction BB and below current BB)';
            } else {
              currentState = 'natural_reaction';
              stateChanged = true;
              naturalReactionLow = row.close;
              currentReactionSsRef = rallyHighRef;
              naturalRallyHigh = null;
              currentRallyBbRef = null;
              reason = 'Natural rally -> Natural reaction (confirm drop <= previous natural-reaction BB)';
            }
          } else {
            currentState = 'secondary_reaction';
            stateChanged = true;
            naturalReactionLow = row.close;
            currentReactionSsRef = rallyHighRef;
            naturalRallyHigh = null;
            currentRallyBbRef = null;
            reason = 'Natural rally -> Secondary reaction (confirm drop above previous natural-reaction BB)';
          }
        } else if (row.close < bbRef) {
          currentState = 'downward_trend';
          stateChanged = true;
          bPivot = row.close;
          naturalRallyHigh = null;
          currentRallyBbRef = null;
          naturalReactionLow = null;
          currentReactionSsRef = null;
          reason = 'Natural rally -> Downtrend (no previous natural-reaction BB and below current BB)';
        } else {
          currentState = 'natural_reaction';
          stateChanged = true;
          naturalReactionLow = row.close;
          currentReactionSsRef = rallyHighRef;
          naturalRallyHigh = null;
          currentRallyBbRef = null;
          reason = 'Natural rally -> Natural reaction (no previous natural-reaction BB)';
        }
      } else {
        reason = 'Natural rally maintained';
      }
    } else if (currentState === 'secondary_reaction') {
      naturalReactionLow = naturalReactionLow === null ? row.close : Math.min(naturalReactionLow, row.close);
      if (lastNaturalReactionBB !== null && row.close < lastNaturalReactionBB) {
        currentState = 'natural_reaction';
        stateChanged = true;
        // Keep current reaction tracking; SS reference remains last marked SS.
        currentReactionSsRef = currentReactionSsRef ?? ssPivot ?? sPivot ?? row.close;
        reason = 'Secondary reaction -> Natural reaction (broke latest natural-reaction BB)';
      } else {
        reason = 'Secondary reaction maintained';
      }
    } else if (currentState === 'secondary_rally') {
      naturalRallyHigh = naturalRallyHigh === null ? row.close : Math.max(naturalRallyHigh, row.close);
      if (lastNaturalRallySS !== null && row.close > lastNaturalRallySS) {
        currentState = 'natural_rally';
        stateChanged = true;
        currentRallyBbRef = currentRallyBbRef ?? bbPivot ?? bPivot ?? row.close;
        reason = 'Secondary rally -> Natural rally (broke latest natural-rally SS)';
      } else {
        reason = 'Secondary rally maintained';
      }
    }

    results.push({
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      atr20: roundValue(atr),
      state: currentState,
      state_changed: stateChanged,
      reason,
      reversal_threshold_value: roundValue(reversalThreshold),
      confirm_threshold_value: roundValue(confirmThreshold),
      pivot_high: roundValue(sPivot),
      pivot_low: roundValue(bPivot),
      pivot_ss: roundValue(ssPivot),
      pivot_bb: roundValue(bbPivot),
    });

    allTimeHighSeen = allTimeHighSeen === null ? row.close : Math.max(allTimeHighSeen, row.close);
    allTimeLowSeen = allTimeLowSeen === null ? row.close : Math.min(allTimeLowSeen, row.close);
  }

  return results;
}
