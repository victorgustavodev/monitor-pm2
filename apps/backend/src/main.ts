import compression from 'compression';
import express, { type ErrorRequestHandler } from 'express';
import { resolve, sep } from 'node:path';
import { authenticate, createSession, sessionCookie, validateLogin } from './auth';
import { env } from './config';
import { HttpError } from './http-error';
import { networkOnly } from './network';
import { listProcesses, processAction, processLogs, pickEcosystem, startEcosystem, type ProcessAction } from './pm2';

const app = express();
const frontendPath = resolve(__dirname, '..', 'frontend');
const actions = new Set<ProcessAction>(['start', 'restart', 'stop', 'delete']);

app.disable('x-powered-by');
app.use(compression());
app.use((_request, response, next) => {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use('/api', networkOnly, express.json({ limit: '4kb' }), (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_request, response) => response.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.post('/api/auth/login', (request, response) => {
  const username = validateLogin(request.ip || request.socket.remoteAddress || 'unknown', request.body?.username, request.body?.password);
  response.cookie('pm2_session', createSession(username), sessionCookie).json({ username });
});
app.post('/api/auth/logout', authenticate, (_request, response) => {
  response.clearCookie('pm2_session', { path: '/' }).status(204).end();
});
app.get('/api/auth/me', authenticate, (_request, response) => response.json({ authenticated: true }));

app.get('/api/processes', authenticate, async (_request, response) => response.json(await listProcesses()));
app.post('/api/ecosystems/pick', authenticate, async (_request, response) => {
  response.json({ path: await pickEcosystem() });
});
app.post('/api/ecosystems', authenticate, async (request, response) => {
  await startEcosystem(request.body?.path);
  response.status(204).end();
});
app.get('/api/processes/:id/logs', authenticate, async (request, response) => {
  response.json({ logs: await processLogs(parseId(request.params.id), Number(request.query.lines ?? 100)) });
});
app.post('/api/processes/:id/:action', authenticate, async (request, response) => {
  const action = request.params.action as ProcessAction;
  if (!actions.has(action)) throw new HttpError(400, 'Ação inválida.');
  await processAction(parseId(request.params.id), action);
  response.status(204).end();
});

app.use('/api', (_request, _response, next) => next(new HttpError(404, 'Rota não encontrada.')));
app.use(express.static(frontendPath, {
  etag: true,
  index: 'index.html',
  setHeaders: (response, filePath) => {
    response.setHeader(
      'Cache-Control',
      filePath.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  },
}));
app.use((_request, response) => response.sendFile(resolve(frontendPath, 'index.html')));

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) return void response.status(error.status).json({ message: error.message });
  if (error instanceof SyntaxError && 'body' in error) return void response.status(400).json({ message: 'JSON inválido.' });
  console.error(error);
  response.status(500).json({ message: 'Erro interno do servidor.' });
};
app.use(errorHandler);

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new HttpError(400, 'ID de processo inválido.');
  return id;
}

const server = app.listen(env.port, env.host, () => {
  console.log(`ati-dev-cockpit disponível em http://${env.host}:${env.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
