import { Router, type Response } from "express";
import { basename, resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { projectBuilds, users } from "../common/database";
import { HttpError } from "../common/http-error";
import { archiveExtension } from "../versions/archive-format";
import {
  createProject,
  getProject,
  listProjects,
  publicProject,
  updateProject,
  deleteProject,
  projectDeletionPreview,
} from "./projects.service";
import { browseProject } from "./project-files";
import { getEnvironmentFile, saveEnvironmentFile } from "./project-environment";
import { projectPath, relativeProjectPath } from "./project-paths";
import {
  createProjectBuild,
  deployProjectBuild,
  getProjectBuild,
  listProjectBuilds,
  uploadProjectBuild,
} from "./project-builds.service";
import { projectBuildFolder } from "./project-storage";
import { isProjectOperationBusy } from "./project-operations";
import { createBuildOperation, getBuildOperation, cancelBuildOperation, runBuildOperation, submitBuildOperation, listBuildOperations, buildEvents, type BuildControl } from "./build-progress";

export const projectRoutes = Router();
export const buildOperationRoutes = Router();
const progressClients = new Set<Response>();
export function closeBuildProgressStreams() {
  for (const response of progressClients) response.end();
}
projectRoutes.post("/:id/build-operations", async (request, response) => {
  const project = await getProject(request.params.id);
  if (project.deployment || isProjectOperationBusy(project._id.toHexString())) throw new HttpError(409, "Já existe uma operação em andamento neste projeto. Aguarde a conclusão.");
  response.status(201).json(createBuildOperation(project._id.toHexString(), response.locals.username, project.name));
});
projectRoutes.post("/:id/build-operations/:operationId/cancel", (request, response) => {
  const op = getBuildOperation(request.params.operationId, request.params.id, response.locals.username);
  cancelBuildOperation(op);
  response.json(op.state);
});
projectRoutes.get("/:id/build-operations/:operationId/stream", (request, response) => {
  const op = getBuildOperation(request.params.operationId, request.params.id, response.locals.username);
  progressStream(response, () => `event: progress\ndata: ${JSON.stringify(op.state)}\n\n`, op.events, "progress");
});
buildOperationRoutes.get("/", (_request, response) => response.json(listBuildOperations(response.locals.username)));
buildOperationRoutes.get("/stream", (_request, response) => {
  progressStream(response, () => `event: publications\ndata: ${JSON.stringify(listBuildOperations(response.locals.username))}\n\n`, buildEvents, "change");
});
function progressStream(response: Response, frame: () => string, events: typeof buildEvents, eventName: string) {
  response.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  response.flushHeaders();
  progressClients.add(response);
  let blocked = false, pending = false, sending = false;
  const send = () => {
    if (response.destroyed || response.writableEnded) return;
    if (blocked || sending) { pending = true; return; }
    sending = true;
    blocked = !response.write(frame());
    sending = false;
    if (!blocked && pending) { pending = false; queueMicrotask(send); }
  };
  const drain = () => { blocked = false; if (pending) { pending = false; send(); } };
  response.on("drain", drain);
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (!(await users.findOne({ username: response.locals.username }, { projection: { _id: 1 } }))) {
        response.write("event: session-expired\ndata: {}\n\n");
        response.end();
      } else { send(); if (!blocked) blocked = !response.write(": heartbeat\n\n"); }
    } catch { response.end(); }
    finally { checking = false; }
  }, 15000);
  const expiry = setTimeout(() => { response.write("event: session-expired\ndata: {}\n\n"); response.end(); }, Math.max(0, response.locals.sessionExpiresAt - Date.now()));
  events.on(eventName, send);
  response.on("close", () => { progressClients.delete(response); clearInterval(heartbeat); clearTimeout(expiry); events.off(eventName, send); response.off("drain", drain); });
  send();
}
projectRoutes.get("/", async (_request, response) =>
  response.json(await listProjects()),
);
projectRoutes.post("/", async (request, response) =>
  response
    .status(201)
    .json(await createProject(request.body, response.locals.username)),
);
projectRoutes.get("/:id", async (request, response) => {
  const project = await getProject(request.params.id);
  response.json(
    publicProject(
      project,
      await projectBuilds.countDocuments({ projectId: project._id }),
    ),
  );
});
projectRoutes.put("/:id", async (request, response) => {
  response.json(
    await updateProject(
      request.params.id,
      request.body,
      response.locals.username,
    ),
  );
});
projectRoutes.delete("/:id", async (request, response) => {
  await deleteProject(request.params.id, request.body);
  response.status(204).end();
});
projectRoutes.get("/:id/deletion-preview", async (request, response) => {
  response.json(await projectDeletionPreview(request.params.id));
});
projectRoutes.get("/:id/files", async (request, response) => {
  const project = await getProject(request.params.id);
  response.json(await browseProject(project.rootPath, request.query.path));
});
projectRoutes.get("/:id/environment-files/:name", async (request, response) => {
  response.json(await getEnvironmentFile(request.params.id, request.params.name));
});
projectRoutes.put("/:id/environment-files/:name", async (request, response) => {
  response.json(await saveEnvironmentFile(request.params.id, request.params.name, request.body));
});
projectRoutes.get("/:id/files/download", async (request, response, next) => {
  const project = await getProject(request.params.id);
  const path = relativeProjectPath(request.query.path);
  const target = await projectPath(project.rootPath, path);
  if (!(await lstat(target)).isFile())
    throw new HttpError(400, "Selecione um arquivo para download.");
  response.download(target, basename(path), (error) => {
    if (error) next(new HttpError(404, "Não foi possível baixar o arquivo."));
  });
});
projectRoutes.get("/:id/builds", async (request, response) => {
  await getProject(request.params.id);
  response.json(await listProjectBuilds(request.params.id, request.query.page));
});
projectRoutes.post(
  "/:id/builds",
  async (request, response, next) => {
    response.locals.project = await getProject(request.params.id);
    if (response.locals.project.deployment || isProjectOperationBusy(String(request.params.id))) throw new HttpError(409, "Já existe uma operação em andamento neste projeto. Aguarde a conclusão.");
    const state = request.query.operationId ? null : createBuildOperation(String(request.params.id), response.locals.username, response.locals.project.name);
    const op = getBuildOperation(request.query.operationId || state?.id, String(request.params.id), response.locals.username);
    submitBuildOperation(op);
    response.locals.operation = op;
    request.once("aborted", () => { if (!op.claimed) cancelBuildOperation(op); });
    next();
  },
  (request, response, next) => uploadProjectBuild(request, response, (error) => {
    if (error) { cancelBuildOperation(response.locals.operation); next(error); }
    else next();
  }),
  async (request, response) => {
    const action = (control?: BuildControl) => createProjectBuild(response.locals.project, request.file, request.body, response.locals.username, control);
    const op = response.locals.operation as ReturnType<typeof getBuildOperation>;
    const task = runBuildOperation(op, action).finally(async () => { if (request.file) await rm(request.file.path, { force: true }); });
    if (request.query.background === "true") {
      void task.catch(() => undefined); // Outcome is retained in the operation and streamed to clients.
      response.status(202).json(op.state);
    } else response.status(201).json(await task);
  },
);
projectRoutes.post("/:id/builds/:buildId/deploy", async (request, response) => {
  const project = await getProject(request.params.id);
  if (project.deployment || isProjectOperationBusy(project._id.toHexString())) throw new HttpError(409, "Já existe uma operação em andamento neste projeto. Aguarde a conclusão.");
  const state = request.query.operationId ? null : createBuildOperation(project._id.toHexString(), response.locals.username, project.name);
  const op = getBuildOperation(request.query.operationId || state?.id, project._id.toHexString(), response.locals.username);
  submitBuildOperation(op);
  const action = (control?: BuildControl) => deployProjectBuild(request.params.id, request.params.buildId, response.locals.username, control);
  const task = runBuildOperation(op, action);
  if (request.query.background === "true") { void task.catch(() => undefined); response.status(202).json(op.state); }
  else response.json(await task);
});
projectRoutes.get(
  "/:id/builds/:buildId/archive",
  async (request, response, next) => {
    const project = await getProject(request.params.id);
    const build = await getProjectBuild(project._id, request.params.buildId);
    if (!build.archiveReady)
      throw new HttpError(
        404,
        "Arquivo original indisponível para este build.",
      );
    const extension = archiveExtension(build.originalName);
    if (!extension)
      throw new HttpError(404, "Formato do arquivo original desconhecido.");
    response.download(
      resolve(projectBuildFolder(project._id, build._id), `build${extension}`),
      `${build.name}${extension}`,
      (error) => {
        if (error) next(new HttpError(404, "Arquivo original não encontrado."));
      },
    );
  },
);
