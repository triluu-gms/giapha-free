import neo4j, { type Driver } from 'neo4j-driver';
import { config } from './config';

// The driver is created lazily and reused across requests (and across warm
// serverless invocations on Vercel), as recommended by Neo4j.
let driver: Driver | undefined;

export function getDriver(): Driver {
  if (!driver) {
    const { uri, username, password } = config.neo4j;
    if (!uri || !password) {
      throw new Error('NEO4J_URI and NEO4J_PASSWORD must be set (see backend/.env.example)');
    }
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password), {
      // Return plain JS numbers instead of neo4j Integer objects.
      disableLosslessIntegers: true,
    });
  }
  return driver;
}

export async function query<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
  mode: 'READ' | 'WRITE' = 'READ',
): Promise<T[]> {
  const { records } = await getDriver().executeQuery(cypher, params, {
    database: config.neo4j.database,
    routing: mode === 'READ' ? neo4j.routing.READ : neo4j.routing.WRITE,
  });
  return records.map((record) => record.toObject() as T);
}

/** Runs one statement and returns its rows, like query(); inside writeTransaction it runs in that transaction. */
export type Run = <T = Record<string, unknown>>(cypher: string, params?: Record<string, unknown>) => Promise<T[]>;

/**
 * Runs several write statements in one transaction: all of them apply, or none do.
 * Throwing from `work` (e.g. after reading something back) rolls everything back.
 */
export async function writeTransaction<T>(work: (run: Run) => Promise<T>): Promise<T> {
  const session = getDriver().session({ database: config.neo4j.database, defaultAccessMode: neo4j.session.WRITE });
  try {
    return await session.executeWrite((tx) =>
      work(async <R>(cypher: string, params: Record<string, unknown> = {}) => {
        const { records } = await tx.run(cypher, params);
        return records.map((record) => record.toObject() as R);
      }),
    );
  } finally {
    await session.close();
  }
}

export async function closeDriver(): Promise<void> {
  await driver?.close();
  driver = undefined;
}
