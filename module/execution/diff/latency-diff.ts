import type { RequestObservation } from "../traffic/scenario-runner";

export interface LatencyStats { p50: number; p90: number; p95: number; p99: number; }
export interface LatencyDiff { scenarioId: string; base: LatencyStats; pr: LatencyStats; deltas: LatencyStats; threshold: number; flagged: boolean; }
function percentile(values: number[], percentileValue: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]; }
export function latencyStats(values: number[]): LatencyStats { return { p50: percentile(values, .5), p90: percentile(values, .9), p95: percentile(values, .95), p99: percentile(values, .99) }; }
export function diffLatency(base: RequestObservation[], pr: RequestObservation[], threshold = .15): LatencyDiff[] {
  const ids = [...new Set(base.map((item) => item.scenarioId))];
  return ids.map((scenarioId) => {
    const left = latencyStats(base.filter((item) => item.scenarioId === scenarioId).map((item) => item.elapsedMs));
    const right = latencyStats(pr.filter((item) => item.scenarioId === scenarioId).map((item) => item.elapsedMs));
    const deltas = { p50: relativeDelta(left.p50, right.p50), p90: relativeDelta(left.p90, right.p90), p95: relativeDelta(left.p95, right.p95), p99: relativeDelta(left.p99, right.p99) };
    return { scenarioId, base: left, pr: right, deltas, threshold, flagged: base.filter(item => item.scenarioId === scenarioId).length >= 20 && pr.filter(item => item.scenarioId === scenarioId).length >= 20 && Object.values(deltas).some((delta) => delta > threshold) };
  });
}
function relativeDelta(base: number, pr: number): number { return base === 0 ? (pr > 0 ? 1 : 0) : (pr - base) / base; }
