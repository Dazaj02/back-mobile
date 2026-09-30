/** Próxima medianoche UTC (reinicio de la cuota diaria). */
export function nextUtcMidnight(nowMs: number): Date {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

export function secondsUntilNextUtcMidnight(nowMs: number): number {
  return Math.max(1, Math.ceil((nextUtcMidnight(nowMs).getTime() - nowMs) / 1000));
}
