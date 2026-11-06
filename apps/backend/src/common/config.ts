import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const localEnv = resolve(process.cwd(), ".env");
const workspaceEnv = resolve(process.cwd(), "..", "..", ".env");
loadEnv({ path: existsSync(localEnv) ? localEnv : workspaceEnv, quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export const projectRoot = resolve(__dirname, "..", "..", "..", "..");
const adminPassword = process.env.ADMIN_PASSWORD || "";
const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32)
  throw new Error("JWT_SECRET deve ter pelo menos 32 caracteres.");

export const env = Object.freeze({
  adminUsername: process.env.ADMIN_USERNAME?.trim() || "",
  adminPassword,
  jwtSecret,
  host: process.env.HOST?.trim() || "0.0.0.0",
  port: Number(process.env.PORT || 4170),
  mongoUri: process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017",
  mongoDatabase: process.env.MONGODB_DATABASE?.trim() || "monitor_pm2",
  versionsPath: resolve(
    projectRoot,
    process.env.VERSIONS_DIR?.trim() || "versions",
  ),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_MB || 100) * 1024 * 1024,
  extractedMaxBytes: Number(process.env.EXTRACTED_MAX_MB || 1024) * 1024 * 1024,
  cookieSecure: process.env.COOKIE_SECURE === "true",
  pm2Home: process.env.PM2_HOME?.trim() || undefined,
  pm2Script: process.env.PM2_SCRIPT?.trim() || require.resolve("pm2/bin/pm2"),
});

for (const limit of [env.uploadMaxBytes, env.extractedMaxBytes]) {
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new Error("Os limites de arquivo devem ser números positivos em MB.");
}

if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65_535) {
  throw new Error("PORT deve ser um número entre 1 e 65535.");
}
