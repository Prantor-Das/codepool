import type { SandboxEnvironment, SandboxPair, SandboxResponse } from "../sandbox/provisioner";

export interface ScenarioAssertion {
  kind: "status" | "json-path" | "header" | "body-contains";
  path?: string;
  expected: unknown;
}

export interface Scenario {
  id: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  iterations?: number;
  assertions?: ScenarioAssertion[];
}

export type ScenarioSource = "integration-test" | "openapi" | "historical-regression" | "recorded-traffic" | "llm-fallback";

export interface ScenarioSet { source: ScenarioSource; scenarios: Scenario[]; }

export function selectScenarios(sources: Partial<Record<ScenarioSource, Scenario[]>>): ScenarioSet {
  const priority: ScenarioSource[] = ["integration-test", "openapi", "historical-regression", "recorded-traffic", "llm-fallback"];
  for (const source of priority) if (sources[source]?.length) return { source, scenarios: sources[source]! };
  return { source: "llm-fallback", scenarios: [] };
}

export interface RequestObservation {
  scenarioId: string;
  iteration: number;
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  elapsedMs: number;
}

export interface BranchRun { branch: "base" | "pr"; observations: RequestObservation[]; }

async function runBranch(environment: SandboxEnvironment, scenarios: Scenario[], branch: BranchRun["branch"]): Promise<BranchRun> {
  const observations: RequestObservation[] = [];
  for (const scenario of scenarios) {
    const iterations = scenario.iterations ?? 20;
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const response: SandboxResponse = await environment.request({ method: scenario.method, path: scenario.path, headers: scenario.headers, body: scenario.body });
      observations.push({ scenarioId: scenario.id, iteration, method: scenario.method, path: scenario.path, ...response });
    }
  }
  return { branch, observations };
}

export async function runScenarioPair(pair: SandboxPair, scenarios: Scenario[]): Promise<{ base: BranchRun; pr: BranchRun }> {
  const base = await runBranch(pair.baseEnv, scenarios, "base");
  const pr = await runBranch(pair.prEnv, scenarios, "pr");
  return { base, pr };
}
