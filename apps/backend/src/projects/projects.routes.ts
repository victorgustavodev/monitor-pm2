import { Router } from "express";
import { basename, resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { projectBuilds } from "../common/database";
import { HttpError } from "../common/http-error";
import { archiveExtension } from "../versions/archive-format";
import {
  createProject,
  getProject,
  listProjects,
  publicProject,
} from "./projects.service";
import { browseProject } from "./project-files";
import { projectPath, relativeProjectPath } from "./project-paths";
import {
  createProjectBuild,
  deployProjectBuild,
  getProjectBuild,
  listProjectBuilds,
  uploadProjectBuild,
} from "./project-builds.service";
import { projectBuildFolder } from "./project-storage";

export const projectRoutes = Router();
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
projectRoutes.get("/:id/files", async (request, response) => {
  const project = await getProject(request.params.id);
  response.json(await browseProject(project.rootPath, request.query.path));
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
    next();
  },
  uploadProjectBuild,
  async (request, response) => {
    response
      .status(201)
      .json(
        await createProjectBuild(
          response.locals.project,
          request.file,
          request.body,
          response.locals.username,
        ),
      );
  },
);
projectRoutes.post("/:id/builds/:buildId/deploy", async (request, response) => {
  response.json(
    await deployProjectBuild(
      request.params.id,
      request.params.buildId,
      response.locals.username,
    ),
  );
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
