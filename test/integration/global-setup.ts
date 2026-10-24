import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

// Same version as docker-compose, so tests exercise the server we deploy.
// The binary is downloaded once (~100 MB) and cached in ~/.cache/mongodb-binaries.
const MONGO_VERSION = '8.2.12';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/**
 * Runs once before all integration test files: starts a real mongod on a
 * random port with an in-memory-style temp data directory. Each test file
 * then uses its own database on it, so files can't see each other's data.
 */
export default async function setup(project: TestProject) {
  const mongo = await MongoMemoryServer.create({ binary: { version: MONGO_VERSION } });
  project.provide('mongoUri', mongo.getUri());

  return async () => {
    await mongo.stop();
  };
}
