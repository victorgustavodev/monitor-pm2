import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { act, createElement } from "react";

let vite, dom, root, App;
let failProcesses = false;
let deferProcesses = false, pendingProcessLoad, pendingLocalStart;
let deferLogs = false;
const pendingLogs = new Map();
let sessionRole = "admin";
let pendingUser;
let pendingAction;
let pendingLink, failLink = false, failProjectChoices = false;
let pendingLabel,
  labelSaveCount = 0;
let pendingProjectBuild;
let pendingPublication;
let pendingRole, roleSaveFails = false;
let publicationRows = [], operationNumber = 0;
const publicationStreams = [];
function broadcastPublications(rows) {
  publicationRows = rows;
  for (const stream of publicationStreams) if (stream.readyState !== 2) stream.emit("publications", rows);
}
function finishPublication(id, status, logs = []) {
  broadcastPublications(publicationRows.map(row => row.id === id ? { ...row, status, cancellable: false, canCancel: false,
    percent: status === "succeeded" ? 100 : row.percent, stage: status === "succeeded" ? "Build publicado" : status === "cancelled" ? "Publicação cancelada" : "Falha ao publicar o build", logs } : row));
}
let pendingSettings;
let pendingProcessSettings, processSettingsFail = false, processSettingsReadFail = false, canAutoStart = true;
let pendingProjectUpdate, pendingProjectDelete;
let localEcosystem = null, ecosystemReadError = 0;
let pendingEnvironmentSave, environmentConflict = false;
const environmentFiles = new Map();
let retention = {
  enabled: false,
  retentionDays: 30,
};
const projectRows = [
  {
    _id: "111111111111111111111111",
    name: "Projeto X",
    description: "Aplicação principal",
    rootPath: "C:\\servicos\\project-name",
    pm2ConfigPath: "ecosystem.config.js",
    pathToRunPm2: "C:\\servicos\\project-name\\ecosystem.config.js",
    createdBy: "tester",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    nextBuildNumber: 0,
    buildCount: 0,
    deploying: false,
  },
];
const buildRows = [];
const requests = [];
const streams = [];
const logStreams = [];
const buildStreams = [];
const intervals = [];
const processes = [
  {
    id: 1,
    name: "api-service",
    status: "online",
    pid: 100,
    cpu: 1,
    memory: 100 * 1024 * 1024,
    uptime: Date.now(),
    restarts: 0,
    mode: "fork",
    version: "1.0",
    ports: [3000],
    portSource: "listening",
  },
  {
    id: 2,
    name: "web-service",
    status: "stopped",
    pid: 0,
    cpu: 0,
    memory: 0,
    uptime: null,
    restarts: 1,
    mode: "fork",
    version: "1.0",
    ports: [5500],
    portSource: "configured",
  },
];
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

