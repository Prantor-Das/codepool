import neo4j, { type Driver, type QueryResult, type Session } from "neo4j-driver";

let driver: Driver | undefined;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Neo4j is not configured. Set ${name}.`);
  return value;
}

/** Returns the process-wide Neo4j driver singleton. */
export function getGraphDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      getRequiredEnv("NEO4J_URI"),
      neo4j.auth.basic(getRequiredEnv("NEO4J_USER"), getRequiredEnv("NEO4J_PASSWORD")),
      { connectionAcquisitionTimeout: 15_000, connectionTimeout: 10_000 },
    );
  }
  return driver;
}

export async function withSession<T>(work: (session: Session) => Promise<T>): Promise<T> {
  const session = getGraphDriver().session();
  try {
    return await work(session);
  } finally {
    await session.close();
  }
}

export function runQuery(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
  return withSession((session) => session.run(cypher, params));
}


export async function closeGraphDriver() { await driver?.close(); driver = undefined; }
