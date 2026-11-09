import compression from "compression";
import express, { type ErrorRequestHandler } from "express";
import { mkdir } from "node:fs/promises";
import { MulterError } from "multer";
import { MongoError, type Filter } from "mongodb";
import { resolve, sep } from "node:path";
import {
  authenticate,
  requireAdmin,
  createSession,
  sessionCookie,
  validateLogin,
} from "./auth/auth.service";
import { env } from "./common/config";
import { HttpError } from "./common/http-error";
import {
  getRetentionSettings,
  saveRetentionSettings,
} from "./settings/settings.service";
import { startRetentionScheduler } from "./settings/retention.service";
import {
  connectDatabase,
  logs,
  mongo,
  publicUser,
  users,
  versions,
  type LogRecord,
} from "./common/database";
import { bootstrapUser, createUser, updateUserRole } from "./auth/users.service";
import { withManualProcessAction } from "./projects/build-progress";
import {
  saveBuild,
  startVersion,
  uploadBuild,
  versionFolder,
  versionId,
} from "./versions/versions.service";
import { archiveExtension } from "./versions/archive-format";
import { projectRoutes, buildOperationRoutes, closeBuildProgressStreams } from "./projects/projects.routes";
import {
  listProjectBuilds,
  recoverProjectBuilds,
} from "./projects/project-builds.service";
import { startLogCollector } from "./logs/logs.service";
import { createProcessStream } from "./pm2/process-stream";
import {
  listProcesses,
  setProcessLabel,
  setProcessProject,
  processAction,
  processLogs,
  pickEcosystem,
  startEcosystem,
  type ProcessAction,
} from "./pm2/pm2.service";

export const app = express();
const processStream = createProcessStream(listProcesses);
const pendingAudit = new Set<Promise<unknown>>();
export async function flushAudit() {
  await Promise.allSettled([...pendingAudit]);
}
const frontendPath = resolve(__dirname, "..", "..", "frontend", "dist");
const actions = new Set<ProcessAction>(["start", "restart", "stop", "delete"]);

