import { canonicalize } from "./canonicalizer";

export type JsonDiffKind = "added" | "removed" | "type-changed" | "changed";
export interface JsonDiff { path: string; kind: JsonDiffKind; base?: unknown; pr?: unknown; }

function typeOf(value: unknown): string { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function walk(base: unknown, pr: unknown, path: string, out: JsonDiff[]) {
  if (base === undefined && pr !== undefined) return out.push({ path, kind: "added", pr });
  if (base !== undefined && pr === undefined) return out.push({ path, kind: "removed", base });
  if (typeOf(base) !== typeOf(pr)) return out.push({ path, kind: "type-changed", base, pr });
  if (base && pr && typeof base === "object" && typeof pr === "object") {
    const keys = new Set([...Object.keys(base), ...Object.keys(pr)]);
    for (const key of keys) walk((base as Record<string, unknown>)[key], (pr as Record<string, unknown>)[key], `${path}.${key}`, out);
  } else if (base !== pr) out.push({ path, kind: "changed", base, pr });
}

export function diffJson(base: unknown, pr: unknown, config?: Parameters<typeof canonicalize>[1]): JsonDiff[] {
  const out: JsonDiff[] = [];
  walk(canonicalize(base, config), canonicalize(pr, config), "$", out);
  return out;
}