before(
  async () => {
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost:4170" });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      HTMLElement: dom.window.HTMLElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      FormData: dom.window.FormData,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: dom.window.navigator,
    });
    globalThis.EventSource = class extends dom.window.EventTarget {
      static CLOSED = 2;
      readyState = 1;
      constructor(url) {
        super();
        if (url === "/api/build-operations/stream") { publicationStreams.push(this); queueMicrotask(() => this.emit("publications", publicationRows)); }
        else if (url.startsWith("/api/logs/stream?")) {
          logStreams.push(this);
          this.url = url;
          const name = new URL(url, "http://localhost").searchParams.get("processName");
          const emit = () => this.emit("snapshot", { content: `Log de teste\n\x1b[32m[Nest] ${name}\x1b[0m <script>literal</script>\n` });
          if (deferLogs) pendingLogs.set(name, emit);
          else queueMicrotask(emit);
        }
        else if (url.includes("/build-operations/")) buildStreams.push(this);
        else { assert.equal(url, "/api/processes/stream"); streams.push(this); }
      }
      close() {
        this.readyState = 2;
      }
      emit(type, data) {
        this.dispatchEvent(
          new dom.window.MessageEvent(type, { data: JSON.stringify(data) }),
        );
      }
    };
    const originalInterval = dom.window.setInterval.bind(dom.window);
    dom.window.setInterval = (callback, delay, ...args) => {
      intervals.push(delay);
      return originalInterval(callback, delay, ...args);
    };
    dom.window.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    dom.window.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    globalThis.fetch = async (url, options = {}) => {
      requests.push({
        url: String(url),
        method: options.method || "GET",
        body: options.body,
      });
      const operationId = new URL(String(url), "http://localhost").searchParams.get("operationId");
      url = String(url).replace(/\?operationId=.*$/, "");
      if (url.endsWith("/build-operations") && options.method === "POST") {
        const projectId = url.split("/")[3];
        const row = { id: `operation-${++operationNumber}`, projectId, projectName: projectRows.find(project => project._id === projectId)?.name || "Projeto", username: "tester", canCancel: true, percent: 0, stage: "Enviando pacote", status: "running", cancellable: true, logs: [] };
        broadcastPublications([...publicationRows, row]);
        return json(row, 201);
      }
      if (/\/build-operations\/[^/]+\/cancel$/.test(url)) {
        const id = url.split("/").at(-2);
        broadcastPublications(publicationRows.map(row => row.id === id ? { ...row, stage: "Cancelando publicação", cancellable: false, canCancel: false } : row));
        return json(publicationRows.find(row => row.id === id));
      }
      if (/\/builds\/[^/]+\/deploy$/.test(url) && options.method === "POST") {
        pendingPublication = (status, message) => finishPublication(operationId, status === 409 ? "cancelled" : status >= 400 ? "failed" : "succeeded", message ? [message] : []);
        return json(publicationRows.find(row => row.id === operationId), 202);
      }
      if (url === "/api/auth/me")
        return json({
          username: "tester",
          authenticated: true,
          role: sessionRole,
        });
      if (url === "/api/processes" && deferProcesses)
        return new Promise(done => { pendingProcessLoad = () => done(json(processes)); });
      if (/^\/api\/projects\/[^/]+\/start$/.test(url) && options.method === "POST")
        return new Promise(done => { pendingLocalStart = () => done(json({ message: "started" })); });
      if (url === "/api/processes")
        return failProcesses
          ? json({ message: "PM2 indisponível." }, 502)
          : json(processes);
      if (String(url).startsWith("/api/processes/1/settings")) {
        if (options.method === "PUT") return new Promise(done => {
          pendingProcessSettings = () => {
            if (processSettingsFail) return done(json({ message: "Falha ao salvar configuração." }, 409));
            const data = JSON.parse(options.body);
            Object.assign(processes[0], { autoStart: data.autoStart, autoStartUpdatedAt: new Date().toISOString(), autoStartError: "" });
            done(json({ name: processes[0].name, namespace: "default", canAutoStart, projectId: projectRows[0]._id,
              autoStart: processes[0].autoStart, autoStartUpdatedAt: processes[0].autoStartUpdatedAt, autoStartError: "" }));
          };
        });
        if (processSettingsReadFail) return json({ message: "Falha ao carregar configuração." }, 502);
        return json({ name: processes[0].name, namespace: "default", canAutoStart, projectId: canAutoStart ? projectRows[0]._id : null,
          autoStart: processes[0].autoStart || false, autoStartUpdatedAt: processes[0].autoStartUpdatedAt || null, autoStartError: "" });
      }
      if (url === "/api/processes/1/project" && options.method === "PUT")
        return new Promise(done => {
          pendingLink = () => {
            if (failLink) return done(json({ message: "Falha ao vincular." }, 409));
            const data = JSON.parse(options.body);
            const saved = { name: data.name, namespace: data.namespace, projectId: data.projectId,
              projectName: projectRows.find(row => row._id === data.projectId)?.name || null,
              projectUpdatedAt: new Date(Date.now() + ++labelSaveCount).toISOString() };
            Object.assign(processes[0], saved);
            done(json(saved));
          };
        });
      if (url === "/api/processes/1/label" && options.method === "PUT")
        return new Promise((done) => {
          pendingLabel = () => {
            const data = JSON.parse(options.body);
            const saved = {
              name: data.name,
              namespace: data.namespace,
              label: data.label.trim(),
              labelUpdatedAt: new Date(
                Date.now() + ++labelSaveCount,
              ).toISOString(),
            };
            Object.assign(processes[0], {
              label: saved.label,
              labelUpdatedAt: saved.labelUpdatedAt,
            });
            done(json(saved));
          };
        });
      if (/^\/api\/processes\/1\/(restart|stop|delete)$/.test(url) && options.method === "POST")
        return new Promise((resolve) => {
          pendingAction = () => resolve(new Response(null, { status: 204 }));
        });
      if (String(url).startsWith("/api/processes/1/logs?"))
        return json({ logs: "Log de teste da aplicação." });
      if (url === "/api/users" && options.method === "POST")
        return new Promise((resolve) => {
          pendingUser = () =>
            resolve(json({ id: "new-user", username: "operador" }, 201));
        });
      if (url === "/api/users")
        return json([
          {
            id: "tester",
            username: "tester",
            role: sessionRole,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]);
      if (/\/api\/users\/[^/]+\/role$/.test(url)) return new Promise(done => {
        pendingRole = () => done(roleSaveFails ? json({ message: "Não é possível alterar este perfil." }, 409)
          : json({ id: "tester", username: "tester", role: JSON.parse(options.body).role, createdAt: "2026-01-01T00:00:00Z" }));
      });
      if (url === "/api/versions") return json([]);
      if (url === "/api/settings/retention" && options.method === "PUT")
        return new Promise((done) => {
          pendingSettings = () => {
            retention = {
              ...retention,
              ...JSON.parse(options.body),
            };
            done(json(retention));
          };
        });
      if (url === "/api/settings/retention") return json(retention);
      if (url === "/api/projects" && options.method === "POST") {
        const data = JSON.parse(options.body);
        const project = {
          ...projectRows[0],
          ...data,
          _id: "222222222222222222222222",
          pathToRunPm2: `${data.rootPath}\\${data.pm2ConfigPath}`,
        };
        projectRows.push(project);
        return json(project, 201);
      }
      if (url === "/api/projects") return failProjectChoices ? json({ message: "Falha ao carregar projetos." }, 502) : json(projectRows);
      if (String(url).endsWith("/deletion-preview"))
        return json({
          processes: [{ id: 1, name: "api-service", status: "online" }],
          revision: "process-revision",
        });
      if (url.includes("/environment-files/")) {
        const name = decodeURIComponent(url.split("/").at(-1));
        if (options.method === "PUT") return new Promise(done => {
          pendingEnvironmentSave = () => {
            if (environmentConflict) return done(json({ message: "O arquivo foi alterado desde a abertura." }, 409));
            const data = JSON.parse(options.body);
            environmentFiles.set(name, { name, content: data.content, revision: "a".repeat(64) });
            done(json(environmentFiles.get(name)));
          };
        });
        return json({ ...(environmentFiles.get(name) || { name, content: "", revision: null }), names: [...environmentFiles.keys()] });
      }
      if (
        /^\/api\/projects\/[a-f0-9]+$/.test(String(url)) &&
        options.method === "PUT"
      )
        return new Promise((done) => {
          pendingProjectUpdate = () => {
            const project = projectRows.find(
              (row) => row._id === String(url).split("/")[3],
            );
            const fields = JSON.parse(options.body);
            Object.assign(project, fields, {
              updatedAt: "2026-11-06T18:00:00Z",
              pathToRunPm2: `${fields.rootPath}\\${fields.pm2ConfigPath}`,
            });
            done(json(project));
          };
        });
      if (
        /^\/api\/projects\/[a-f0-9]+$/.test(String(url)) &&
        options.method === "DELETE"
      )
        return new Promise((done) => {
          pendingProjectDelete = () => {
            const id = String(url).split("/")[3];
            projectRows.splice(
              projectRows.findIndex((row) => row._id === id),
              1,
            );
            for (let i = buildRows.length - 1; i >= 0; i--)
              if (buildRows[i].projectId === id) buildRows.splice(i, 1);
            done(new Response(null, { status: 204 }));
          };
        });
      if (String(url).includes("/files?path=")) {
        const path = new URL(String(url), "http://localhost").searchParams.get(
          "path",
        );
        if (path?.endsWith("ecosystem.config.js")) {
          if (ecosystemReadError) return json({ message: "Falha ao ler configuração." }, ecosystemReadError);
          return localEcosystem === null ? json({ message: "Arquivo não encontrado." }, 404)
            : json({ type: "file", path, size: localEcosystem.length, modifiedAt: "2026-01-01T00:00:00Z", binary: false, truncated: false, content: localEcosystem });
        }
        if (path === "docs/README.md")
          return json({
            type: "file",
            path,
            size: 50,
            modifiedAt: "2026-01-01T00:00:00Z",
            binary: false,
            truncated: false,
            content: "# Projeto X\n<script>texto, sem execução</script>",
          });
        return json({
          type: "directory",
          path,
          truncated: false,
          entries:
            path === "docs"
              ? [
                  {
                    name: "README.md",
                    path: "docs/README.md",
                    type: "file",
                    size: 50,
                    modifiedAt: "2026-01-01T00:00:00Z",
                  },
                ]
              : [
                  {
                    name: "docs",
                    path: "docs",
                    type: "directory",
                    size: 0,
                    modifiedAt: "2026-01-01T00:00:00Z",
                  },
                ],
        });
      }
      if (
        /\/api\/projects\/[^/]+\/builds$/.test(String(url)) &&
        options.method === "POST"
      )
        return new Promise((done) => {
          pendingProjectBuild = () => {
            const projectId = String(url).split("/")[3];
            const project = projectRows.find((item) => item._id === projectId);
            const build = {
              _id: "333333333333333333333333",
              projectId,
              projectName: project.name,
              name: options.body.get("name"),
              comments: options.body.get("comments"),
              number: 1,
              createdBy: "tester",
              createdAt: "2026-11-06T12:00:00Z",
              deployedAt: "2026-11-06T12:00:01Z",
              deployedBy: "tester",
              originalName: "release.zip",
              size: 1234,
              status: "deployed",
              extracted: true,
              archiveReady: true,
              active: true,
            };
            buildRows.unshift(build);
            project.buildCount++;
            project.nextBuildNumber++;
            project.activeBuildId = build._id;
            finishPublication(operationId, "succeeded");
            done(json(build, 202));
          };
        });
      if (
        String(url).startsWith("/api/builds?") ||
        /\/api\/projects\/[^/]+\/builds\?/.test(String(url))
      ) {
        const id = String(url).startsWith("/api/projects/")
          ? String(url).split("/")[3]
          : null;
        const items = buildRows.filter(
          (build) => !id || build.projectId === id,
        );
        return json({ items, total: items.length, page: 1, pageSize: 20 });
      }
      if (url === "/api/logs/applications") return json([{ name: "archived-app" }]);
      if (String(url).startsWith("/api/logs?") && new URL(url, "http://localhost").searchParams.get("kind") === "process") {
        const name = new URL(url, "http://localhost").searchParams.get("processName");
        const result = [{ _id: name, kind: "process", createdAt: "2026-01-01T00:00:00Z", processName: name, processId: 1, content: `\x1b[32m[Nest] ${name}\x1b[0m <script>literal</script>` }];
        if (deferLogs) return new Promise(done => pendingLogs.set(name, () => done(json(result))));
        return json(result);
      }
      if (String(url).startsWith("/api/logs?"))
        return json([
          {
            _id: "audit",
            kind: "audit",
            createdAt: "2026-01-01T00:00:00Z",
            username: "tester",
            method: "POST",
            path: "/api/auth/login",
            status: 200,
          },
        ]);
      throw new Error(`Unexpected API request: ${url}`);
    };
    vite = await createServer({
      configLoader: "runner",
      server: { middlewareMode: true, watch: null },
      appType: "custom",
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    ({ App } = await vite.ssrLoadModule("/src/app/App.tsx"));
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root"));
    await act(async () => {
      root.render(createElement(App));
    });
  },
  { timeout: 30000 },
);

after(async () => {
  if (root) await act(async () => root.unmount());
  await vite?.close();
  dom?.window.close();
});

function navigation(label) {
  return [...document.querySelectorAll("nav.sidebar-nav button")].find(
    (button) => !button.closest("[inert]") && button.querySelector("span")?.textContent === label,
  );
}

test("SSE applies metric updates and PM2 recovery without polling, and detects connection loss", async () => {
  const page = document.querySelector("main");
  const search = document.querySelector('[aria-label="Buscar processo"]');
  search.focus();
  assert.equal(streams.length, 1);
  assert.ok(!intervals.includes(10_000));
  const requestCount = requests.filter(
    (request) => request.url === "/api/processes",
  ).length;
  const stream = streams.at(-1);
  const updated = processes.map((process) => ({ ...process, cpu: 25 }));
  await act(async () => stream.emit("processes", updated));
  assert.match(
    document.querySelector(".overview-metrics").textContent,
    /50.0%/,
  );
  await act(async () =>
    stream.emit("metrics-error", { message: "PM2 indisponível." }),
  );
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /PM2 indisponível/,
  );
  assert.match(
    document.querySelector(".overview-metrics").textContent,
    /Indisponível/,
  );
  await act(async () => stream.emit("processes", processes));
  assert.equal(document.querySelector('[role="alert"]'), null);
  await act(async () => stream.onerror());
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /Tentando reconectar/,
  );
  await act(async () => stream.emit("processes", processes));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(
    requests.filter((request) => request.url === "/api/processes").length,
    requestCount,
  );
  assert.equal(document.querySelector("main"), page);
  assert.equal(document.activeElement, search);
});
async function go(label) {
  const originalLabel = label;
  if (["Configurações", "Settings", "Configuración", "Logs", "Usuários"].includes(label)) {
    const toggle = document.querySelector('[aria-controls="sidebar-settings-menu"]');
    if (toggle.getAttribute("aria-expanded") !== "true") await act(async () => toggle.click());
    if (["Configurações", "Settings", "Configuración"].includes(label))
      label = document.documentElement.lang === "pt-BR" ? "Geral" : "General";
  }
  const button = navigation(label);
  assert.ok(button, label);
  await act(async () => button.click());
  assert.equal(navigation(label).getAttribute("aria-current"), "page");
  assert.ok(document.querySelector("main h1").classList.contains("sr-only"), "Screen names remain accessible without a visible page title");
  assert.equal(document.querySelector(".page-eyebrow, .page-description"), null);
  const homeGreeting = {
    "pt-BR": "Olá, tester",
    en: "Hello, tester",
    es: "Hola, tester",
  };
  assert.equal(
    document.querySelector("h1").textContent,
    ["Home", "Inicio"].includes(label)
      ? homeGreeting[document.documentElement.lang]
      : originalLabel,
  );
}

