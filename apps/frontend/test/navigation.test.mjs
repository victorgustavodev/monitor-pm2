import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { act, createElement } from 'react';

let vite, dom, root, App;
let failProcesses = false;
let pendingUser;
let pendingAction;
const requests = [];
const streams = [];
const intervals = [];
const processes = [
  { id: 1, name: 'api-service', status: 'online', pid: 100, cpu: 1, memory: 100 * 1024 * 1024, uptime: Date.now(), restarts: 0, mode: 'fork', version: '1.0', ports: [3000], portSource: 'listening' },
  { id: 2, name: 'web-service', status: 'stopped', pid: 0, cpu: 0, memory: 0, uptime: null, restarts: 1, mode: 'fork', version: '1.0', ports: [5500], portSource: 'configured' },
];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:4170' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  globalThis.EventSource = class extends dom.window.EventTarget {
    static CLOSED = 2;
    readyState = 1;
    constructor(url) {
      super();
      assert.equal(url, '/api/processes/stream');
      streams.push(this);
    }
    close() { this.readyState = 2; }
    emit(type, data) { this.dispatchEvent(new dom.window.MessageEvent(type, { data: JSON.stringify(data) })); }
  };
  const originalInterval = dom.window.setInterval.bind(dom.window);
  dom.window.setInterval = (callback, delay, ...args) => {
    intervals.push(delay);
    return originalInterval(callback, delay, ...args);
  };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (url === '/api/auth/me') return json({ username: 'tester', authenticated: true });
    if (url === '/api/processes') return failProcesses ? json({ message: 'PM2 indisponível.' }, 502) : json(processes);
    if (url === '/api/processes/1/restart' && options.method === 'POST') return new Promise((resolve) => { pendingAction = () => resolve(new Response(null, { status: 204 })); });
    if (String(url).startsWith('/api/processes/1/logs?')) return json({ logs: 'Log de teste da aplicação.' });
    if (url === '/api/users' && options.method === 'POST') return new Promise((resolve) => { pendingUser = () => resolve(json({ id: 'new-user', username: 'operador' }, 201)); });
    if (url === '/api/users') return json([{ id: 'tester', username: 'tester', createdAt: '2026-01-01T00:00:00Z' }]);
    if (url === '/api/versions') return json([]);
    if (String(url).startsWith('/api/logs?')) return json([{ _id: 'audit', kind: 'audit', createdAt: '2026-01-01T00:00:00Z', username: 'tester', method: 'POST', path: '/api/auth/login', status: 200 }]);
    throw new Error(`Unexpected API request: ${url}`);
  };
  vite = await createServer({
    configLoader: 'runner', server: { middlewareMode: true, watch: null }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ App } = await vite.ssrLoadModule('/src/app/App.tsx'));
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(createElement(App)); });
}, { timeout: 30000 });

after(async () => {
  if (root) await act(async () => root.unmount());
  await vite?.close();
  dom?.window.close();
});

function navigation(label) {
  return [...document.querySelectorAll('nav[aria-label="Navegação principal"] button')].find((button) => button.querySelector('span')?.textContent === label);
}

test('SSE applies metric updates and PM2 recovery without polling, and detects connection loss', async () => {
  assert.equal(streams.length, 1);
  assert.ok(!intervals.includes(10_000));
  const requestCount = requests.filter((request) => request.url === '/api/processes').length;
  const stream = streams.at(-1);
  const updated = processes.map((process) => ({ ...process, cpu: 25 }));
  await act(async () => stream.emit('processes', updated));
  assert.match(document.querySelector('.overview-metrics').textContent, /50.0%/);
  await act(async () => stream.emit('metrics-error', { message: 'PM2 indisponível.' }));
  assert.match(document.querySelector('[role="alert"]').textContent, /PM2 indisponível/);
  assert.match(document.querySelector('.overview-metrics').textContent, /Indisponível/);
  await act(async () => stream.emit('processes', processes));
  assert.equal(document.querySelector('[role="alert"]'), null);
  await act(async () => stream.onerror());
  assert.match(document.querySelector('[role="alert"]').textContent, /Tentando reconectar/);
  await act(async () => stream.emit('processes', processes));
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(requests.filter((request) => request.url === '/api/processes').length, requestCount);
});
async function go(label) {
  const button = navigation(label);
  assert.ok(button, label);
  await act(async () => button.click());
  assert.equal(navigation(label).getAttribute('aria-current'), 'page');
  assert.equal(document.querySelector('h1').textContent, label);
}

