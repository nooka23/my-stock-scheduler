export type Observation = { time: string; value: number };

/** Calendar horizons anchored to the displayed observation, with holiday tolerance. */
export function marketChanges(rows: Observation[], basisPoints = false) {
  const latest = rows.at(-1);
  if (!latest) return [null, null, null];
  const day = new Date(`${latest.time}T00:00:00Z`);
  const week = new Date(day); week.setUTCDate(week.getUTCDate() - 7);
  const month = new Date(day); month.setUTCDate(1); month.setUTCMonth(month.getUTCMonth() - 1);
  const monthEnd = new Date(month); monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1); monthEnd.setUTCDate(0);
  month.setUTCDate(Math.min(day.getUTCDate(), monthEnd.getUTCDate()));
  const reference = (target: Date) => {
    const point = rows.findLast(row => row.time <= target.toISOString().slice(0, 10));
    return point && (target.getTime() - Date.parse(point.time)) / 86400000 <= 7 ? point : undefined;
  };
  const prior = rows.at(-2);
  const daily = prior && (day.getTime() - Date.parse(prior.time)) / 86400000 <= 7 ? prior : undefined;
  return [daily, reference(week), reference(month)].map(point => {
    if (!point || !Number.isFinite(point.value) || !Number.isFinite(latest.value)) return null;
    return basisPoints ? (latest.value - point.value) * 100 : point.value > 0 && latest.value >= 0 ? (latest.value / point.value - 1) * 100 : null;
  });
}

export function signed(value: number | null, unit = '%') {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
}

export function sortEconomic<T extends { code: string; detected_at?: string | null; rows: Observation[] }>(items: T[]) {
  return [...items].sort((a, b) => {
    const detected = (b.detected_at ?? '').localeCompare(a.detected_at ?? '');
    return detected || (b.rows.at(-1)?.time ?? '').localeCompare(a.rows.at(-1)?.time ?? '') || a.code.localeCompare(b.code);
  });
}
