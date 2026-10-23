import { MongoClient, type Db } from 'mongodb';

export interface MongoConnection {
  client: MongoClient;
  db: Db;
}

export async function connectMongo(uri: string, dbName: string): Promise<MongoConnection> {
  // One client per process: it owns a connection pool shared by all requests.
  const client = new MongoClient(uri, { maxPoolSize: 50 });
  await client.connect();
  return { client, db: client.db(dbName) };
}
