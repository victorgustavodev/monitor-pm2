import { MongoClient, type Collection, type ObjectId } from "mongodb";
import { env } from "./config";

export interface UserRecord {
  username: string;
  passwordHash: string;
  createdAt: Date;
}

export interface LogRecord {
  kind: "audit" | "process";
  createdAt: Date;
  username?: string;
  ip?: string;
  method?: string;
  path?: string;
  status?: number;
  processId?: number;
  processName?: string;
  source?: string;
  content?: string;
}

export interface VersionRecord {
  project: string;
  version: string;
  originalName: string;
  size: number;
  sha256: string;
  createdAt: Date;
  createdBy: string;
  status: "processing" | "ready" | "starting" | "started" | "failed";
  ecosystem?: string;
  startedAt?: Date;
  error?: string;
}

export interface LogCursor {
  _id: string;
  offset: number;
  identity: string;
}

export const mongo = new MongoClient(env.mongoUri, {
  serverSelectionTimeoutMS: 5000,
});
const db = mongo.db(env.mongoDatabase);
export const users = db.collection<UserRecord>("users");
export const logs = db.collection<LogRecord>("logs");
export const versions = db.collection<VersionRecord>("versions");
export const logCursors: Collection<LogCursor> =
  db.collection<LogCursor>("log_cursors");

export async function connectDatabase() {
  await mongo.connect();
  await db.command({ ping: 1 });
  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true }),
    logs.createIndex({ createdAt: -1, _id: -1 }),
    logs.createIndex({ kind: 1, processId: 1, createdAt: -1 }),
    versions.createIndex({ project: 1, version: 1 }, { unique: true }),
    versions.createIndex({ createdAt: -1 }),
  ]);
  // Um reinício pode interromper uma extração ou uma chamada ao PM2.
  await versions.updateMany(
    { status: { $in: ["processing", "starting"] } },
    {
      $set: {
        status: "failed",
        error:
          "Operação interrompida pelo reinício do monitor. Confira o PM2 antes de iniciar novamente.",
      },
    },
  );
}

export function publicUser(user: UserRecord & { _id: ObjectId }) {
  return {
    id: user._id.toHexString(),
    username: user.username,
    createdAt: user.createdAt,
  };
}
