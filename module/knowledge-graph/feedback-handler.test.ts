import { describe, expect, test } from "bun:test";
import { createFeedbackHandler, type FeedbackDependencies } from "./feedback-handler";

const payload = { action: "regression", repositoryId: "owned", pullRequestId: "owned:pr:1", antibodyId: "antibody", invariantId: "victim", newInvariantId: "victim-new", actor: "forged" };
const request = (body: unknown = payload, origin = "https://codepool.test") => new Request("https://codepool.test/api/github/runtime-feedback", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
function fixture(overrides: Partial<FeedbackDependencies> = {}) {
  const mutations: unknown[] = [];
  const handler = createFeedbackHandler({ getSession: async () => ({ user: { id: "real-user" } }), findRepository: async (id, user) => id === "owned" && user === "real-user" ? { id } : null, getTargets: async (_repo, pr) => pr === "owned:pr:1" ? [{ antibodyId: "antibody", invariantId: "owned-invariant" }] : [], apply: async input => { mutations.push(input); return { confidence: .8, status: "verified" }; }, ...overrides });
  return { handler, mutations };
}
describe("runtime feedback authorization", () => {
  test("unauthenticated requests return 401 without writes", async () => { const f = fixture({ getSession: async () => null }); expect((await f.handler(request())).status).toBe(401); expect(f.mutations).toHaveLength(0); });
  test("cross-tenant repository is forbidden", async () => { const f = fixture(); expect((await f.handler(request({ ...payload, repositoryId: "victim" }))).status).toBe(403); expect(f.mutations).toHaveLength(0); });
  test("owned repository cannot authorize an unrelated antibody or PR", async () => { const f = fixture(); for (const body of [{ ...payload, antibodyId: "victim" }, { ...payload, pullRequestId: "victim:pr:1" }]) expect((await f.handler(request(body))).status).toBe(404); expect(f.mutations).toHaveLength(0); });
  test("cross-origin requests and invalid payloads fail closed", async () => { const f = fixture(); expect((await f.handler(request(payload, "https://evil.test"))).status).toBe(403); for (const body of [null, {}, { ...payload, antibodyId: {} }]) expect((await f.handler(request(body))).status).toBe(400); expect(f.mutations).toHaveLength(0); });
  test("oversized payload is rejected before JSON parsing", async () => { const f = fixture(); expect((await f.handler(request("x".repeat(5000)))).status).toBe(413); expect(f.mutations).toHaveLength(0); });
  test("real click payload uses trusted actor/invariant and stable receipt", async () => { const f = fixture(); const response = await f.handler(request()); expect(await response.json()).toEqual({ accepted: true, confidence: .8, status: "verified" }); await f.handler(request()); const first = f.mutations[0] as Record<string, unknown>; expect(first.actor).toBe("real-user"); expect(first.invariantId).toBe("owned-invariant"); expect(first).not.toHaveProperty("newInvariantId"); expect(f.mutations[1]).toEqual(first); });
});
