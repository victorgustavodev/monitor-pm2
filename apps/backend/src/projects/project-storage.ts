import { resolve } from "node:path";
import type { ObjectId } from "mongodb";
import { env } from "../common/config";
import { HttpError } from "../common/http-error";

export function projectBuildFolder(projectId: ObjectId, buildId: ObjectId) {
  return resolve(
    env.versionsPath,
    "projects",
    projectId.toHexString(),
    buildId.toHexString(),
  );
}

export function deploymentFolder(
  projectId: ObjectId,
  buildId: ObjectId,
  attemptId: string,
) {
  if (!/^[0-9a-f-]{36}$/.test(attemptId))
    throw new HttpError(400, "Identificador de publicação inválido.");
  return resolve(
    projectBuildFolder(projectId, buildId),
    "deployments",
    attemptId,
  );
}