app.disable("x-powered-by");
app.use(
  compression({
    filter: (request, response) =>
      !request.path.endsWith("/stream") &&
      compression.filter(request, response),
  }),
);
app.use((_request, response, next) => {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use("/api", (request, response, next) => {
  const path = request.path;
  response.set("Cache-Control", "no-store");
  response.once("finish", () => {
    if (
      [
        "/health",
        "/auth/me",
        "/processes",
        "/processes/stream",
        "/logs",
        "/versions",
        "/users",
      ].includes(path) &&
      request.method === "GET"
    )
      return;
    const entry = logs
      .insertOne({
        kind: "audit",
        createdAt: new Date(),
        username: response.locals.username,
        ip: request.ip || request.socket.remoteAddress,
        method: request.method,
        path: `/api${path}`,
        status: response.statusCode,
      })
      .catch((error) => console.error("Falha ao salvar auditoria:", error))
      .finally(() => pendingAudit.delete(entry));
    pendingAudit.add(entry);
  });
  next();
});
app.use("/api", express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) =>
  response.json({ status: "ok", timestamp: new Date().toISOString() }),
);
app.get("/api/settings/retention", authenticate, async (_request, response) =>
  response.json(await getRetentionSettings()),
);
app.put("/api/settings/retention", authenticate, async (request, response) =>
  response.json(
    await saveRetentionSettings(request.body, response.locals.username),
  ),
);
app.post("/api/auth/login", async (request, response) => {
  const username = await validateLogin(
    request.ip || request.socket.remoteAddress || "unknown",
    request.body?.username,
    request.body?.password,
  );
  response.locals.username = username;
  response
    .cookie("pm2_session", createSession(username), sessionCookie)
    .json({ username });
});
app.post("/api/auth/logout", authenticate, (_request, response) => {
  response.clearCookie("pm2_session", { path: "/" }).status(204).end();
});
app.get("/api/auth/me", authenticate, (_request, response) =>
  response.json({
    authenticated: true,
    username: response.locals.username,
    role: response.locals.role,
  }),
);

app.use("/api/projects", authenticate, projectRoutes);
app.use("/api/build-operations", authenticate, buildOperationRoutes);
app.get("/api/builds", authenticate, async (request, response) =>
  response.json(
    await listProjectBuilds(request.query.projectId, request.query.page),
  ),
);

app.get(
  "/api/users",
  authenticate,
  requireAdmin,
  async (_request, response) => {
    response.json(
      (
        await users
          .find({}, { projection: { passwordHash: 0 } })
          .sort({ username: 1 })
          .toArray()
      ).map(publicUser),
    );
  },
);
app.post(
  "/api/users",
  authenticate,
  requireAdmin,
  async (request, response) => {
    response
      .status(201)
      .json(
        await createUser(
          request.body?.username,
          request.body?.password,
          request.body?.role,
        ),
      );
  },
);
app.put("/api/users/:id/role", authenticate, requireAdmin, async (request, response) => {
  response.json(await updateUserRole(request.params.id, request.body?.role, response.locals.username));
});
app.get("/api/logs", authenticate, async (request, response) => {
  const filter: Filter<LogRecord> = {};
  if (request.query.kind !== undefined) {
    if (!["audit", "process"].includes(String(request.query.kind)))
      throw new HttpError(400, "Tipo de log inválido.");
    filter.kind = request.query.kind as "audit" | "process";
  }
  if (request.query.processId !== undefined)
    filter.processId = parseId(String(request.query.processId));
  const limit = Number(request.query.limit ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new HttpError(400, "Limite de logs deve estar entre 1 e 500.");
  response.json(
    await logs
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray(),
  );
});
app.get("/api/versions", authenticate, async (_request, response) => {
  response.json(
    await versions.find({}).sort({ createdAt: -1 }).limit(200).toArray(),
  );
});
app.post(
  "/api/versions",
  authenticate,
  uploadBuild,
  async (request, response) => {
    response
      .status(201)
      .json(
        await saveBuild(request.file, request.body, response.locals.username),
      );
  },
);
app.get(
  "/api/versions/:id/archive",
  authenticate,
  async (request, response, next) => {
    const id = versionId(request.params.id);
    const version = await versions.findOne({ _id: id });
    if (!version || version.status === "processing")
      throw new HttpError(404, "Arquivo da versão não disponível.");
    const extension = archiveExtension(version.originalName) ?? ".rar";
    response.download(
      resolve(versionFolder(id), `build${extension}`),
      `${version.project}-${version.version}${extension}`,
      (error) => {
        if (error)
          next(new HttpError(404, "Arquivo da versão não encontrado."));
      },
    );
  },
);
app.post("/api/versions/:id/start", authenticate, async (request, response) => {
  await startVersion(versionId(request.params.id));
  response.status(204).end();
});

app.get("/api/processes", authenticate, async (_request, response) =>
  response.json(await listProcesses()),
);
app.put("/api/processes/:id/project", authenticate, async (request, response) => {
  response.json(await withManualProcessAction(() => setProcessProject(parseId(request.params.id), request.body, response.locals.username)));
});
app.put("/api/processes/:id/label", authenticate, async (request, response) => {
  response.json(
    await withManualProcessAction(() => setProcessLabel(
      parseId(request.params.id),
      request.body,
      response.locals.username,
    )),
  );
});
app.get("/api/processes/stream", authenticate, (_request, response) => {
  processStream.subscribe(
    response,
    response.locals.sessionExpiresAt,
    async () =>
      Boolean(
        await users.findOne(
          { username: response.locals.username },
          { projection: { _id: 1 } },
        ),
      ),
  );
});
app.post("/api/ecosystems/pick", authenticate, async (_request, response) => {
  response.json({ path: await pickEcosystem() });
});
app.post("/api/ecosystems", authenticate, async (request, response) => {
  await withManualProcessAction(() => startEcosystem(request.body?.path));
  response.status(204).end();
});
app.get("/api/processes/:id/logs", authenticate, async (request, response) => {
  response.json({
    logs: await processLogs(
      parseId(request.params.id),
      Number(request.query.lines ?? 100),
    ),
  });
});
app.post(
  "/api/processes/:id/:action",
  authenticate,
  async (request, response) => {
    const action = request.params.action as ProcessAction;
    if (!actions.has(action)) throw new HttpError(400, "Ação inválida.");
    await withManualProcessAction(() => processAction(parseId(request.params.id), action, request.body));
    response.status(204).end();
  },
);

app.use("/api", (_request, _response, next) =>
  next(new HttpError(404, "Rota não encontrada.")),
);
app.use(
  express.static(frontendPath, {
    etag: true,
    index: "index.html",
    setHeaders: (response, filePath) => {
      response.setHeader(
        "Cache-Control",
        filePath.includes(`${sep}assets${sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  }),
);
app.use((_request, response) =>
  response.sendFile(resolve(frontendPath, "index.html")),
);

const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (response.headersSent) return;
  if (error instanceof HttpError)
    return void response.status(error.status).json({ message: error.message });
  if (error instanceof MulterError)
    return void response
      .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
      .json({
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? `O arquivo compactado excede o limite de ${env.uploadMaxBytes / 1024 / 1024} MB.`
            : "Envio inválido. Informe projeto, versão e um único arquivo no campo build.",
      });
  if (error instanceof SyntaxError && "body" in error)
    return void response.status(400).json({ message: "JSON inválido." });
  if (error?.type === "entity.too.large")
    return void response
      .status(413)
      .json({ message: "Corpo da requisição muito grande." });
  console.error(error);
  if (error instanceof MongoError)
    return void response
      .status(503)
      .json({ message: "Não foi possível acessar o MongoDB." });
  response.status(500).json({ message: "Erro interno do servidor." });
};
app.use(errorHandler);

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0)
    throw new HttpError(400, "ID de processo inválido.");
  return id;
}

export async function initialize() {
  await connectDatabase();
  await bootstrapUser();
  await mkdir(resolve(env.versionsPath, ".uploads"), { recursive: true });
  await recoverProjectBuilds();
}

async function start() {
  await initialize();
  const server = app.listen(env.port, env.host, () => {
    console.log(`ati-dev-cockpit disponível em http://${env.host}:${env.port}`);
  });
  server.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  const stopCollector = startLogCollector();
  const stopRetention = startRetentionScheduler();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      processStream.close();
      closeBuildProgressStreams();
      server.close(async () => {
        await stopCollector();
        await stopRetention();
        await flushAudit();
        await mongo.close();
        process.exit(0);
      });
    });
  }
}

if (require.main === module)
  start().catch(async (error: unknown) => {
    console.error("Não foi possível iniciar o monitor:", error);
    await mongo.close();
    process.exit(1);
  });
