import { MongoClient, type Collection, type ObjectId } from "mongodb";
import { env } from "./config";

export interface UserRecord {
  role?: "admin" | "user";
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
  namespace?: string;
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
  status:
    "processing" | "ready" | "starting" | "started" | "failed" | "deleting";
  ecosystem?: string;
  startedAt?: Date;
  error?: string;
}

export interface LogCursor {
  _id: string;
  offset: number;
  identity: string;
}

export interface ProcessLabelRecord {
  scope: string;
  name: string;
  namespace: string;
  label: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface ProcessProjectRecord {
  scope: string;
  name: string;
  namespace: string;
  projectId: ObjectId | null;
  updatedAt: Date;
  updatedBy: string;
}

export interface ProcessInventoryRecord {
  scope: string;
  name: string;
  namespace: string;
  projectId: ObjectId;
}

export interface ProcessStartupRecord {
  scope: string;
  name: string;
  namespace: string;
  projectId: ObjectId;
  enabled: boolean;
  updatedAt: Date;
  updatedBy: string;
  lastAttemptAt?: Date;
  error?: string;
}

export interface ProjectRecord {
  name: string;
  nameKey: string;
  description: string;
  documentation?: string;
  applicationUrl?: string;
  rootPath: string;
  rootKey: string;
  pm2ConfigPath: string;
  pm2ConfigContent?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  nextBuildNumber: number;
  activeBuildId?: ObjectId;
  updatedBy?: string;
  deleting?: boolean;
  deployment?: { buildId: ObjectId; attemptId: string };
  deploymentError?: string;
}

export interface ProjectBuildRecord {
  projectId: ObjectId;
  name: string;
  nameKey: string;
  number: number;
  comments: string;
  createdBy: string;
  createdAt: Date;
  originalName: string;
  size: number;
  sha256: string;
  status:
    "processing" | "ready" | "deploying" | "deployed" | "failed" | "deleting";
  archiveReady: boolean;
  extracted: boolean;
  sourceRoot?: string;
  fileCount?: number;
  deployedAt?: Date;
  deployedBy?: string;
  error?: string;
}

export const mongo = new MongoClient(env.mongoUri, {
  serverSelectionTimeoutMS: 5000,
});
const db = mongo.db(env.mongoDatabase);
export const users = db.collection<UserRecord>("users");
export const logs = db.collection<LogRecord>("logs");
export const versions = db.collection<VersionRecord>("versions");
export const processLabels =
  db.collection<ProcessLabelRecord>("process_labels");
export const processProjects = db.collection<ProcessProjectRecord>("process_projects");
export const processInventory = db.collection<ProcessInventoryRecord>("process_inventory");
export const processStartup = db.collection<ProcessStartupRecord>("process_startup");
export const projects = db.collection<ProjectRecord>("projects");
export const projectBuilds =
  db.collection<ProjectBuildRecord>("project_builds");
export const logCursors: Collection<LogCursor> =
  db.collection<LogCursor>("log_cursors");

export interface RetentionSettings {
  _id: string;
  enabled: boolean;
  retentionDays: number;
  updatedAt: Date;
  updatedBy: string;
  lastRunAt?: Date;
  lastDeleted?: number;
  lastError?: string;
}
export const retentionSettings = db.collection<RetentionSettings>("settings");

export async function connectDatabase() {
  await mongo.connect();
  await db.command({ ping: 1 });
  await Promise.all([
    users.createIndex({ username: 1 }, { unique: true }),
    logs.createIndex({ createdAt: -1, _id: -1 }),
    logs.createIndex({ kind: 1, processId: 1, createdAt: -1 }),
    versions.createIndex({ project: 1, version: 1 }, { unique: true }),
    versions.createIndex({ createdAt: -1 }),
    processLabels.createIndex(
      { scope: 1, name: 1, namespace: 1 },
      { unique: true },
    ),
    processProjects.createIndex({ scope: 1, name: 1, namespace: 1 }, { unique: true }),
    processProjects.createIndex({ projectId: 1 }),
    processInventory.createIndex({ scope: 1, name: 1, namespace: 1 }, { unique: true }),
    processStartup.createIndex({ scope: 1, name: 1, namespace: 1 }, { unique: true }),
    projects.createIndex({ nameKey: 1 }, { unique: true }),
    projects.createIndex({ rootKey: 1 }, { unique: true }),
    projectBuilds.createIndex({ projectId: 1, nameKey: 1 }, { unique: true }),
    projectBuilds.createIndex({ projectId: 1, createdAt: -1, _id: -1 }),
    projectBuilds.createIndex({ createdAt: -1, _id: -1 }),
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
    role: user.role === "admin" ? "admin" : "user",
    createdAt: user.createdAt,
  };
}
