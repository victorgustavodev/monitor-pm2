import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { act, createElement } from "react";

let vite, dom, root, App;
let failProcesses = false;
let sessionRole = "admin";
let pendingUser;
let pendingAction;
let pendingLink, failLink = false, failProjectChoices = false;
let pendingLabel,
  labelSaveCount = 0;
let pendingProjectBuild;
let pendingPublication;
let pendingSettings;
let pendingProjectUpdate, pendingProjectDelete;
let retention = {
  enabled: false,
  retentionDays: 30,
  intervalHours: 24,
  nextRunAt: null,
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
        if (url.includes("/build-operations/")) buildStreams.push(this);
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
      url = String(url).replace(/\?operationId=.*$/, "");
      if (url.endsWith("/build-operations") && options.method === "POST") return json({ id: "operation-1", percent: 0, stage: "Enviando pacote", status: "running", cancellable: true, logs: [] }, 201);
      if (url.endsWith("/operation-1/cancel")) return json({ id: "operation-1", percent: 60, stage: "Cancelando", status: "running", cancellable: false, logs: [] });
      if (/\/builds\/[^/]+\/deploy$/.test(url) && options.method === "POST") return new Promise(done => { pendingPublication = (status, message) => done(json({ message }, status)); });
      if (url === "/api/auth/me")
        return json({
          username: "tester",
          authenticated: true,
          role: sessionRole,
        });
      if (url === "/api/processes")
        return failProcesses
          ? json({ message: "PM2 indisponível." }, 502)
          : json(processes);
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
      if (url === "/api/processes/1/restart" && options.method === "POST")
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
            createdAt: "2026-01-01T00:00:00Z",
          },
        ]);
      if (url === "/api/versions") return json([]);
      if (url === "/api/settings/retention" && options.method === "PUT")
        return new Promise((done) => {
          pendingSettings = () => {
            retention = {
              ...retention,
              ...JSON.parse(options.body),
              nextRunAt: "2026-11-07T15:00:00Z",
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
            done(json(build, 201));
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
    (button) => button.querySelector("span")?.textContent === label,
  );
}

test("SSE applies metric updates and PM2 recovery without polling, and detects connection loss", async () => {
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
  assert.equal(document.querySelectorAll("nav button").length, 3);
  assert.equal(navigation("Usuários"), undefined);
  assert.equal(document.querySelector("h1").textContent, "Olá, tester");
  const settingsToggle = document.querySelector('[aria-controls="sidebar-settings-menu"]');
  await act(async () => settingsToggle.click());
  assert.equal(settingsToggle.getAttribute("aria-expanded"), "true");
  assert.ok(navigation("Logs"));
  assert.ok(navigation("Usuários"));
  assert.equal(document.querySelector("h1").textContent, "Olá, tester");
  await act(async () => settingsToggle.click());
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
    /pausada/,
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
  assert.ok(document.querySelector(".build-progress-modal[open]"));
  await act(async () => buildStreams.at(-1).emit("progress", { id: "operation-1", percent: 60, stage: "Atualizando arquivos do projeto", status: "running", cancellable: true, logs: ["Pacote recebido"] }));
  assert.equal(document.querySelector(".build-progress-modal progress").value, 60);
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
  assert.equal(document.querySelector(".build-progress-modal progress").value, 100);
  await act(async () => button("Fechar").click());
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
    rootPath: "C:\\servicos\\ProjetoY",
    pm2ConfigPath: "ecosystem.config.js",
    pm2ConfigContent: "",
  });
  await go("Home");
});

test("publication modal waits for server cancellation and keeps PM2 failures visible", async () => {
  await go("Projetos");
  const projectButton = text => [...document.querySelectorAll("main button")].find(button => button.textContent.trim() === text);
  await act(async () => projectButton("Todos os projetos").click());
  await act(async () => projectButton("Projeto X").click());
  await act(async () => document.querySelector("#project-tab-builds").click());
  const publish = () => document.querySelector('.build-history button[aria-label^="Publicar "]');
  const modalButton = text => [...document.querySelectorAll('.build-progress-modal button')].find(button => button.textContent.trim() === text);
  await act(async () => publish().click());
  await act(async () => buildStreams.at(-1).emit("progress", { id: "operation-1", percent: 60, stage: "Copying", status: "running", cancellable: true, logs: ["Package received"] }));
  await act(async () => modalButton("Cancelar build").click());
  assert.ok(requests.some(request => request.url.endsWith("/operation-1/cancel")));
  assert.equal(document.querySelector('.build-progress-modal button').disabled, true);
  assert.ok([...document.querySelectorAll('nav[aria-label] button')].some(button => button.disabled));
  await act(async () => pendingPublication(409, "Cancelled; files restored"));
  assert.equal(document.querySelector('.build-progress-modal pre'), null);
  await act(async () => modalButton("Fechar").click());
  await act(async () => publish().click());
  await act(async () => buildStreams.at(-1).emit("progress", { id: "operation-1", percent: 85, stage: "PM2", status: "running", cancellable: false, logs: [] }));
  assert.equal(modalButton("Cancelar build").disabled, true);
  await act(async () => pendingPublication(502, "Script not found: <script>main.js</script>"));
  assert.ok(document.querySelector('.build-progress-modal[open]'));
  assert.match(document.querySelector('.build-progress-modal pre').textContent, /Script not found/);
  assert.equal(document.querySelector('.build-progress-modal script'), null);
  await act(async () => modalButton("Fechar").click());
});

test("Home list and cards show plain port numbers without access links", async () => {
  for (const view of ["Home", "Home"]) {
    await go(view);
    const ports = [...document.querySelectorAll(".process-port")];
    assert.ok(
      ports.some(
        (port) => port.querySelector(".font-mono")?.textContent === "3000",
      ),
    );
    assert.ok(ports.every((port) => !port.querySelector("a, details")));
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
  await go("Home");
});

test("retention preferences persist and block navigation while saving", async () => {
  await go("Configurações");
  const form = document.querySelector(".retention-form");
  assert.ok(form);
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
    setInput.call(form.querySelector('[name="intervalHours"]'), "6");
    form
      .querySelector('[name="intervalHours"]')
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
    { enabled: true, retentionDays: 14, intervalHours: 6 },
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
    /Keep versions for/,
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
  form.querySelector('[name="name"]').value = "Projeto Y atualizado";
  form.querySelector('[name="description"]').value = "Nova descrição";
  form.querySelector('[name="rootPath"]').value =
    "C:\\servicos\\ProjetoY-atualizado";
  form.querySelector('[name="pm2ConfigPath"]').value =
    "config/ecosystem.config.js";
  form.querySelector('[name="pm2ConfigContent"]').value =
    'module.exports = { apps: [{ name: "app", script: "./main.js" }] };';
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
    rootPath: "C:\\servicos\\ProjetoY-atualizado",
    pm2ConfigPath: "config/ecosystem.config.js",
    pm2ConfigContent:
      'module.exports = { apps: [{ name: "app", script: "./main.js" }] };',
  });
  assert.equal(
    document.querySelector('[name="pm2ConfigContent"]').value,
    JSON.parse(saved.body).pm2ConfigContent,
  );
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
