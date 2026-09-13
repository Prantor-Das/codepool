import { createHash } from "node:crypto";
import type { SandboxRequest, SandboxResponse } from "../sandbox/provisioner";

export interface CassetteEntry {
  key: string;
  response: Omit<SandboxResponse, "elapsedMs">;
}

export interface ReplayTransport {
  send(request: SandboxRequest): Promise<Omit<SandboxResponse, "elapsedMs">>;
}

function requestKey(request: SandboxRequest): string {
  return createHash("sha256").update(JSON.stringify({
    method: request.method.toUpperCase(), path: request.path,
    headers: request.headers ?? {}, body: request.body ?? null,
  })).digest("hex");
}

/** VCR-style cassette: record once, then replay the exact external response. */
export class ReplayProxy {
  private readonly cassette = new Map<string, CassetteEntry>();

  constructor(entries: CassetteEntry[] = []) {
    for (const entry of entries) this.cassette.set(entry.key, entry);
  }

  async record(request: SandboxRequest, transport: ReplayTransport): Promise<CassetteEntry> {
    const key = requestKey(request);
    const existing = this.cassette.get(key);
    if (existing) return existing;
    const response = await transport.send(request);
    const entry = { key, response };
    this.cassette.set(key, entry);
    return entry;
  }

  replay(request: SandboxRequest): Omit<SandboxResponse, "elapsedMs"> {
    const entry = this.cassette.get(requestKey(request));
    if (!entry) throw new Error(`No replay cassette entry for ${request.method} ${request.path}`);
    return entry.response;
  }

  entries(): CassetteEntry[] { return [...this.cassette.values()]; }
}

export type EgressMode = "record" | "replay";

export function createReplayEgressHandler(proxy: ReplayProxy, mode: EgressMode, transport?: ReplayTransport) {
  return async (request: SandboxRequest): Promise<Omit<SandboxResponse, "elapsedMs">> => {
    if (mode === "record") {
      if (!transport) throw new Error("A transport is required while recording an egress cassette.");
      return (await proxy.record(request, transport)).response;
    }
    return proxy.replay(request);
  };
}

/** Standalone offline replay endpoint uploaded to each VM; it has no live transport. */
export function replayServiceScript(entries: CassetteEntry[]): string {
  const cassette = new ReplayProxy(entries).entries();
  return `const { createServer } = require('node:http');
const { createHash } = require('node:crypto');
const cassette = new Map(${JSON.stringify(cassette)}.map(e => [e.key, e.response]));
let replayed = 0, misses = 0;
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/audit') { res.end(JSON.stringify({ mode: 'offline-replay', replayed, misses })); return; }
  if (req.method !== 'POST' || req.url !== '/replay') { res.writeHead(405); res.end(); return; }
  try {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1048576) throw new Error('too large'); }
    const request = JSON.parse(body);
    const key = createHash('sha256').update(JSON.stringify({ method: request.method.toUpperCase(), path: request.path, headers: request.headers ?? {}, body: request.body ?? null })).digest('hex');
    if (!cassette.has(key)) { misses++; res.writeHead(502); res.end('No replay cassette entry'); return; }
    replayed++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(cassette.get(key)));
  } catch { misses++; res.writeHead(400); res.end('Invalid replay request'); }
}).listen(8787, '0.0.0.0');`;
}
