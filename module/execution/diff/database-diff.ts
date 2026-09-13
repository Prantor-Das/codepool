export interface DatabaseSnapshot { rowCounts: Record<string, number>; criticalFields?: Record<string, Record<string, unknown>>; events?: unknown[]; queueMessages?: unknown[]; }
export interface DatabaseDiff { rowCountChanges: Record<string, { base?: number; pr?: number }>; criticalFieldChanges: string[]; eventChanges: boolean; queueChanges: boolean; }
export function diffDatabase(base: DatabaseSnapshot, pr: DatabaseSnapshot): DatabaseDiff {
  const rowCountChanges: DatabaseDiff["rowCountChanges"] = {};
  for (const table of new Set([...Object.keys(base.rowCounts), ...Object.keys(pr.rowCounts)])) if (base.rowCounts[table] !== pr.rowCounts[table]) rowCountChanges[table] = { base: base.rowCounts[table], pr: pr.rowCounts[table] };
  const criticalFieldChanges: string[] = [];
  for (const entity of new Set([...Object.keys(base.criticalFields ?? {}), ...Object.keys(pr.criticalFields ?? {})])) if (JSON.stringify(base.criticalFields?.[entity]) !== JSON.stringify(pr.criticalFields?.[entity])) criticalFieldChanges.push(entity);
  return { rowCountChanges, criticalFieldChanges, eventChanges: JSON.stringify(base.events ?? []) !== JSON.stringify(pr.events ?? []), queueChanges: JSON.stringify(base.queueMessages ?? []) !== JSON.stringify(pr.queueMessages ?? []) };
}
