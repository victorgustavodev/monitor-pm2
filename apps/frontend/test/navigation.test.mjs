import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { act, createElement } from "react";

let vite, dom, root, App;
let failProcesses = false;
let pendingUser;
let pendingAction;
let pendingProjectBuild;
let pendingSettings;
let retention = { enabled: false, retentionDays: 30, intervalHours: 24, nextRunAt: null };
const projectRows = [
  {
    _id: "111111111111111111111111",
    name: "Projeto X",
    description: "Aplicação principal",
    rootPath: "C:\\servicos\\ProjetoX",
    pm2ConfigPath: "ecosystem.config.js",
    pathToRunPm2: "C:\\servicos\\ProjetoX\\ecosystem.config.js",
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
        assert.equal(url, "/api/processes/stream");
        streams.push(this);
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
      if (url === "/api/auth/me")
        return json({ username: "tester", authenticated: true });
      if (url === "/api/processes")
        return failProcesses
          ? json({ message: "PM2 indisponível." }, 502)
          : json(processes);
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
      if (url === '/api/settings/retention' && options.method === 'PUT') return new Promise((done) => {
        pendingSettings = () => { retention = { ...retention, ...JSON.parse(options.body), nextRunAt: '2026-11-07T15:00:00Z' }; done(json(retention)); };
      });
      if (url === '/api/settings/retention') return json(retention);
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
      if (url === "/api/projects") return json(projectRows);
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
  return [
    ...document.querySelectorAll(
      'nav.sidebar-nav button',
    ),
  ].find((button) => button.querySelector("span")?.textContent === label);
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
  const button = navigation(label);
  assert.ok(button, label);
  await act(async () => button.click());
  assert.equal(navigation(label).getAttribute("aria-current"), "page");
  assert.equal(document.querySelector("h1").textContent, label);
}

test("sidebar exposes seven working destinations and the overview uses real process data", async () => {
  assert.equal(document.querySelectorAll("nav button").length, 7);
  assert.equal(document.querySelector("h1").textContent, "Visão geral");
  assert.ok(document.querySelector('.sidebar-logo[alt="KPMG"]'));
  assert.match(
    document.querySelector(".sidebar-account").textContent,
    /tester/,
  );
  assert.equal(document.querySelectorAll(".metric-card").length, 4);
  assert.match(document.querySelector(".overview-metrics").textContent, /1\/2/);
  assert.match(
    document.querySelector(".overview-processes").textContent,
    /api-service/,
  );
  assert.match(
    document.querySelector(".overview-processes").textContent,
    /5500.*Configurada/,
  );
  await go("Processos");
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
  await go("Builds");
  assert.ok(document.querySelector('[aria-label="Histórico de builds"]'));
  await act(async () =>
    [...document.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.textContent === "Uploads avulsos")
      .click(),
  );
  assert.equal(
    document.querySelector('input[type="file"]').accept,
    ".zip,.rar,.7z,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tbz,.tar.xz,.txz",
  );
  assert.ok(requests.some((request) => request.url === "/api/versions"));
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
  await go("Visão geral");
});

test("list and cards share the search and restore the saved layout after remounting", async () => {
  await go("Processos");
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
  await go("Processos");
  assert.equal(layoutButton("Cards").getAttribute("aria-pressed"), "true");
  await act(async () =>
    root.render(createElement(App, { key: "restore-layout" })),
  );
  await go("Processos");
  assert.equal(layoutButton("Cards").getAttribute("aria-pressed"), "true");
  await go("Visão geral");
});

test("cards open the process dialog and logs, and keep actions locked when switching layouts during a restart", async () => {
  await go("Processos");
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
  await go("Visão geral");
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
  await go("Visão geral");
});

test("projects browse local files, publish builds with comments and expose them in the global history", async () => {
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
  await go("Builds");
  assert.match(
    document.querySelector(".build-history").textContent,
    /Projeto X/,
  );
  assert.match(
    document.querySelector(".build-history").textContent,
    /build-06-11-v1/,
  );
  await act(async () => button("Projeto X").click());
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
  });
  await go("Visão geral");
});

test('overview, list and cards show plain port numbers without access links', async () => {
  for (const view of ['Visão geral', 'Processos']) {
    await go(view);
    const ports = [...document.querySelectorAll('.process-port')];
    assert.ok(ports.some(port => port.querySelector('.font-mono')?.textContent === '3000'));
    assert.ok(ports.every(port => !port.querySelector('a, details')));
  }
  await act(async () => [...document.querySelectorAll('[aria-label="Visualização das aplicações"] button')].find(button => button.textContent === 'Cards').click());
  const cardPort = document.querySelector('.application-card .process-port');
  assert.equal(cardPort.querySelector('.font-mono').textContent, '3000');
  assert.equal(cardPort.querySelector('a, details'), null);
  await go('Visão geral');
});

test('retention preferences persist and block navigation while saving', async () => {
  await go('Configurações');
  const form = document.querySelector('.retention-form');
  assert.ok(form);
  assert.equal(form.querySelector('[name="retentionDays"]').disabled, true);
  await act(async () => form.querySelector('input[type="checkbox"]').click());
  const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setInput.call(form.querySelector('[name="retentionDays"]'), '14');
    form.querySelector('[name="retentionDays"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    setInput.call(form.querySelector('[name="intervalHours"]'), '6');
    form.querySelector('[name="intervalHours"]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(navigation('Projetos').disabled, true);
  await act(async () => pendingSettings());
  assert.deepEqual(JSON.parse(requests.findLast(request => request.url === '/api/settings/retention' && request.method === 'PUT').body), { enabled: true, retentionDays: 14, intervalHours: 6 });
  assert.equal(navigation('Projetos').disabled, false);
  await go('Visão geral'); await go('Configurações');
  assert.equal(document.querySelector('[name="retentionDays"]').value, '14');
});

test('English and Spanish translate navigation, settings and projects without losing session state', async () => {
  const selectLanguage = async (locale) => {
    const select = document.querySelector('select:has(option[value="pt-BR"])');
    await act(async () => { select.value = locale; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  };
  const streamCount = streams.length;
  await selectLanguage('en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(window.localStorage.getItem('monitor-pm2:locale'), 'en');
  assert.equal(document.querySelector('h1').textContent, 'Settings');
  assert.match(document.querySelector('.retention-form').textContent, /Keep versions for/);
  await go('Projects');
  assert.match(document.querySelector('main').textContent, /Create new build/);
  await go('Settings'); await selectLanguage('es');
  assert.equal(document.documentElement.lang, 'es');
  assert.equal(document.querySelector('h1').textContent, 'Configuración');
  await go('Proyectos'); assert.match(document.querySelector('main').textContent, /Crear nuevo build/);
  await go('Configuración'); await selectLanguage('pt-BR');
  assert.equal(document.querySelector('h1').textContent, 'Configurações');
  assert.equal(streams.length, streamCount);
  await go('Visão geral');
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
  await go("Builds");
  assert.ok(document.querySelector('[aria-label="Histórico de builds"]'));
  // A falha no primeiro carregamento tambem deve deixar a navegacao acessivel.
  await act(async () =>
    root.render(createElement(App, { key: "initial-pm2-outage" })),
  );
  assert.equal(document.querySelector("h1").textContent, "Visão geral");
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
