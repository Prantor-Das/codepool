import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { ReplayProxy, replayServiceScript, createReplayEgressHandler } from "./replay-proxy";

test("uploaded offline replay service returns recorded responses and fails closed on misses", async () => {
  const proxy = new ReplayProxy();
  const request = { method: "GET", path: "https://payments.test/balance" };
  await proxy.record(request, { send: async () => ({ status: 200, headers: {}, body: { balance: 100 } }) });
  expect(await createReplayEgressHandler(proxy, "replay")(request)).toEqual({ status: 200, headers: {}, body: { balance: 100 } });
  let handler: (req: unknown, res: unknown) => Promise<void>;
  runInNewContext(replayServiceScript(proxy.entries()), { require: (name: string) => {
    if (name === "node:crypto") return { createHash };
    if (name === "node:http") return { createServer: (fn: typeof handler) => { handler = fn; return { listen: () => {} }; } };
    throw new Error("Unexpected dependency");
  } });
  async function send(method: string, url: string, body?: unknown) {
    let status = 200, output = "";
    await handler({ method, url, async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } }, { writeHead: (code: number) => { status = code; }, setHeader: () => {}, end: (value = "") => { output = value; } });
    return { status, output };
  }
  expect(JSON.parse((await send("POST", "/replay", request)).output).body.balance).toBe(100);
  expect((await send("POST", "/replay", { ...request, path: "https://evil.test" })).status).toBe(502);
  expect(JSON.parse((await send("GET", "/audit")).output)).toEqual({ mode: "offline-replay", replayed: 1, misses: 1 });
});
