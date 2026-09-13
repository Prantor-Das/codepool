import { runQuery } from "../lib/graph-client";

export type GraphSymbol = { id: string; name: string; distance: number; relationship?: string };
export type AntibodyMatch = { id: string; problem?: string; invariant?: string; watchedSymbolId: string; distance: number };
export type ImpactSubgraph = {
  changedSymbols: GraphSymbol[];
  callers: GraphSymbol[];
  reachableSymbols: GraphSymbol[];
  antibodies: AntibodyMatch[];
  endpoints: Array<{ id: string; path?: string; method?: string; symbolId: string }>;
  scenarios: Array<{ id: string; name?: string; symbolId: string }>;
  dataDependencies: Array<{ id: string; name?: string; distance: number }>;
};

const startMatch = "s.repositoryId = $repositoryId AND (s.id IN $changed OR s.name IN $changed OR s.filePath IN $changed)";
const records = <T>(result: Awaited<ReturnType<typeof runQuery>>, map: (record: { get(key: string): unknown }) => T) => result.records.map(map);
const value = (record: { get(key: string): unknown }, key: string) => record.get(key) as string | undefined;

/**
 * Bounded impact traversal. CALLS paths never exceed four edges, IMPORTS three,
 * and READS/WRITES data paths two. Keep these ceilings explicit in Cypher.
 */
export async function getBlastRadius(repositoryId: string, changed: string[]): Promise<ImpactSubgraph> {
  if (!changed.length) return { changedSymbols: [], callers: [], reachableSymbols: [], antibodies: [], endpoints: [], scenarios: [], dataDependencies: [] };
  const params = { repositoryId, changed };
  const [changedResult, callersResult, reachableResult, antibodyResult, endpointResult, scenarioResult, dataResult] = await Promise.all([
    runQuery(`MATCH (s:Symbol) WHERE ${startMatch} RETURN DISTINCT s.id AS id, s.name AS name`, params),
    runQuery(`MATCH (changed:Symbol) WHERE ${startMatch.replaceAll("s.", "changed.")} MATCH path=(caller:Symbol)-[:CALLS*1..4]->(changed) RETURN caller.id AS id, caller.name AS name, min(length(path)) AS distance`, params),
    runQuery(`MATCH (changed:Symbol) WHERE ${startMatch.replaceAll("s.", "changed.")}
      CALL { WITH changed MATCH path=(changed)-[:CALLS*0..4]-(reachable:Symbol) RETURN reachable, min(length(path)) AS distance
             UNION WITH changed MATCH path=(changed)-[:IMPORTS*1..3]-(reachable:Symbol) RETURN reachable, min(length(path)) AS distance }
      RETURN DISTINCT reachable.id AS id, reachable.name AS name, min(distance) AS distance`, params),
    runQuery(`MATCH (changed:Symbol) WHERE ${startMatch.replaceAll("s.", "changed.")}
      CALL { WITH changed MATCH path=(changed)-[:CALLS*0..4]-(reachable:Symbol) RETURN reachable, min(length(path)) AS distance
             UNION WITH changed MATCH path=(changed)-[:IMPORTS*1..3]-(reachable:Symbol) RETURN reachable, min(length(path)) AS distance }
      MATCH (antibody:Antibody)-[:WATCHES]->(reachable) WHERE NOT coalesce(antibody.status, '') IN ['rejected', 'superseded'] OPTIONAL MATCH (antibody)-[:PROTECTS]->(invariant:Invariant)
      RETURN DISTINCT antibody.id AS id, antibody.problem AS problem, invariant.statement AS invariant, reachable.id AS watchedSymbolId, min(distance) AS distance`, params),
    runQuery(`MATCH (changed:Symbol) WHERE ${startMatch.replaceAll("s.", "changed.")}
      CALL { WITH changed MATCH (changed)-[:CALLS*0..4]-(reachable:Symbol) RETURN DISTINCT reachable
             UNION WITH changed MATCH (changed)-[:IMPORTS*1..3]-(reachable:Symbol) RETURN DISTINCT reachable }
      MATCH (reachable)-[:SERVES]->(endpoint:Endpoint)
      RETURN DISTINCT endpoint.id AS id, endpoint.path AS path, endpoint.method AS method, reachable.id AS symbolId`, params),
    runQuery(`MATCH (changed:Symbol) WHERE ${startMatch.replaceAll("s.", "changed.")}
      CALL { WITH changed MATCH (changed)-[:CALLS*0..4]-(reachable:Symbol) RETURN DISTINCT reachable
             UNION WITH changed MATCH (changed)-[:IMPORTS*1..3]-(reachable:Symbol) RETURN DISTINCT reachable }
      MATCH (reachable)<-[:TOUCHES]-(scenario:Scenario)
      RETURN DISTINCT scenario.id AS id, scenario.name AS name, reachable.id AS symbolId`, params),
    runQuery(`MATCH (changed:Symbol) WHERE ${startMatch.replaceAll("s.", "changed.")}
      MATCH path=(changed)-[:READS|WRITES*1..2]-(entity:DatabaseEntity)
      RETURN DISTINCT entity.id AS id, entity.name AS name, min(length(path)) AS distance`, params),
  ]);
  return {
    changedSymbols: records(changedResult, (r) => ({ id: value(r, "id")!, name: value(r, "name")!, distance: 0, relationship: "modified" })),
    callers: records(callersResult, (r) => ({ id: value(r, "id")!, name: value(r, "name")!, distance: Number(r.get("distance")), relationship: "caller" })),
    reachableSymbols: records(reachableResult, (r) => ({ id: value(r, "id")!, name: value(r, "name")!, distance: Number(r.get("distance")) })),
    antibodies: records(antibodyResult, (r) => ({ id: value(r, "id")!, problem: value(r, "problem"), invariant: value(r, "invariant"), watchedSymbolId: value(r, "watchedSymbolId")!, distance: Number(r.get("distance")) })),
    endpoints: records(endpointResult, (r) => ({ id: value(r, "id")!, path: value(r, "path"), method: value(r, "method"), symbolId: value(r, "symbolId")! })),
    scenarios: records(scenarioResult, (r) => ({ id: value(r, "id")!, name: value(r, "name"), symbolId: value(r, "symbolId")! })),
    dataDependencies: records(dataResult, (r) => ({ id: value(r, "id")!, name: value(r, "name"), distance: Number(r.get("distance")) })),
  };
}