test('sidebar exposes six working destinations and the overview uses real process data', async () => {
  assert.equal(document.querySelectorAll('nav button').length, 6);
  assert.equal(document.querySelector('h1').textContent, 'Visão geral');
  assert.ok(document.querySelector('.sidebar-logo[alt="KPMG"]'));
  assert.match(document.querySelector('.sidebar-account').textContent, /tester/);
  assert.equal(document.querySelectorAll('.metric-card').length, 4);
  assert.match(document.querySelector('.overview-metrics').textContent, /1\/2/);
  assert.match(document.querySelector('.overview-processes').textContent, /api-service/);
  assert.match(document.querySelector('.overview-processes').textContent, /5500 \(configurada\)/);
  await go('Processos');
  assert.ok([...document.querySelectorAll('th')].some((cell) => cell.textContent === 'Porta'));
  assert.match(document.querySelector('tbody').textContent, /3000/);
  assert.ok(document.querySelector('[title="Reiniciar"]'));
  await go('Logs');
  assert.match(document.querySelector('main').textContent, /POST \/api\/auth\/login/);
  await go('Usuários');
  assert.ok(document.querySelector('input[name="username"]'));
  await go('Builds');
  assert.equal(document.querySelector('input[type="file"]').accept, '.rar');
  assert.ok(requests.some((request) => request.url === '/api/versions'));
  await go('Configurações');
  assert.match(document.querySelector('main').textContent, /http:\/\/localhost:4170/);
  const autoRefresh = document.querySelector('input[type="checkbox"]');
  assert.equal(autoRefresh.checked, true);
  await act(async () => autoRefresh.click());
  assert.equal(streams.at(-1).readyState, EventSource.CLOSED);
  assert.match(document.querySelector('.dashboard-sync').textContent, /pausada/);
  await go('Visão geral');
});

test('list and cards share the search and restore the saved layout after remounting', async () => {
  await go('Processos');
  const layoutButton = (label) => [...document.querySelectorAll('[aria-label="Visualização das aplicações"] button')].find((button) => button.textContent === label);
  assert.equal(layoutButton('Lista').getAttribute('aria-pressed'), 'true');
  await act(async () => layoutButton('Cards').click());
  assert.equal(layoutButton('Cards').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelectorAll('.application-card').length, 2);
  const apiCard = document.querySelector('[aria-label="Aplicação api-service"]');
  assert.match(apiCard.textContent, /3000/);
  assert.match(apiCard.textContent, /100\.0 MB/);
  assert.match(apiCard.textContent, /1\.0%/);
  assert.match(document.querySelector('[aria-label="Aplicação web-service"]').textContent, /Configurada/);
  assert.equal(dom.window.localStorage.getItem('monitor-pm2:applications-layout'), 'cards');

  const search = document.querySelector('input[aria-label="Buscar processo"]');
  const setInput = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setInput.call(search, 'web');
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelectorAll('.application-card').length, 1);
  assert.match(document.querySelector('.applications-count').textContent, /1 de 2/);
  await act(async () => layoutButton('Lista').click());
  assert.equal(document.querySelectorAll('tbody tr').length, 1);
  assert.match(document.querySelector('tbody').textContent, /web-service/);
  await act(async () => {
    setInput.call(search, '');
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelectorAll('tbody tr').length, 2);
  await act(async () => layoutButton('Cards').click());
  await go('Logs');
  await go('Processos');
  assert.equal(layoutButton('Cards').getAttribute('aria-pressed'), 'true');
  await act(async () => root.render(createElement(App, { key: 'restore-layout' })));
  await go('Processos');
  assert.equal(layoutButton('Cards').getAttribute('aria-pressed'), 'true');
  await go('Visão geral');
});

