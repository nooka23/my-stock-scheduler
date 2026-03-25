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
  pivot_high_date: string | null;
  pivot_low: number | null;
  pivot_low_date: string | null;
  pivot_ss: number | null;
  pivot_ss_date: string | null;
  pivot_bb: number | null;
  pivot_bb_date: string | null;
};

export type LivermoreParams = {
  reversalMultiplier: number;
  confirmMultiplier: number;
  momentumLookback: number;
};

type Pivot = {
  price: number;
  date: string;
};

type Ledger = {
  upwardTrend: Pivot | null;
  downwardTrend: Pivot | null;
  naturalRally: Pivot | null;
  naturalReaction: Pivot | null;
  secondaryRally: Pivot | null;
  secondaryReaction: Pivot | null;
};

type Extremes = {
  naturalRally: Pivot | null;
  naturalReaction: Pivot | null;
  secondaryRally: Pivot | null;
  secondaryReaction: Pivot | null;
};

type Pivots = {
  s: Pivot | null;
  b: Pivot | null;
  ss: Pivot | null;
  bb: Pivot | null;
  linedNaturalRally: Pivot | null;
  linedNaturalReaction: Pivot | null;
};

const DEFAULT_PARAMS: LivermoreParams = {
  reversalMultiplier: 3.0,
  confirmMultiplier: 1.5,
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

    trValues.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      ),
    );

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

function makePivot(price: number, date: string): Pivot {
  return { price, date };
}

function higherPivot(left: Pivot | null, right: Pivot): Pivot {
  if (left === null || right.price >= left.price) return right;
  return left;
}

function lowerPivot(left: Pivot | null, right: Pivot): Pivot {
  if (left === null || right.price <= left.price) return right;
  return left;
}