test("sidebar expands settings destinations and Home combines metrics with all process controls", async () => {
  assert.equal([...document.querySelectorAll("nav button")].filter(button => !button.closest("[inert]")).length, 3);
  assert.equal(navigation("Usuários"), undefined);
  assert.equal(document.querySelector("h1").textContent, "Olá, tester");
  const settingsToggle = document.querySelector('[aria-controls="sidebar-settings-menu"]');
  const submenu = document.getElementById("sidebar-settings-menu");
  assert.equal(submenu.getAttribute("aria-hidden"), "true");
  assert.ok(submenu.hasAttribute("inert"));
  await act(async () => settingsToggle.click());
  assert.equal(settingsToggle.getAttribute("aria-expanded"), "true");
  assert.equal(submenu.getAttribute("aria-hidden"), "false");
  assert.equal(submenu.hasAttribute("inert"), false);
  assert.ok(navigation("Logs"));
  assert.ok(navigation("Usuários"));
  assert.equal(document.querySelector("h1").textContent, "Olá, tester");
  await act(async () => settingsToggle.click());
  assert.equal(document.getElementById("sidebar-settings-menu"), submenu);
  assert.equal(submenu.getAttribute("aria-hidden"), "true");
  assert.ok(submenu.hasAttribute("inert"));
  assert.equal(navigation("Logs"), undefined);
  assert.ok(document.querySelector('.sidebar-logo[alt="KPMG"]'));
  assert.match(
    document.querySelector(".sidebar-account").textContent,
    /tester/,
  );
  assert.equal(document.querySelectorAll(".metric-card").length, 4);
  assert.match(document.querySelector(".overview-metrics").textContent, /1\/2/);
  assert.match(
    document.querySelector(".applications").textContent,
    /api-service/,
  );
  assert.match(
    document.querySelector(".applications").textContent,
    /5500.*Configurada/,
  );
  await go("Home");
  assert.ok(
    [...document.querySelectorAll("th")].some(
      (cell) => cell.textContent === "Porta",
    ),
  );
  assert.match(document.querySelector("tbody").textContent, /3000/);
  assert.ok(document.querySelector('[title="Reiniciar"]'));
  await go("Logs");
  assert.match(document.querySelector("main").textContent, /Selecione uma aplicação para exibir os logs/);
  await act(async () => {
    const select = document.querySelector("#management-panel select");
    select.value = "audit";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  assert.match(
    document.querySelector("main").textContent,
    /POST \/api\/auth\/login/,
  );
  await go("Usuários");
  assert.ok(document.querySelector('input[name="username"]'));
  assert.equal(navigation("Builds"), undefined);
  assert.equal(document.querySelector('[aria-label="Histórico de builds"]'), null);
  assert.ok(!requests.some(request => request.url === "/api/versions"));
  await go("Configurações");
  assert.match(
    document.querySelector("main").textContent,
    /http:\/\/localhost:4170/,
  );
  const autoRefresh = document.querySelector('input[type="checkbox"]');
  assert.equal(autoRefresh.checked, true);
  await act(async () => autoRefresh.click());
  assert.equal(streams.at(-1).readyState, EventSource.CLOSED);
  assert.match(
    document.querySelector(".dashboard-sync").textContent,
    /Retomar/,
  );
  await go("Home");
});

test("list and cards share the search and restore the saved layout after remounting", async () => {
  await go("Home");
  const layoutButton = (label) =>
    [
      ...document.querySelectorAll(
        '[aria-label="Visualização das aplicações"] button',
      ),
    ].find((button) => button.textContent === label);
  assert.equal(layoutButton("Lista").getAttribute("aria-pressed"), "true");
  await act(async () => layoutButton("Cards").click());
  assert.equal(layoutButton("Cards").getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelectorAll(".application-card").length, 2);
  const apiCard = document.querySelector(
    '[aria-label="Aplicação api-service"]',
  );
  assert.match(apiCard.textContent, /3000/);
  assert.match(apiCard.textContent, /100\.0 MB/);
  assert.match(apiCard.textContent, /1\.0%/);
  assert.match(
    document.querySelector('[aria-label="Aplicação web-service"]').textContent,
    /Configurada/,
  );
  assert.equal(
    dom.window.localStorage.getItem("monitor-pm2:applications-layout"),
    "cards",
  );

  const search = document.querySelector('input[aria-label="Buscar processo"]');
  const setInput = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setInput.call(search, "web");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(document.querySelectorAll(".application-card").length, 1);
  assert.match(
    document.querySelector(".applications-count").textContent,
    /1 de 2/,
  );
  await act(async () => layoutButton("Lista").click());
  assert.equal(document.querySelectorAll("tbody tr").length, 1);
  assert.match(document.querySelector("tbody").textContent, /web-service/);
  await act(async () => {
    setInput.call(search, "");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(document.querySelectorAll("tbody tr").length, 2);
  await act(async () => layoutButton("Cards").click());
  await go("Logs");
  await go("Home");
  assert.equal(layoutButton("Cards").getAttribute("aria-pressed"), "true");
  await act(async () =>
    root.render(createElement(App, { key: "restore-layout" })),
  );
  await go("Home");
  assert.equal(layoutButton("Cards").getAttribute("aria-pressed"), "true");
  await go("Home");
});

test("cards open the process dialog and logs, and keep actions locked when switching layouts during a restart", async () => {
  await go("Home");
  await act(async () =>
    document.querySelector('[aria-label="Adicionar novo processo"]').click(),
  );
  const dialog = document.querySelector(
    'dialog[aria-labelledby="add-process-title"]',
  );
  assert.ok(dialog.hasAttribute("open"));
  await act(async () => dialog.querySelector('[aria-label="Fechar"]').click());
  assert.ok(!dialog.hasAttribute("open"));
  assert.ok(
    !requests.some(
      (request) =>
        request.url === "/api/ecosystems" && request.method === "POST",
    ),
  );
  await act(async () =>
    document.querySelector('[aria-label="Ver logs de api-service"]').click(),
  );
  assert.match(
    document.querySelector('[role="dialog"][aria-label="Logs de api-service"]')
      .textContent,
    /Log de teste/,
  );
  await act(async () =>
    document.querySelector('[aria-label="Fechar logs"]').click(),
  );
  await act(async () =>
    document.querySelector('[aria-label="Reiniciar api-service"]').click(),
  );
  assert.ok(pendingAction);
  assert.ok(
    [...document.querySelectorAll(".process-action")].every(
      (button) => button.disabled,
    ),
  );
  const layoutButton = (label) =>
    [
      ...document.querySelectorAll(
        '[aria-label="Visualização das aplicações"] button',
      ),
    ].find((button) => button.textContent === label);
  await act(async () => layoutButton("Lista").click());
  assert.ok(document.querySelector("table"));
  assert.equal(
    document.querySelector('[aria-label="Reiniciar api-service"]').disabled,
    true,
  );
  await act(async () => layoutButton("Cards").click());
  assert.equal(
    document.querySelector('[aria-label="Reiniciar api-service"]').disabled,
    true,
  );
  await act(async () => pendingAction());
  assert.ok(
    [...document.querySelectorAll(".process-action")].every(
      (button) => !button.disabled,
    ),
  );
  assert.equal(
    requests.filter((request) => request.url === "/api/processes/1/restart")
      .length,
    1,
  );
  await go("Home");
});

test("display names persist in list and cards, participate in search, and survive stale SSE snapshots", async () => {
  await go("Home");
  const layoutButton = (label) =>
    [
      ...document.querySelectorAll(
        '[aria-label="Visualização das aplicações"] button',
      ),
    ].find((button) => button.textContent === label);
  await act(async () => layoutButton("Lista").click());
  await act(async () =>
    document
      .querySelector('[aria-label="Editar nome de exibição de api-service"]')
      .click(),
  );
  const field = document.querySelector(
    '[aria-label="Nome de exibição de api-service"]',
  );
  const setInput = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setInput.call(field, " workTabs ");
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  const stale = processes.map((process) => ({ ...process }));
  await act(async () =>
    field.form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(navigation("Projetos").disabled, true);
  assert.equal(document.querySelector('[title="Reiniciar"]').disabled, true);
  await act(async () => pendingLabel());
  assert.equal(navigation("Projetos").disabled, false);
  assert.equal(
    document.querySelector(".process-label-value").textContent,
    "workTabs",
  );
  assert.equal(processes[0].name, "api-service");
  assert.deepEqual(
    JSON.parse(
      requests.findLast((request) => request.url === "/api/processes/1/label")
        .body,
    ),
    { label: " workTabs ", name: "api-service", namespace: "default" },
  );
  await act(async () => streams.at(-1).emit("processes", stale));
  assert.equal(
    document.querySelector(".process-label-value").textContent,
    "workTabs",
  );
  await act(async () => layoutButton("Cards").click());
  assert.match(
    document.querySelector('[aria-label="Aplicação api-service"]').textContent,
    /workTabs/,
  );
  const search = document.querySelector('[aria-label="Buscar processo"]');
  await act(async () => {
    setInput.call(search, "WORKTABS");
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(document.querySelectorAll(".application-card").length, 1);
  await act(async () =>
    root.render(createElement(App, { key: "saved-process-label" })),
  );
  assert.equal(
    document.querySelector(".process-label-value").textContent,
    "workTabs",
  );
  await act(async () =>
    document
      .querySelector('[aria-label="Editar nome de exibição de api-service"]')
      .click(),
  );
  const clear = document.querySelector(
    '[aria-label="Nome de exibição de api-service"]',
  );
  assert.equal(clear.value, "workTabs");
  const previouslySaved = processes.map((process) => ({ ...process }));
  await act(async () => {
    setInput.call(clear, "");
    clear.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () =>
    clear.form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  await act(async () => pendingLabel());
  await act(async () => streams.at(-1).emit("processes", previouslySaved));
  assert.equal(document.querySelector(".process-label-value"), null);
  assert.equal(processes[0].label, "");
});

test("process project links can be saved, searched, opened and cleared in list and cards without stale SSE overwrites", async () => {
  await go("Home");
  const layoutButton = label => [...document.querySelectorAll('.application-layout-selector button')].find(button => button.textContent === label);
  await act(async () => layoutButton("Lista").click());
  assert.match(document.querySelector("tbody").textContent, /Sem projeto/);
  const stale = processes.map(row => ({ ...row }));
  const edit = () => document.querySelector('[aria-label="Vincular projeto a api-service"]');
  await act(async () => edit().click());
  const dialog = () => document.querySelector('dialog[aria-labelledby="process-project-title"]');
  const select = dialog().querySelector("select");
  await act(async () => {
    select.value = projectRows[0]._id;
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await act(async () => dialog().querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(navigation("Projetos").disabled, true);
  assert.ok([...dialog().querySelectorAll("button, select")].every(node => node.disabled));
  assert.equal(document.querySelector('[title="Reiniciar"]').disabled, true);
  await act(async () => pendingLink());
  assert.equal(dialog(), null);
  await act(async () => streams.at(-1).emit("processes", stale));
  assert.match(document.querySelector("tbody").textContent, /Projeto X/);
  await act(async () => layoutButton("Cards").click());
  assert.match(document.querySelector(".application-card").textContent, /Projeto X/);
  const search = document.querySelector('[aria-label="Buscar processo"]');
  const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setInput.call(search, "Projeto X"); search.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  assert.equal(document.querySelectorAll(".application-card").length, 1);
  await act(async () => { setInput.call(search, ""); search.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  await act(async () => [...document.querySelectorAll(".application-card button")].find(button => button.textContent === "Projeto X").click());
  assert.match(document.querySelector(".repository-header").textContent, /Projeto X/);
  await act(async () => [...document.querySelectorAll("main button")].find(button => button.textContent.trim() === "Todos os projetos").click());
  await go("Home");
  await act(async () => edit().click());
  await act(async () => { dialog().querySelector("select").value = ""; dialog().querySelector("select").dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  const linked = processes.map(row => ({ ...row }));
  await act(async () => dialog().querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => pendingLink());
  await act(async () => streams.at(-1).emit("processes", linked));
  assert.match(document.querySelector(".application-card").textContent, /Sem projeto/);
  // A fresh collection must also reflect project deletion or path changes.
  const observed = new Date(Date.now() + 10000).toISOString();
  await act(async () => streams.at(-1).emit("processes", linked.map(row => ({ ...row, projectId: null, projectName: null, projectUpdatedAt: null, projectObservedAt: observed }))));
  assert.match(document.querySelector(".application-card").textContent, /Sem projeto/);
});

test("fresh project removal replaces saved metadata and stale snapshots cannot restore it or transfer it to another identity", async () => {
  const { mergeProcessLabels } = await vite.ssrLoadModule("/src/features/processes/processes.ts");
  const linked = { ...processes[0], projectId: "project-a", projectName: "Project A", projectUpdatedAt: "2026-11-01T00:00:00.000Z", projectObservedAt: "2026-11-01T00:00:00.000Z" };
  const removed = { ...linked, projectId: null, projectName: null, projectUpdatedAt: null, projectObservedAt: "2026-11-02T00:00:00.000Z" };
  assert.equal(mergeProcessLabels([removed], [linked])[0].projectId, null);
  assert.equal(mergeProcessLabels([linked], [removed])[0].projectId, null);
  assert.equal(mergeProcessLabels([{ ...removed, name: "replacement" }], [linked])[0].projectId, null);
});

test("link dialog handles loading and save failures and lets the user retry", async () => {
  failProjectChoices = true;
  await act(async () => document.querySelector('[aria-label="Vincular projeto a api-service"]').click());
  const dialog = () => document.querySelector('dialog[aria-labelledby="process-project-title"]');
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Falha ao carregar/);
  assert.equal(dialog().querySelector('[type="submit"]').disabled, true);
  failProjectChoices = false;
  await act(async () => [...dialog().querySelectorAll("button")].find(button => button.textContent === "Tentar novamente").click());
  failLink = true;
  await act(async () => dialog().querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => pendingLink());
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Falha ao vincular/);
  assert.equal(dialog().querySelector('[type="submit"]').disabled, false);
  failLink = false;
  await act(async () => [...dialog().querySelectorAll("button")].find(button => button.textContent === "Cancelar").click());
  assert.equal(dialog(), null);
});

test("Manage saves startup preferences once, preserves drafts on failure and is available in list and cards", async () => {
  await go("Home");
  const manage = () => document.querySelector('[aria-label="Gerenciar api-service"]');
  const dialog = () => document.querySelector('dialog[aria-labelledby="process-settings-title"]');
  const button = label => [...dialog().querySelectorAll("button")].find(node => node.textContent.trim() === label);
  for (const layout of ["Lista", "Cards"]) {
    await act(async () => [...document.querySelectorAll('.application-layout-selector button')].find(node => node.textContent === layout).click());
    assert.ok(manage());
  }
  processSettingsReadFail = true;
  await act(async () => manage().click());
  assert.match(dialog().textContent, /Falha ao carregar/);
  processSettingsReadFail = false;
  await act(async () => button("Tentar novamente").click());
  assert.equal(dialog().querySelector('input[type="checkbox"]').checked, false);
  await act(async () => dialog().querySelector('input[type="checkbox"]').click());
  const count = requests.filter(row => row.method === "PUT" && row.url.endsWith("/settings")).length;
  await act(async () => { button("Salvar").click(); button("Salvar").click(); });
  assert.equal(requests.filter(row => row.method === "PUT" && row.url.endsWith("/settings")).length, count + 1);
  assert.equal(navigation("Projetos").disabled, true);
  assert.equal(button("Cancelar").disabled, true);
  assert.equal(manage().disabled, true);
  assert.deepEqual(JSON.parse(requests.at(-1).body), { name: "api-service", namespace: "default", autoStart: true });
  await act(async () => pendingProcessSettings());
  assert.equal(dialog(), null);
  assert.equal(navigation("Projetos").disabled, false);
  await act(async () => manage().click());
  assert.equal(dialog().querySelector('input[type="checkbox"]').checked, true);
  await act(async () => dialog().querySelector('input[type="checkbox"]').click());
  processSettingsFail = true;
  await act(async () => button("Salvar").click());
  await act(async () => pendingProcessSettings());
  assert.equal(dialog().querySelector('input[type="checkbox"]').checked, false, "Keep the unsaved choice after a failure");
  assert.match(dialog().textContent, /Falha ao salvar/);
  processSettingsFail = false;
  await act(async () => button("Salvar").click());
  await act(async () => pendingProcessSettings());
  canAutoStart = false;
  await act(async () => manage().click());
  assert.equal(dialog().querySelector('input[type="checkbox"]').disabled, true);
  assert.match(dialog().textContent, /Vincule o processo a um projeto/);
  await act(async () => button("Cancelar").click());
  canAutoStart = true;
  const { mergeProcessLabels } = await vite.ssrLoadModule("/src/features/processes/processes.ts");
  const saved = { ...processes[0], autoStart: true, autoStartUpdatedAt: "2026-11-13T18:00:00.000Z" };
  const stale = { ...saved, autoStart: false, autoStartUpdatedAt: "2026-11-13T17:00:00.000Z" };
  assert.equal(mergeProcessLabels([stale], [saved])[0].autoStart, true);
});

test("navigation stays disabled while a user creation is pending and returns afterward", async () => {
  await go("Usuários");
  document.querySelector('input[name="username"]').value = "operador";
  document.querySelector('input[name="password"]').value =
    "test-password-12345";
  const form = document.querySelector("main form");
  await act(async () =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.ok(pendingUser);
  assert.ok(
    [...document.querySelectorAll("nav button")].every(
      (button) => button.disabled,
    ),
  );
  await act(async () => pendingUser());
  assert.ok(
    [...document.querySelectorAll("nav button")].every(
      (button) => !button.disabled,
    ),
  );
  assert.match(document.querySelector("main").textContent, /Usuário criado/);
  await go("Home");
});

test("projects browse local files and keep build publication and history inside the project", async () => {
  const button = (text) =>
    [...document.querySelectorAll("main button")].find(
      (item) => item.textContent.trim() === text,
    );
  await go("Projetos");
  assert.match(
    document.querySelector(".project-grid").textContent,
    /Projeto X/,
  );
  await act(async () => button("Projeto X").click());
  assert.match(
    document.querySelector(".repository-header").textContent,
    /Projeto X/,
  );
  await act(async () => button("docs").click());
  await act(async () => button("README.md").click());
  assert.match(
    document.querySelector("pre code").textContent,
    /<script>texto, sem execução<\/script>/,
  );
  assert.equal(document.querySelector("pre script"), null);
  assert.match(
    document.querySelector('a[href*="/files/download"]').href,
    /docs%2FREADME.md/,
  );
  await act(async () => button("Fazer novo build").click());
  const form = document.querySelector(".project-form");
  assert.equal(form.querySelector('textarea[name="comments"]').required, true);
  assert.ok(form.querySelector('input[type="file"]').accept.includes(".zip"));
  form.querySelector('[name="name"]').value = "build-06-11-v1";
  form.querySelector('[name="comments"]').value =
    "Correção do fluxo de autenticação.";
  await act(async () =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.ok(pendingProjectBuild);
  assert.ok(document.querySelector(".build-progress-panel"));
  await act(async () => broadcastPublications(publicationRows.map(row => ({ ...row, percent: 60, stage: "Atualizando arquivos do projeto", logs: ["Pacote recebido"] }))));
  assert.equal(document.querySelector(".build-progress-panel progress").value, 60);
  assert.ok(
    [
      ...document.querySelectorAll(
        'nav[aria-label="Navegação principal"] button',
      ),
    ].every((item) => item.disabled),
  );
  assert.equal(button("Todos os projetos").disabled, true);
  assert.match(
    document.querySelector(".project-form-actions").textContent,
    /Extraindo e publicando/,
  );
  await act(async () => pendingProjectBuild());
  assert.equal(document.querySelector(".build-progress-panel progress").value, 100);
  await act(async () => document.querySelector('[aria-label="Fechar progresso de Projeto X"]').click());
  assert.equal(document.querySelector(".project-form"), null);
  assert.match(
    document.querySelector(".build-history").textContent,
    /build-06-11-v1/,
  );
  assert.match(
    document.querySelector(".build-history").textContent,
    /Correção do fluxo de autenticação/,
  );
  assert.match(
    document.querySelector(".build-history").textContent,
    /Última publicação/,
  );
  assert.ok(
    [
      ...document.querySelectorAll(
        'nav[aria-label="Navegação principal"] button',
      ),
    ].every((item) => !item.disabled),
  );
  await go("Home");
  await go("Projetos");
  assert.equal(document.querySelector("h1").textContent, "Projetos");
  assert.match(
    document.querySelector(".repository-header").textContent,
    /Projeto X/,
  );
  await act(async () => button("Todos os projetos").click());
  await act(async () => button("Novo projeto").click());
  const projectForm = document.querySelector(".project-form");
  projectForm.querySelector('[name="name"]').value = "Projeto Y";
  projectForm.querySelector('[name="rootPath"]').value =
    "C:\\servicos\\ProjetoY";
  projectForm.querySelector('[name="description"]').value = "Outra aplicação";
  projectForm.querySelector('[name="applicationUrl"]').value = "https://example.test/project-y";
  await act(async () =>
    projectForm.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.match(
    document.querySelector(".repository-header").textContent,
    /Projeto Y/,
  );
  const creation = requests.find(
    (request) => request.url === "/api/projects" && request.method === "POST",
  );
  assert.deepEqual(JSON.parse(creation.body), {
    name: "Projeto Y",
    description: "Outra aplicação",
    applicationUrl: "https://example.test/project-y",
    rootPath: "C:\\servicos\\ProjetoY",
    pm2ConfigPath: "ecosystem.config.js",
  });
  await go("Home");
});

test("project documentation, saved configuration, local ecosystem and env files are editable independently", async () => {
  await go("Projetos");
  const button = label => [...document.querySelectorAll("main button")].find(node => node.textContent.trim() === label);
  await act(async () => document.querySelector("#project-tab-about").click());
  assert.equal(document.querySelector('[name="pm2ConfigContent"]'), null);
  const field = document.querySelector('[name="documentation"]');
  const documentation = "# README\n**Banco**\n- Tabela users\n[Diagrama](https://example.com/schema)\n<script>unsafe()</script>\n[Unsafe](javascript:alert(1))\n```sql\nSELECT 1;\n```";
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(field, documentation);
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => button("Visualizar documentação").click());
  const preview = document.querySelector(".project-documentation-preview");
  assert.equal(preview.querySelector("h3").textContent, "README");
  assert.equal(preview.querySelector("script"), null);
  assert.equal(preview.querySelectorAll("a").length, 1);
  assert.equal(preview.querySelector("pre").textContent, "SELECT 1;");
  await act(async () => button("Salvar documentação").click());
  assert.equal(navigation("Home").disabled, true);
  assert.equal(document.querySelector("#project-tab-environment").disabled, true);
  const saved = JSON.parse(requests.at(-1).body);
  assert.equal(saved.documentation, documentation);
  assert.equal("pm2ConfigContent" in saved, false);
  await act(async () => pendingProjectUpdate());
  await act(async () => document.querySelector("#project-tab-environment").click());
  const config = document.querySelector('[name="pm2ConfigContent"]');
  assert.ok(config);
  config.value = 'module.exports = { apps: [{ name: "app", script: "./main.js", env: { PORT: 3000 } }] };';
  await act(async () => config.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(navigation("Home").disabled, true);
  const configRequest = JSON.parse(requests.at(-1).body);
  assert.match(configRequest.pm2ConfigContent, /PORT: 3000/);
  assert.equal("documentation" in configRequest, false);
  await act(async () => pendingProjectUpdate());
  assert.equal(document.querySelector('[name="pm2ConfigContent"]').value, configRequest.pm2ConfigContent);
  const envContent = () => document.querySelector('[name="environmentContent"]');
  async function setEnvironment(value) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(envContent(), value);
      envContent().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }
  await setEnvironment('PORT=3000\nLABEL="a=b"\n');
  await act(async () => button("Salvar arquivo de ambiente").click());
  assert.equal(navigation("Home").disabled, true);
  assert.equal(document.querySelector('[name="pm2ConfigContent"]').form.querySelector('button[type="submit"], button:not([type])').disabled, true);
  assert.equal(button("Abrir / recarregar arquivo").disabled, true);
  await act(async () => pendingEnvironmentSave());
  assert.equal(navigation("Home").disabled, false);
  assert.equal(environmentFiles.get(".env").content, 'PORT=3000\nLABEL="a=b"\n');
  await setEnvironment("PORT=4000\n");
  environmentConflict = true;
  await act(async () => button("Salvar arquivo de ambiente").click());
  await act(async () => pendingEnvironmentSave());
  assert.equal(envContent().value, "PORT=4000\n", "Keep the draft on save failure");
  assert.match(document.querySelector('[role="alert"]').textContent, /alterado desde/);
  environmentConflict = false;
  await act(async () => button("Abrir / recarregar arquivo").click());
  assert.equal(envContent().value, environmentFiles.get(".env").content);
  await act(async () => {
    const name = document.querySelector('[name="environmentFileName"]');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(name, ".env.production");
    name.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => button("Abrir / recarregar arquivo").click());
  await setEnvironment("MODE=production\n");
  await act(async () => button("Salvar arquivo de ambiente").click());
  await act(async () => pendingEnvironmentSave());
  assert.equal(environmentFiles.get(".env.production").content, "MODE=production\n");
  localEcosystem = 'module.exports = { apps: [{ env: { PORT: 9000 } }] };';
  environmentFiles.set("ecosystem.config.js", { name: "ecosystem.config.js", content: localEcosystem, revision: "b".repeat(64) });
  await act(async () => button("Atualizar").click());
  assert.equal(document.querySelector('[name="pm2ConfigContent"]'), null);
  const ecosystemEditor = document.querySelector('[name="ecosystemContent"]');
  assert.match(ecosystemEditor.value, /PORT: 9000/);
  const corrected = "module.exports={apps:[{name:'KWMS BLUE',script:'./main.js',cwd:'C:/inetpub/wwwroot/KWMS_BLUE'}]};";
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(ecosystemEditor, corrected);
    ecosystemEditor.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => ecosystemEditor.form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(navigation("Home").disabled, true);
  assert.equal(envContent().disabled, true);
  assert.equal(JSON.parse(requests.at(-1).body).revision, "b".repeat(64));
  await act(async () => pendingEnvironmentSave());
  assert.equal(environmentFiles.get("ecosystem.config.js").content, corrected);
  assert.equal(navigation("Home").disabled, false);
  ecosystemReadError = 500;
  await act(async () => button("Atualizar").click());
  assert.equal(document.querySelector('[name="pm2ConfigContent"]'), null);
  assert.match(document.querySelector('[role="alert"]').textContent, /Falha ao ler/);
  ecosystemReadError = 0;
  localEcosystem = null;
  await act(async () => document.querySelector("#project-tab-about").click());
  assert.match(document.querySelector(".project-documentation-preview").textContent, /README/);
  await go("Home");
});

test("background publications survive navigation, run across projects and block conflicting actions for all users", async () => {
  await go("Projetos");
  const projectButton = text => [...document.querySelectorAll("main button")].find(button => button.textContent.trim() === text);
  await act(async () => projectButton("Todos os projetos").click());
  await act(async () => projectButton("Projeto X").click());
  await act(async () => document.querySelector("#project-tab-builds").click());
  const publish = () => document.querySelector('.build-history button[aria-label^="Publicar "]');
  const panelButton = text => [...document.querySelectorAll('.build-progress-panel button')].find(button => button.textContent.trim() === text);
  await act(async () => publish().click());
  const cancelledId = publicationRows.at(-1).id;
  await act(async () => broadcastPublications(publicationRows.map(row => row.id === cancelledId ? { ...row, percent: 60, stage: "Copying", logs: ["Package received"] } : row)));
  await act(async () => panelButton("Cancelar build").click());
  assert.ok(requests.some(request => request.url.endsWith(`/${cancelledId}/cancel`)));
  assert.equal(panelButton("Cancelar build"), undefined);
  assert.ok([...document.querySelectorAll('nav[aria-label] button')].every(button => !button.disabled));
  await act(async () => pendingPublication(409, "Cancelled; files restored"));
  await act(async () => document.querySelector('[aria-label="Fechar progresso de Projeto X"]').click());
  await act(async () => publish().click());
  const finishFirst = pendingPublication;
  await go("Home");
  assert.ok([...document.querySelectorAll(".process-action")].every(button => button.disabled));
  assert.ok([...document.querySelectorAll("main button")].find(button => button.textContent.includes("Adicionar processo")).disabled);
  assert.ok(document.querySelector(".build-progress-panel"));
  await go("Projetos");
  await act(async () => projectButton("Todos os projetos").click());
  await act(async () => projectButton("Projeto Y").click());
  assert.equal(projectButton("Fazer novo build").disabled, false);
  await act(async () => projectButton("Fazer novo build").click());
  const form = document.querySelector(".project-form");
  form.querySelector('[name="name"]').value = "parallel-build";
  form.querySelector('[name="comments"]').value = "Parallel project build";
  await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(document.querySelectorAll(".build-progress-item.running").length, 2);
  await act(async () => pendingProjectBuild());
  await act(async () => projectButton("Todos os projetos").click());
  await act(async () => projectButton("Projeto X").click());
  assert.equal(projectButton("Fazer novo build").disabled, true);
  await act(async () => finishFirst(502, "Script not found: <script>main.js</script>"));
  assert.match(document.querySelector('.build-progress-item.failed pre').textContent, /Script not found/);
  assert.equal(document.querySelector('.build-progress-panel script'), null);
  assert.equal(projectButton("Fazer novo build").disabled, false);
  // A job submitted by another operator must impose the same locks.
  const remote = { id: "remote", projectId: projectRows[0]._id, projectName: "Projeto X", username: "another-user", canCancel: false, percent: 40, stage: "Validando arquivos", status: "running", cancellable: true, logs: [] };
  await act(async () => broadcastPublications([...publicationRows, remote]));
  assert.equal(projectButton("Fazer novo build").disabled, true);
  assert.equal(panelButton("Cancelar build"), undefined);
  await go("Home");
  assert.ok([...document.querySelectorAll(".process-action")].every(button => button.disabled));
  await act(async () => finishPublication("remote", "succeeded"));
  assert.ok([...document.querySelectorAll(".process-action")].every(button => !button.disabled));
  await act(async () => publicationStreams.at(-1).onerror());
  assert.ok([...document.querySelectorAll(".process-action")].every(button => button.disabled));
  assert.match(document.querySelector(".build-progress-panel").textContent, /Aguardando reconexão/);
  await act(async () => broadcastPublications(publicationRows));
  assert.ok([...document.querySelectorAll(".process-action")].every(button => !button.disabled));
});

test("stop and delete require a red confirmation dialog and prevent repeated submissions", async () => {
  await go("Home");
  const dialog = () => document.querySelector(".process-confirmation");
  for (const [action, label] of [["stop", "Parar"], ["delete", "Remover"]]) {
    const count = requests.filter(row => row.url.endsWith(`/${action}`)).length;
    await act(async () => document.querySelector(`[aria-label="${label} api-service"]`).click());
    assert.ok(dialog().hasAttribute("open"));
    assert.ok(dialog().querySelector(".process-confirm-danger"));
    assert.match(dialog().textContent, /api-service/);
    assert.equal(requests.filter(row => row.url.endsWith(`/${action}`)).length, count);
    await act(async () => [...dialog().querySelectorAll("button")].find(button => button.textContent === "Cancelar").click());
    assert.equal(dialog(), null);
    await act(async () => document.querySelector(`[aria-label="${label} api-service"]`).click());
    const confirm = [...dialog().querySelectorAll("button")].find(button => button.textContent.startsWith("Confirmar"));
    await act(async () => { confirm.click(); confirm.click(); });
    assert.equal(requests.filter(row => row.url.endsWith(`/${action}`)).length, count + 1);
    assert.equal(confirm.disabled, true);
    const sent = JSON.parse(requests.findLast(row => row.url.endsWith(`/${action}`)).body);
    assert.deepEqual(sent, { name: "api-service", namespace: "default" });
    await act(async () => pendingAction());
    assert.equal(dialog(), null);
  }
});

test("Home live indicator reflects successful collections, pause and reconnection", async () => {
  await go("Home");
  const indicator = () => document.querySelector(".live-indicator");
  await act(async () => streams.at(-1).emit("live", { collectedAt: new Date().toISOString() }));
  assert.ok(indicator().classList.contains("active"));
  assert.equal(indicator().getAttribute("aria-pressed"), "true");
  const oldStream = streams.at(-1);
  const buildStream = publicationStreams.at(-1);
  await act(async () => indicator().click());
  assert.ok(indicator().classList.contains("paused"));
  assert.equal(oldStream.readyState, 2);
  assert.equal(buildStream.readyState, 1, "Pausing metrics must preserve publication locks and progress");
  await act(async () => indicator().click());
  assert.ok(indicator().classList.contains("reconnecting"));
  await act(async () => streams.at(-1).emit("processes", processes));
  assert.ok(indicator().classList.contains("active"));
  await act(async () => streams.at(-1).onerror());
  assert.ok(indicator().classList.contains("reconnecting"));
  await act(async () => streams.at(-1).emit("processes", processes));
});

test("Home list and cards show the application URL separately from plain port numbers", async () => {
  await go("Home");
  const previous = processes.map(row => ({ ...row }));
  // Earlier stale-snapshot tests deliberately advance the observation by 10 seconds.
  processes.forEach(row => { row.applicationUrl = "https://example.test/app"; row.projectObservedAt = new Date(Date.now() + 20000).toISOString(); });
  const refresh = () => [...document.querySelectorAll("main button")].find(button => button.textContent.trim() === "Atualizar");
  await act(async () => refresh().click());
  for (const layout of ["Lista", "Cards"]) {
    await act(async () => [...document.querySelectorAll('.application-layout-selector button')].find(button => button.textContent === layout).click());
    const ports = [...document.querySelectorAll(".process-port")];
    assert.ok(
      ports.some(
        (port) => port.querySelector(".font-mono")?.textContent === "3000",
      ),
    );
    assert.ok(ports.every((port) => !port.querySelector("a, details")));
    const link = document.querySelector('.applications a[href="https://example.test/app"]');
    assert.ok(link);
    assert.equal(link.textContent, "Abrir aplicação");
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
  }
  await act(async () =>
    [
      ...document.querySelectorAll(
        '[aria-label="Visualização das aplicações"] button',
      ),
    ]
      .find((button) => button.textContent === "Cards")
      .click(),
  );
  const cardPort = document.querySelector(".application-card .process-port");
  assert.equal(cardPort.querySelector(".font-mono").textContent, "3000");
  assert.equal(cardPort.querySelector("a, details"), null);
  assert.ok(document.querySelector('.application-card a[href="https://example.test/app"]'));
  processes.splice(0, processes.length, ...previous.map(row => ({ ...row, projectObservedAt: new Date(Date.now() + 20000).toISOString() })));
  await act(async () => refresh().click());
  await go("Home");
});

test("retention preferences persist and block navigation while saving", async () => {
  await go("Configurações");
  const form = document.querySelector(".retention-form");
  assert.ok(form);
  assert.equal(form.querySelector('[type="checkbox"]').checked, false);
  assert.equal(form.querySelector('[name="intervalHours"]'), null);
  assert.match(form.textContent, /data de envio de cada versão/);
  assert.equal(form.querySelector('[name="retentionDays"]').disabled, true);
  await act(async () => form.querySelector('input[type="checkbox"]').click());
  const setInput = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setInput.call(form.querySelector('[name="retentionDays"]'), "14");
    form
      .querySelector('[name="retentionDays"]')
      .dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  });
  await act(async () =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(navigation("Projetos").disabled, true);
  await act(async () => pendingSettings());
  assert.deepEqual(
    JSON.parse(
      requests.findLast(
        (request) =>
          request.url === "/api/settings/retention" && request.method === "PUT",
      ).body,
    ),
    { enabled: true, retentionDays: 14 },
  );
  assert.equal(navigation("Projetos").disabled, false);
  await go("Home");
  await go("Configurações");
  assert.equal(document.querySelector('[name="retentionDays"]').value, "14");
});

test("English and Spanish translate navigation, settings and projects without losing session state", async () => {
  const selectLanguage = async (locale) => {
    const select = document.querySelector('select:has(option[value="pt-BR"])');
    await act(async () => {
      select.value = locale;
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  const streamCount = streams.length;
  await selectLanguage("en");
  await go("Home");
  await go("Settings");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(window.localStorage.getItem("monitor-pm2:locale"), "en");
  assert.equal(document.querySelector("h1").textContent, "Settings");
  assert.match(
    document.querySelector(".retention-form").textContent,
    /Delete each version after/,
  );
  await go("Projects");
  assert.match(document.querySelector("main").textContent, /Create new build/);
  await go("Settings");
  await selectLanguage("es");
  await go("Inicio");
  await go("Configuración");
  assert.equal(document.documentElement.lang, "es");
  assert.equal(document.querySelector("h1").textContent, "Configuración");
  await go("Proyectos");
  assert.match(document.querySelector("main").textContent, /Crear nuevo build/);
  await go("Configuración");
  await selectLanguage("pt-BR");
  assert.equal(document.querySelector("h1").textContent, "Configurações");
  assert.equal(streams.length, streamCount);
  await go("Home");
});

test("project editing saves changes and deletion requires the project name while locking navigation", async () => {
  await go("Projetos");
  const button = (label) =>
    [...document.querySelectorAll("main button")].find(
      (node) => node.textContent.trim() === label,
    );
  await act(async () => button("Todos os projetos").click());
  await act(async () => button("Projeto Y").click());
  await act(async () => button("Editar projeto").click());
  const form = document.querySelector(".project-details .project-form");
  assert.equal(form.querySelector('[name="name"]').value, "Projeto Y");
  assert.equal(form.querySelector('[name="applicationUrl"]').value, "https://example.test/project-y");
  form.querySelector('[name="applicationUrl"]').value = "https://example.test/updated";
  form.querySelector('[name="name"]').value = "Projeto Y atualizado";
  form.querySelector('[name="description"]').value = "Nova descrição";
  form.querySelector('[name="rootPath"]').value =
    "C:\\servicos\\ProjetoY-atualizado";
  form.querySelector('[name="pm2ConfigPath"]').value =
    "config/ecosystem.config.js";
  assert.equal(form.querySelector('[name="pm2ConfigContent"]'), null);
  await act(async () =>
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(navigation("Home").disabled, true);
  await act(async () => pendingProjectUpdate());
  assert.match(
    document.querySelector(".repository-header").textContent,
    /Projeto Y atualizado/,
  );
  assert.match(
    document.querySelector(".project-details").textContent,
    /config\/ecosystem.config.js/,
  );
  const saved = requests.findLast(
    (row) => row.method === "PUT" && row.url.startsWith("/api/projects/"),
  );
  assert.deepEqual(JSON.parse(saved.body), {
    name: "Projeto Y atualizado",
    description: "Nova descrição",
    applicationUrl: "https://example.test/updated",
    rootPath: "C:\\servicos\\ProjetoY-atualizado",
    pm2ConfigPath: "config/ecosystem.config.js",
  });
  await act(async () => button("Excluir projeto").click());
  assert.equal(button("Confirmar exclusão").disabled, true);
  assert.match(
    document.querySelector(".project-delete-section").textContent,
    /pasta da aplicação na VM é preservada/,
  );
  assert.equal(document.querySelector('[name="stopProcesses"]').checked, false);
  await act(async () => button("Cancelar").click());
  assert.equal(document.querySelector('[name="deleteConfirmation"]'), null);
  await act(async () => button("Excluir projeto").click());
  assert.equal(document.querySelector('[name="stopProcesses"]').checked, false);
  await act(async () =>
    document.querySelector('[name="stopProcesses"]').click(),
  );
  const field = document.querySelector('[name="deleteConfirmation"]');
  const setInput = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    setInput.call(field, "Projeto Y atualizado");
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  assert.equal(button("Confirmar exclusão").disabled, false);
  await act(async () =>
    field.form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  assert.equal(navigation("Home").disabled, true);
  await act(async () => pendingProjectDelete());
  const deletion = requests.findLast((row) => row.method === "DELETE");
  assert.deepEqual(JSON.parse(deletion.body), {
    stopProcesses: true,
    processRevision: "process-revision",
  });
  assert.equal(document.querySelector(".repository-header"), null);
  assert.match(
    document.querySelector(".project-grid").textContent,
    /Projeto X/,
  );
  assert.doesNotMatch(
    document.querySelector(".project-grid").textContent,
    /Projeto Y atualizado/,
  );
  assert.equal(navigation("Home").disabled, false);
  await go("Home");
});

test("admins edit user roles with feedback and self-demotion removes admin navigation", async () => {
  await go("Usuários");
  const select = document.querySelector('[aria-label="Perfil de tester"]');
  await act(async () => { select.value = "user"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  const save = () => document.querySelector('[aria-label="Salvar perfil de tester"]');
  roleSaveFails = true;
  await act(async () => save().click());
  assert.equal(navigation("Home").disabled, true);
  await act(async () => pendingRole());
  assert.match(document.querySelector('[role="alert"]').textContent, /alterar este perfil/);
  assert.equal(save().disabled, false);
  roleSaveFails = false;
  await act(async () => save().click());
  assert.equal(JSON.parse(requests.at(-1).body).role, "user");
  await act(async () => pendingRole());
  assert.equal(document.querySelector("h1").textContent, "Olá, tester");
  assert.equal(navigation("Usuários"), undefined);
  await act(async () => root.render(createElement(App, { key: "after-role-edit" })));
});

test("regular users can open settings but cannot see or fetch user administration", async () => {
  sessionRole = "user";
  const userRequests = requests.filter(
    (row) => row.url === "/api/users",
  ).length;
  await act(async () =>
    root.render(createElement(App, { key: "regular-user" })),
  );
  await go("Configurações");
  assert.ok(document.querySelector(".retention-form"));
  assert.equal(
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent.trim() === "Usuários",
    ),
    false,
  );
  assert.equal(document.querySelector('[name="username"]'), null);
  assert.equal(
    requests.filter((row) => row.url === "/api/users").length,
    userRequests,
  );
  sessionRole = "admin";
  await act(async () =>
    root.render(createElement(App, { key: "administrator" })),
  );
  await go("Configurações");
  assert.ok(
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent.trim() === "Usuários",
    ),
  );
  await go("Home");
});

test("logs start with application selection, safely render ANSI and ignore stale results", async () => {
  await go("Logs");
  const selects = document.querySelectorAll("#management-panel select");
  assert.equal(selects[0].value, "process");
  assert.equal(document.querySelector(".log-terminal"), null);
  assert.ok([...selects[1].options].some(option => option.value === "archived-app"));
  const select = async name => act(async () => {
    selects[1].value = name;
    selects[1].dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await select("api-service");
  const terminal = document.querySelector(".log-terminal");
  assert.match(terminal.textContent, /\[Nest\] api-service/);
  assert.ok(!terminal.textContent.includes("\x1b"));
  assert.match(terminal.querySelector(".terminal-color-2").textContent, /Nest/);
  assert.equal(terminal.querySelector("script"), null);
  assert.match(terminal.textContent, /<script>literal<\/script>/);
  const live = logStreams.at(-1);
  await act(async () => live.emit("log", { content: "nova saída 🚀\n" }));
  assert.match(terminal.textContent, /nova saída 🚀/);
  const pause = [...document.querySelectorAll("#management-panel button")].find(button => button.textContent === "Pausar");
  await act(async () => pause.click());
  await act(async () => live.emit("log", { content: "durante pausa\n" }));
  assert.doesNotMatch(terminal.textContent, /durante pausa/);
  await act(async () => pause.click());
  assert.match(terminal.textContent, /durante pausa/);
  await act(async () => live.emit("logs-error", {}));
  assert.match(document.querySelector("#management-panel").textContent, /Logs sem conexão/);
  await act(async () => live.emit("live", {}));
  assert.match(document.querySelector("#management-panel").textContent, /Logs em tempo real/);
  deferLogs = true;
  await select("archived-app"); await select("web-service");
  assert.equal(live.readyState, 2);
  await act(async () => pendingLogs.get("web-service")());
  await act(async () => pendingLogs.get("archived-app")());
  assert.match(document.querySelector(".log-terminal").textContent, /web-service/);
  assert.doesNotMatch(document.querySelector(".log-terminal").textContent, /archived-app/);
  deferLogs = false;
  await go("Home");
  assert.equal(logStreams.at(-1).readyState, 2);
});

test("terminal parser consumes controls and extended colors without interpreting their parameters", async () => {
  const { terminalParts } = await vite.ssrLoadModule("/src/components/log-terminal/ansi.ts");
  const parts = terminalParts("\x1b[32mgreen\x1b[0m plain\x1b]8;;https://example.test\x07link\x1b]8;;\x07\x1b[38;2;255;0;31m RGB\x1b[2J\x1b[1mbold\x1b[22mnormal");
  assert.equal(parts.map(part => part.text).join(""), "green plainlink RGBboldnormal");
  assert.equal(parts[0].color, 2);
  assert.equal(parts.find(part => part.text === " RGB").color, undefined);
  assert.equal(parts.find(part => part.text === "bold").bold, true);
  assert.equal(parts.at(-1).bold, false);
});

test("manual Home refresh keeps a loading indicator in the process area until the request completes", async () => {
  deferProcesses = true;
  const refresh = [...document.querySelectorAll("main button")].find(button => button.textContent.trim() === "Atualizar");
  await act(async () => refresh.click());
  assert.match(document.querySelector(".applications [role=status]").textContent, /Carregando aplicações/);
  assert.equal(document.querySelector(".applications table"), null);
  await act(async () => streams.at(-1).emit("processes", processes));
  assert.match(document.querySelector(".applications [role=status]").textContent, /Carregando aplicações/);
  await act(async () => pendingProcessLoad());
  deferProcesses = false;
  assert.equal(document.querySelector(".applications").getAttribute("aria-busy"), "false");
  assert.ok(!document.querySelector(".dashboard-sync").textContent.includes("Atualização ao vivo"));
});

test("unstarted applications start their project once and block conflicting actions", async () => {
  const missing = { ...processes[0], id: "project:missing", name: "missing-app", label: "", projectId: projectRows[0]._id,
    startProjectId: projectRows[0]._id, status: "not_started", pid: 0, applicationUrl: "https://example.test/app" };
  await act(async () => streams.at(-1).emit("processes", [...processes, missing]));
  assert.match(document.querySelector(".applications").textContent, /Não iniciada/);
  assert.ok(document.querySelector('.applications a[href="https://example.test/app"]'));
  const start = [...document.querySelectorAll(".applications button")].find(button => button.textContent.trim() === "Iniciar");
  const before = requests.filter(row => row.url.endsWith("/start")).length;
  await act(async () => { start.click(); start.click(); });
  assert.equal(requests.filter(row => row.url.endsWith("/start")).length, before + 1);
  assert.equal(requests.at(-1).url, `/api/projects/${projectRows[0]._id}/start`);
  assert.equal(start.disabled, true);
  await act(async () => pendingLocalStart());
  assert.doesNotMatch(document.querySelector(".applications").textContent, /missing-app/);
});

test("Projects starts local files without upload and keeps navigation locked until verification finishes", async () => {
  await go("Projetos");
  const start = [...document.querySelectorAll("main button")].find(button => button.textContent.trim() === "Iniciar sem build");
  assert.ok(start);
  const uploads = requests.filter(row => row.method === "POST" && row.url.includes("/builds")).length;
  const starts = requests.filter(row => row.url.endsWith("/start")).length;
  await act(async () => { start.click(); start.click(); });
  assert.equal(requests.filter(row => row.url.endsWith("/start")).length, starts + 1);
  assert.equal(navigation("Home").disabled, true);
  assert.equal(start.disabled, true);
  await act(async () => pendingLocalStart());
  assert.equal(navigation("Home").disabled, false);
  assert.match(document.querySelector("main").textContent, /Aplicações iniciadas com os arquivos locais/);
  assert.equal(requests.filter(row => row.method === "POST" && row.url.includes("/builds")).length, uploads);
  await go("Home");
});

test("an authenticated user can still navigate when PM2 cannot be reached", async () => {
  failProcesses = true;
  const refresh = [...document.querySelectorAll("main button")].find(
    (button) => button.textContent.trim() === "Atualizar",
  );
  await act(async () => refresh.click());
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /PM2 indisponível/,
  );
  assert.match(
    document.querySelector(".overview-metrics").textContent,
    /Indisponível/,
  );
  await go("Projetos");
  assert.ok(document.querySelector(".project-grid"));
  // A falha no primeiro carregamento tambem deve deixar a navegacao acessivel.
  await act(async () =>
    root.render(createElement(App, { key: "initial-pm2-outage" })),
  );
  assert.equal(document.querySelector("h1").textContent, "Olá, tester");
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /PM2 indisponível/,
  );
  await go("Usuários");
});

test("SSE closes on remount and session expiry returns to login", async () => {
  const previous = streams.at(-1);
  await act(async () =>
    root.render(createElement(App, { key: "stream-session" })),
  );
  assert.equal(previous.readyState, EventSource.CLOSED);
  const current = streams.at(-1);
  await act(async () => current.emit("session-expired", {}));
  assert.equal(current.readyState, EventSource.CLOSED);
  assert.ok(document.querySelector("#login-title"));
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /sessão expirou/,
  );
});