test('cards open the process dialog and logs, and keep actions locked when switching layouts during a restart', async () => {
  await go('Processos');
  await act(async () => document.querySelector('[aria-label="Adicionar novo processo"]').click());
  const dialog = document.querySelector('dialog[aria-labelledby="add-process-title"]');
  assert.ok(dialog.hasAttribute('open'));
  await act(async () => dialog.querySelector('[aria-label="Fechar"]').click());
  assert.ok(!dialog.hasAttribute('open'));
  assert.ok(!requests.some((request) => request.url === '/api/ecosystems' && request.method === 'POST'));
  await act(async () => document.querySelector('[aria-label="Ver logs de api-service"]').click());
  assert.match(document.querySelector('[role="dialog"][aria-label="Logs de api-service"]').textContent, /Log de teste/);
  await act(async () => document.querySelector('[aria-label="Fechar logs"]').click());
  await act(async () => document.querySelector('[aria-label="Reiniciar api-service"]').click());
  assert.ok(pendingAction);
  assert.ok([...document.querySelectorAll('.process-action')].every((button) => button.disabled));
  const layoutButton = (label) => [...document.querySelectorAll('[aria-label="Visualização das aplicações"] button')].find((button) => button.textContent === label);
  await act(async () => layoutButton('Lista').click());
  assert.ok(document.querySelector('table'));
  assert.equal(document.querySelector('[aria-label="Reiniciar api-service"]').disabled, true);
  await act(async () => layoutButton('Cards').click());
  assert.equal(document.querySelector('[aria-label="Reiniciar api-service"]').disabled, true);
  await act(async () => pendingAction());
  assert.ok([...document.querySelectorAll('.process-action')].every((button) => !button.disabled));
  assert.equal(requests.filter((request) => request.url === '/api/processes/1/restart').length, 1);
  await go('Visão geral');
});

test('navigation stays disabled while a user creation is pending and returns afterward', async () => {
  await go('Usuários');
  document.querySelector('input[name="username"]').value = 'operador';
  document.querySelector('input[name="password"]').value = 'test-password-12345';
  const form = document.querySelector('main form');
  await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.ok(pendingUser);
  assert.ok([...document.querySelectorAll('nav button')].every((button) => button.disabled));
  await act(async () => pendingUser());
  assert.ok([...document.querySelectorAll('nav button')].every((button) => !button.disabled));
  assert.match(document.querySelector('main').textContent, /Usuário criado/);
  await go('Visão geral');
});

test('an authenticated user can still navigate when PM2 cannot be reached', async () => {
  failProcesses = true;
  const refresh = [...document.querySelectorAll('main button')].find((button) => button.textContent.trim() === 'Atualizar');
  await act(async () => refresh.click());
  assert.match(document.querySelector('[role="alert"]').textContent, /PM2 indisponível/);
  assert.match(document.querySelector('.overview-metrics').textContent, /Indisponível/);
  await go('Builds');
  assert.ok(document.querySelector('input[type="file"]'));
  // A falha no primeiro carregamento tambem deve deixar a navegacao acessivel.
  await act(async () => root.render(createElement(App, { key: 'initial-pm2-outage' })));
  assert.equal(document.querySelector('h1').textContent, 'Visão geral');
  assert.match(document.querySelector('[role="alert"]').textContent, /PM2 indisponível/);
  await go('Usuários');
});

test('SSE closes on remount and session expiry returns to login', async () => {
  const previous = streams.at(-1);
  await act(async () => root.render(createElement(App, { key: 'stream-session' })));
  assert.equal(previous.readyState, EventSource.CLOSED);
  const current = streams.at(-1);
  await act(async () => current.emit('session-expired', {}));
  assert.equal(current.readyState, EventSource.CLOSED);
  assert.ok(document.querySelector('#login-title'));
  assert.match(document.querySelector('[role="alert"]').textContent, /sessão expirou/);
});
