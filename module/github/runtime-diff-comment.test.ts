import { expect, test } from "bun:test";
import { buildEvidenceObject } from "@/module/execution/diff/evidence-builder";
import { formatRuntimeComparison } from "./runtime-diff-comment";

const observation = (elapsedMs: number, iteration: number) => ({
  scenarioId: "health-check",
  iteration,
  method: "GET",
  path: "/api/health",
  status: 200,
  headers: {},
  body: { ok: true },
  elapsedMs,
});

test("renders measured p50 and p99 base-versus-PR latency", () => {
  const baseRun = { branch: "base" as const, observations: [10, 20, 30, 40].map(observation) };
  const prRun = { branch: "pr" as const, observations: [20, 40, 60, 80].map(observation) };
  const bundle = {
    changedSymbols: [],
    graphNeighborhood: {},
    historical: [],
    baseRun,
    prRun,
    evidence: buildEvidenceObject({
      runId: "run",
      pairId: "pair",
      seedId: "seed",
      baseSha: "base",
      prSha: "pr",
      scenarioSource: "integration-test",
      base: baseRun,
      pr: prRun,
    }),
  };

  const report = formatRuntimeComparison(bundle);
  expect(report).toContain("p50 base / PR");
  expect(report).toContain("p99 base / PR");
  expect(report).toContain("20.0 / 40.0 ms");
  expect(report).toContain("40.0 / 80.0 ms");
});

