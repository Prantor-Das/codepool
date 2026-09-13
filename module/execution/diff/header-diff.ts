import type { RequestObservation } from "../traffic/scenario-runner";
export interface HeaderDiff { scenarioId: string; iteration: number; header: string; base?: string; pr?: string; }
export function diffHeaders(base: RequestObservation[], pr: RequestObservation[]): HeaderDiff[] {
  const result: HeaderDiff[] = [];
  for (let index = 0; index < Math.min(base.length, pr.length); index += 1) {
    const left = base[index], right = pr[index];
    for (const header of new Set([...Object.keys(left.headers), ...Object.keys(right.headers)])) if (left.headers[header] !== right.headers[header]) result.push({ scenarioId: left.scenarioId, iteration: left.iteration, header, base: left.headers[header], pr: right.headers[header] });
  }
  return result;
}
