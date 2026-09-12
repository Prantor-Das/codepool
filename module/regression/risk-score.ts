import type { ImpactSubgraph } from "../knowledge-graph/impact/blast-radius";
import type { HistoricalImpact } from "../knowledge-graph/impact/historical-impact";

export const IMPACT_WEIGHTS = { directlyModified: 1, directCaller: .85, twoHopCaller: .65, sameDatabaseEntity: .6, historicalBugPath: .95, antibodyMatch: 1, endpointReachable: .8, unrelatedImport: .1 } as const;
export const SANDBOX_TRIGGER_SCORE = .75;
export type RiskSubgraph = ImpactSubgraph & { historical: HistoricalImpact[]; changeMagnitude?: number };

export function computeImpactScore(subgraph: RiskSubgraph): number {
  const callerWeight = subgraph.callers.reduce((maximum, caller) => Math.max(maximum, caller.distance <= 1 ? IMPACT_WEIGHTS.directCaller : IMPACT_WEIGHTS.twoHopCaller), 0);
  const relationshipWeight = Math.max(subgraph.changedSymbols.length ? IMPACT_WEIGHTS.directlyModified : 0, callerWeight, subgraph.dataDependencies.length ? IMPACT_WEIGHTS.sameDatabaseEntity : 0, subgraph.antibodies.length ? IMPACT_WEIGHTS.antibodyMatch : 0, subgraph.endpoints.length ? IMPACT_WEIGHTS.endpointReachable : 0);
  const closestDistance = Math.min(...subgraph.reachableSymbols.map((symbol) => symbol.distance), 4);
  const inverseDistance = Number.isFinite(closestDistance) ? 1 / (closestDistance + 1) : 0;
  const historicalWeight = subgraph.historical.length ? IMPACT_WEIGHTS.historicalBugPath : 0;
  const runtimeCriticality = Math.max(subgraph.endpoints.length ? IMPACT_WEIGHTS.endpointReachable : 0, subgraph.scenarios.length ? .7 : 0);
  const magnitude = Math.max(0, Math.min(1, subgraph.changeMagnitude ?? 0));
  return Math.min(1, relationshipWeight * .25 + inverseDistance * .15 + historicalWeight * .25 + runtimeCriticality * .20 + magnitude * .15);
}
