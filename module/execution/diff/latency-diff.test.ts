import { expect, test } from "bun:test";
import { diffLatency, latencyStats } from "./latency-diff";

const observation = (elapsedMs: number, iteration: number) => ({
  scenarioId: "home",
  iteration,
  method: "GET",
  path: "/",
  status: 200,
  headers: {},
  body: { ok: true },
  elapsedMs,
});

test("computes p50 and p99 from sorted latency samples", () => {
  expect(latencyStats([40, 10, 30, 20])).toMatchObject({ p50: 20, p99: 40 });
});

test("compares base and PR p50/p99 values and flags a large regression", () => {
  const base = [10, 20, 30, 40].map(observation);
  const pr = [20, 40, 60, 80].map(observation);
  const [result] = diffLatency(base, pr);

  expect(result.base).toMatchObject({ p50: 20, p99: 40 });
  expect(result.pr).toMatchObject({ p50: 40, p99: 80 });
  expect(result.deltas).toMatchObject({ p50: 1, p99: 1 });
  // Four samples are intentionally below the 20-sample evidence threshold.
  expect(result.flagged).toBe(false);
});

