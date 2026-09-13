import type { RequestObservation } from "../traffic/scenario-runner";
export interface StatusDiff { scenarioId: string; iteration: number; base: number; pr: number; }
export function diffStatuses(base: RequestObservation[], pr: RequestObservation[]): StatusDiff[] {
  return base.flatMap((item, index) => { const other = pr[index]; return other && other.status !== item.status ? [{ scenarioId: item.scenarioId, iteration: item.iteration, base: item.status, pr: other.status }] : []; });
}
