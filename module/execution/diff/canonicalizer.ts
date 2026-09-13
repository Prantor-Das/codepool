export interface CanonicalizerConfig {
  noisyKeys?: string[];
  noisyPatterns?: RegExp[];
}

const DEFAULT_KEYS = ["createdAt", "updatedAt", "timestamp", "requestId", "traceId", "correlationId"];
const DEFAULT_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g,
];

export function canonicalize(value: unknown, config: CanonicalizerConfig = {}): unknown {
  const noisyKeys = new Set([...DEFAULT_KEYS, ...(config.noisyKeys ?? [])]);
  const patterns = [...DEFAULT_PATTERNS, ...(config.noisyPatterns ?? [])];
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, config));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !noisyKeys.has(key)).map(([key, item]) => [key, canonicalize(item, config)]));
  }
  if (typeof value === "string") return patterns.reduce((result, pattern) => result.replace(pattern, "<normalized>"), value);
  return value;
}