function buildResultRow(
  row: PriceRow,
  atr: number | null,
  state: ExtendedLivermoreState,
  stateChanged: boolean,
  reason: string,
  reversalThreshold: number | null,
  confirmThreshold: number | null,
  pivots: Pivots,
): LivermoreComputedRow {
  return {
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    atr20: roundValue(atr),
    state,
    state_changed: stateChanged,
    reason,
    reversal_threshold_value: roundValue(reversalThreshold),
    confirm_threshold_value: roundValue(confirmThreshold),
    pivot_high: roundValue(pivots.s?.price ?? null),
    pivot_high_date: pivots.s?.date ?? null,
    pivot_low: roundValue(pivots.b?.price ?? null),
    pivot_low_date: pivots.b?.date ?? null,
    pivot_ss: roundValue(pivots.ss?.price ?? null),
    pivot_ss_date: pivots.ss?.date ?? null,
    pivot_bb: roundValue(pivots.bb?.price ?? null),
    pivot_bb_date: pivots.bb?.date ?? null,
  };
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
  let bootstrapAnchor: Pivot | null = null;

  const ledger: Ledger = {
    upwardTrend: null,
    downwardTrend: null,
    naturalRally: null,
    naturalReaction: null,
    secondaryRally: null,
    secondaryReaction: null,
  };

  const extremes: Extremes = {
    naturalRally: null,
    naturalReaction: null,
    secondaryRally: null,
    secondaryReaction: null,
  };

  const pivots: Pivots = {
    s: null,
    b: null,
    ss: null,
    bb: null,
    linedNaturalRally: null,
    linedNaturalReaction: null,
  };

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const atr = atr20[i];

    if (atr === null) {
      results.push(
        buildResultRow(
          row,
          null,
          'insufficient_data',
          false,
          'ATR20 unavailable',
          null,
          null,
          pivots,
        ),
      );
      continue;
    }

    const reversalThreshold = atr * params.reversalMultiplier;
    const confirmThreshold = atr * params.confirmMultiplier;

    if (currentState === null) {
      if (bootstrapAnchor === null) {
        bootstrapAnchor = makePivot(row.close, row.date);
        results.push(
          buildResultRow(
            row,
            atr,
            'insufficient_data',
            false,
            'Bootstrap pending initial directional move',
            reversalThreshold,
            confirmThreshold,
            pivots,
          ),
        );
        continue;
      }

      if (row.close >= bootstrapAnchor.price + reversalThreshold) {
        currentState = 'upward_trend';
        ledger.upwardTrend = makePivot(row.close, row.date);
        results.push(
          buildResultRow(
            row,
            atr,
            currentState,
            true,
            'Bootstrap -> Upward trend',
            reversalThreshold,
            confirmThreshold,
            pivots,
          ),
        );
        continue;
      }

      if (row.close <= bootstrapAnchor.price - reversalThreshold) {
        currentState = 'downward_trend';
        ledger.downwardTrend = makePivot(row.close, row.date);
        results.push(
          buildResultRow(
            row,
            atr,
            currentState,
            true,
            'Bootstrap -> Downward trend',
            reversalThreshold,
            confirmThreshold,
            pivots,
          ),
        );
        continue;
      }

      results.push(
        buildResultRow(
          row,
          atr,
          'insufficient_data',
          false,
          'Bootstrap pending initial directional move',
          reversalThreshold,
          confirmThreshold,
          pivots,
        ),
      );
      continue;
    }

    let stateChanged = false;
    let reason = 'State maintained';

    for (let transitionCount = 0; transitionCount < 6; transitionCount += 1) {
      let transitioned = false;

      if (currentState === 'upward_trend') {
        ledger.upwardTrend = higherPivot(ledger.upwardTrend, makePivot(row.close, row.date));

        if (row.close <= ledger.upwardTrend.price - reversalThreshold) {
          pivots.ss = ledger.upwardTrend;
          ledger.naturalReaction = makePivot(row.close, row.date);
          extremes.naturalReaction = ledger.naturalReaction;
          currentState = 'natural_reaction';
          stateChanged = true;
          transitioned = true;
          reason = 'Upward trend -> Natural reaction';
          break;
        }

        reason = 'Upward trend maintained';
      } else if (currentState === 'downward_trend') {
        ledger.downwardTrend = lowerPivot(ledger.downwardTrend, makePivot(row.close, row.date));

        if (row.close >= ledger.downwardTrend.price + reversalThreshold) {
          pivots.bb = ledger.downwardTrend;
          ledger.naturalRally = makePivot(row.close, row.date);
          extremes.naturalRally = ledger.naturalRally;
          currentState = 'natural_rally';
          stateChanged = true;
          transitioned = true;
          reason = 'Downward trend -> Natural rally';
          break;
        }

        reason = 'Downward trend maintained';
      } else if (currentState === 'natural_reaction') {
        if (row.close < ledger.naturalReaction!.price) {
          ledger.naturalReaction = makePivot(row.close, row.date);
          extremes.naturalReaction = lowerPivot(extremes.naturalReaction, ledger.naturalReaction);
        }

        if (ledger.downwardTrend !== null && row.close < ledger.downwardTrend.price) {
          ledger.downwardTrend = makePivot(row.close, row.date);
          currentState = 'downward_trend';
          stateChanged = true;
          transitioned = true;
          reason = 'Natural reaction -> Downward trend (broke last downward trend record)';
        } else if (
          pivots.linedNaturalReaction !== null &&
          row.close <= pivots.linedNaturalReaction.price - confirmThreshold
        ) {
          ledger.downwardTrend = makePivot(row.close, row.date);
          currentState = 'downward_trend';
          stateChanged = true;
          transitioned = true;
          reason = 'Natural reaction -> Downward trend (rule 5-B confirm below lined natural reaction)';
        } else if (row.close >= extremes.naturalReaction!.price + reversalThreshold) {
          pivots.b = extremes.naturalReaction;
          pivots.linedNaturalReaction = ledger.naturalReaction;

          if (ledger.upwardTrend !== null && row.close > ledger.upwardTrend.price) {
            ledger.upwardTrend = makePivot(row.close, row.date);
            currentState = 'upward_trend';
            stateChanged = true;
            transitioned = true;
            reason = 'Natural reaction -> Upward trend (broke last upward trend record)';
          } else if (ledger.naturalRally === null || row.close > ledger.naturalRally.price) {
            ledger.naturalRally = makePivot(row.close, row.date);
            extremes.naturalRally = ledger.naturalRally;
            currentState = 'natural_rally';
            stateChanged = true;
            transitioned = true;
            reason =
              ledger.naturalRally === null
                ? 'Natural reaction -> Natural rally (first natural rally record)'
                : 'Natural reaction -> Natural rally (broke last natural rally record)';
          } else {
            ledger.secondaryRally = makePivot(row.close, row.date);
            extremes.secondaryRally = ledger.secondaryRally;
            currentState = 'secondary_rally';
            stateChanged = true;
            transitioned = true;
            reason = 'Natural reaction -> Secondary rally';
          }
        } else {
          reason = 'Natural reaction maintained';
        }
      } else if (currentState === 'natural_rally') {
        if (row.close > ledger.naturalRally!.price) {
          ledger.naturalRally = makePivot(row.close, row.date);
          extremes.naturalRally = higherPivot(extremes.naturalRally, ledger.naturalRally);
        }

        if (ledger.upwardTrend !== null && row.close > ledger.upwardTrend.price) {
          ledger.upwardTrend = makePivot(row.close, row.date);
          currentState = 'upward_trend';
          stateChanged = true;
          transitioned = true;
          reason = 'Natural rally -> Upward trend (broke last upward trend record)';
        } else if (
          pivots.linedNaturalRally !== null &&
          row.close >= pivots.linedNaturalRally.price + confirmThreshold
        ) {
          ledger.upwardTrend = makePivot(row.close, row.date);
          currentState = 'upward_trend';
          stateChanged = true;
          transitioned = true;
          reason = 'Natural rally -> Upward trend (rule 5-A confirm above lined natural rally)';
        } else if (row.close <= extremes.naturalRally!.price - reversalThreshold) {
          pivots.s = extremes.naturalRally;
          pivots.linedNaturalRally = ledger.naturalRally;

          if (ledger.downwardTrend !== null && row.close < ledger.downwardTrend.price) {
            ledger.downwardTrend = makePivot(row.close, row.date);
            currentState = 'downward_trend';
            stateChanged = true;
            transitioned = true;
            reason = 'Natural rally -> Downward trend (broke last downward trend record)';
          } else if (ledger.naturalReaction === null || row.close < ledger.naturalReaction.price) {
            ledger.naturalReaction = makePivot(row.close, row.date);
            extremes.naturalReaction = ledger.naturalReaction;
            currentState = 'natural_reaction';
            stateChanged = true;
            transitioned = true;
            reason =
              ledger.naturalReaction === null
                ? 'Natural rally -> Natural reaction (first natural reaction record)'
                : 'Natural rally -> Natural reaction (broke last natural reaction record)';
          } else {
            ledger.secondaryReaction = makePivot(row.close, row.date);
            extremes.secondaryReaction = ledger.secondaryReaction;
            currentState = 'secondary_reaction';
            stateChanged = true;
            transitioned = true;
            reason = 'Natural rally -> Secondary reaction';
          }
        } else {
          reason = 'Natural rally maintained';
        }
      } else if (currentState === 'secondary_rally') {
        if (row.close > ledger.secondaryRally!.price) {
          ledger.secondaryRally = makePivot(row.close, row.date);
          extremes.secondaryRally = higherPivot(extremes.secondaryRally, ledger.secondaryRally);
        }

        if (ledger.naturalRally !== null && row.close > ledger.naturalRally.price) {
          ledger.naturalRally = makePivot(row.close, row.date);
          extremes.naturalRally = higherPivot(extremes.naturalRally, ledger.naturalRally);
          currentState = 'natural_rally';
          stateChanged = true;
          transitioned = true;
          reason = 'Secondary rally -> Natural rally (broke last natural rally record)';
        } else if (row.close <= extremes.secondaryRally!.price - reversalThreshold) {
          ledger.secondaryReaction = makePivot(row.close, row.date);
          extremes.secondaryReaction = ledger.secondaryReaction;
          currentState = 'secondary_reaction';
          stateChanged = true;
          transitioned = true;
          reason = 'Secondary rally -> Secondary reaction';
        } else {
          reason = 'Secondary rally maintained';
        }
      } else if (currentState === 'secondary_reaction') {
        if (row.close < ledger.secondaryReaction!.price) {
          ledger.secondaryReaction = makePivot(row.close, row.date);
          extremes.secondaryReaction = lowerPivot(extremes.secondaryReaction, ledger.secondaryReaction);
        }

        if (ledger.naturalReaction !== null && row.close < ledger.naturalReaction.price) {
          ledger.naturalReaction = makePivot(row.close, row.date);
          extremes.naturalReaction = lowerPivot(extremes.naturalReaction, ledger.naturalReaction);
          currentState = 'natural_reaction';
          stateChanged = true;
          transitioned = true;
          reason = 'Secondary reaction -> Natural reaction (broke last natural reaction record)';
        } else if (row.close >= extremes.secondaryReaction!.price + reversalThreshold) {
          ledger.secondaryRally = makePivot(row.close, row.date);
          extremes.secondaryRally = ledger.secondaryRally;
          currentState = 'secondary_rally';
          stateChanged = true;
          transitioned = true;
          reason = 'Secondary reaction -> Secondary rally';
        } else {
          reason = 'Secondary reaction maintained';
        }
      }

      if (!transitioned) {
        break;
      }
    }

    results.push(
      buildResultRow(
        row,
        atr,
        currentState,
        stateChanged,
        reason,
        reversalThreshold,
        confirmThreshold,
        pivots,
      ),
    );
  }

  return results;
}
