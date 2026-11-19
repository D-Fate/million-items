import express, { type ErrorRequestHandler, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { AppError, invalid } from './errors.js';
import { BatchScheduler, type SchedulerOptions } from './scheduler.js';
import { ItemStore } from './store.js';
import { parseBody, parseId, parseListQuery, parseMove } from './validation.js';

export interface AppOptions {
  initialCount?: number;
  scheduler?: SchedulerOptions;
  staticDirectory?: string;
  maxConnections?: number;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = new ItemStore(options.initialCount);
  const scheduler = new BatchScheduler(options.scheduler);
  let pendingRequests = 0;

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'style-src': ["'self'", "'unsafe-inline'"] } } }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', queues: scheduler.stats() }));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (pendingRequests >= (options.maxConnections ?? 2000)) {
      next(new AppError(429, 'TOO_MANY_REQUESTS', 'Слишком много запросов. Повторите позже.'));
      return;
    }
    pendingRequests++;
    let released = false;
    const release = () => { if (!released) { released = true; pendingRequests--; } };
    res.once('finish', release);
    res.once('close', release);
    next();
  });
  app.use(express.json({ limit: '4kb' }));

  app.get('/api/items', async (req, res) => {
    const query = parseListQuery(req.query);
    const page = await scheduler.enqueue(`list:${JSON.stringify(query)}`, () => store.list(query));
    res.json(page);
  });

  app.post('/api/items', async (req, res) => {
    const id = parseId(parseBody(req.body)['id']);
    const result = await scheduler.add(id, () => store.add(id));
    res.status(201).json(result);
  });

  app.put('/api/selection', async (req, res) => {
    const body = parseBody(req.body);
    const id = parseId(body['id']);
    const selected = body['selected'];
    if (typeof selected !== 'boolean') invalid('Поле selected должно быть логическим значением.');
    const result = await scheduler.enqueue(`select:${JSON.stringify([id, selected])}`, () => store.select(id, selected), true);
    res.json(result);
  });

  app.post('/api/selection/move', async (req, res) => {
    const move = parseMove(req.body);
    const result = await scheduler.enqueue(`move:${JSON.stringify(move)}`, () => store.move(move), true);
    res.json(result);
  });

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Маршрут не найден.')));

  const staticDirectory = options.staticDirectory ?? resolve('dist/client/browser');
  if (existsSync(resolve(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(staticDirectory, 'index.html'));
    });
  }

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    let failure = error;
    if (error instanceof SyntaxError && 'body' in error) {
      failure = new AppError(400, 'INVALID_JSON', 'Некорректный JSON.');
    } else if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
      failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Слишком большой запрос.');
    }
    if (failure instanceof AppError) {
      if (failure.status === 429 || failure.status === 503) res.setHeader('Retry-After', '10');
      res.status(failure.status).json({ error: { code: failure.code, message: failure.message } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Не удалось обработать запрос.' } });
  };
  app.use(errorHandler);

  return { app, store, scheduler, close: () => scheduler.close() };
}
