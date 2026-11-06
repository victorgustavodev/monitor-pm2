import { rm } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { env } from "../common/config";
import {
  logs,
  projects,
  projectBuilds,
  retentionSettings,
  versions,
} from "../common/database";
import { tryArtifactCleanup } from "../common/artifact-access";
import { assertNoLinks, containsPath } from "../projects/project-paths";
import { projectBuildFolder } from "../projects/project-storage";
import { versionFolder } from "../versions/versions.service";
import { processArtifactPaths } from "../pm2/pm2.service";
import { getRetentionSettings } from "./settings.service";

async function removeArtifact(folder: string) {
  const root = resolve(env.versionsPath);
  const target = resolve(folder);
  const child = relative(root, target);
  if (!child || isAbsolute(child) || !containsPath(root, target))
    throw new Error("Destino de limpeza fora de versions.");
  await assertNoLinks(target, true);
  await rm(target, { recursive: true, force: true });
}

export async function runRetention(now = new Date()) {
  let settings = await getRetentionSettings();
  if (!settings.enabled || !settings.nextRunAt || settings.nextRunAt > now)
    return false;
  return tryArtifactCleanup(async () => {
    settings = await getRetentionSettings();
    if (!settings.enabled || !settings.nextRunAt || settings.nextRunAt > now) return;
    let deleted = 0;
    let error: string | undefined;
    try {
      // Fail closed: even stopped processes may restart using an archived folder.
      const paths = await processArtifactPaths();
      const inUse = (folder: string) =>
        paths.some((path) => containsPath(folder, path));
      const cutoff = new Date(
        now.getTime() - settings.retentionDays * 86400000,
      );
      const oldVersions = await versions
        .find({
          createdAt: { $lt: cutoff },
          status: { $nin: ["processing", "starting"] },
        })
        .toArray();
      for (const version of oldVersions) {
        const folder = versionFolder(version._id);
        if (inUse(folder)) continue;
        const claimed = await versions.updateOne(
          { _id: version._id, status: version.status },
          { $set: { status: "deleting" } },
        );
        if (!claimed.modifiedCount && version.status !== "deleting") continue;
        await removeArtifact(folder);
        await versions.deleteOne({ _id: version._id, status: "deleting" });
        deleted++;
      }
      const oldBuilds = await projectBuilds
        .find({
          createdAt: { $lt: cutoff },
          status: { $nin: ["processing", "deploying"] },
        })
        .toArray();
      for (const build of oldBuilds) {
        const project = await projects.findOne({ _id: build.projectId });
        // Preserve manifests for active builds and journals required for recovery.
        if (
          !project ||
          project.deployment ||
          project.activeBuildId?.equals(build._id)
        )
          continue;
        const folder = projectBuildFolder(build.projectId, build._id);
        if (inUse(folder)) continue;
        const claimed = await projectBuilds.updateOne(
          { _id: build._id, status: build.status },
          {
            $set: { status: "deleting", archiveReady: false, extracted: false },
          },
        );
        if (!claimed.modifiedCount && build.status !== "deleting") continue;
        await removeArtifact(folder);
        await projectBuilds.deleteOne({ _id: build._id, status: "deleting" });
        deleted++;
      }
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message
          : "Falha na limpeza de versões.";
    }
    await retentionSettings.updateOne(
      { _id: "retention" },
      {
        $set: {
          lastRunAt: now,
          lastDeleted: deleted,
          ...(error ? { lastError: error } : {}),
        },
        ...(!error ? { $unset: { lastError: "" } } : {}),
      },
    );
    await logs.insertOne({
      kind: "audit",
      createdAt: now,
      username: "system",
      method: "RETENTION",
      path: "/api/settings/retention",
      status: error ? 500 : 200,
      content: `deleted=${deleted}${error ? `; ${error}` : ""}`,
    });
  });
}

export function startRetentionScheduler() {
  let pending: Promise<unknown> | undefined;
  const tick = () => {
    if (!pending)
      pending = runRetention()
        .catch((error) => console.error("Falha na limpeza automática:", error))
        .finally(() => {
          pending = undefined;
        });
  };
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
  };
}
