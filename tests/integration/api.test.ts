import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/src/app.js';

describe('HTTP API', () => {
  let runtime: ReturnType<typeof createApp>;
  beforeEach(() => { runtime = createApp({ initialCount: 1000, scheduler: { readIntervalMs: 10, addIntervalMs: 50 } }); });
  afterEach(() => runtime.close());

  it('returns twenty items even when a client requests a larger limit', async () => {
    const response = await request(runtime.app).get('/api/items?side=available&limit=1000000');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(20);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('handles concurrent duplicate creation once', async () => {
    const responses = await Promise.all(Array.from({ length: 100 }, () => request(runtime.app).post('/api/items').send({ id: 'new-item' })));
    expect(responses.every(response => response.status === 201 || response.status === 409)).toBe(true);
    expect(responses.some(response => response.status === 201)).toBe(true);
    expect(runtime.store.state().totals.all).toBe(1001);
    const page = await request(runtime.app).get('/api/items').query({ side: 'available', q: 'new-item' });
    expect(page.body.items).toEqual(['new-item']);
    expect((await request(runtime.app).post('/api/items').send({ id: 'new-item' })).status).toBe(409);
  });

  it('normalizes whitespace before the uniqueness check', async () => {
    expect((await request(runtime.app).post('/api/items').send({ id: ' 1 ' })).status).toBe(409);
    expect((await request(runtime.app).post('/api/items').send({ id: '  hello  ' })).status).toBe(201);
    expect((await request(runtime.app).post('/api/items').send({ id: 'hello' })).status).toBe(409);
  });

  it('keeps selection idempotent under concurrent requests', async () => {
    const responses = await Promise.all(Array.from({ length: 80 }, () => request(runtime.app).put('/api/selection').send({ id: '10', selected: true })));
    expect(responses.every(response => response.status === 200)).toBe(true);
    const page = await request(runtime.app).get('/api/items?side=selected');
    expect(page.body.items).toEqual(['10']);
    expect(page.body.totals.selected).toBe(1);
  });

  it('saves selection and ordering across independent clients', async () => {
    for (const id of ['1', '2', '11']) await request(runtime.app).put('/api/selection').send({ id, selected: true });
    const before = await request(runtime.app).get('/api/items?side=selected&q=1');
    const moved = await request(runtime.app).post('/api/selection/move').send({ id: '11', targetId: '1', placement: 'before', revision: before.body.revision });
    expect(moved.status).toBe(200);
    expect((await request(runtime.app).get('/api/items?side=selected')).body.items).toEqual(['11', '1', '2']);
    const conflict = await request(runtime.app).post('/api/selection/move').send({ id: '11', targetId: '1', placement: 'after', revision: before.body.revision });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('STALE_REVISION');
  });

  it.each([null, {}, [], { id: 1 }, { id: '' }, { id: '   ' }, { id: '\u0000' }, { id: 'x'.repeat(129) }].map(payload => [payload]))('rejects invalid creation payload %j', async payload => {
    const response = await request(runtime.app).post('/api/items').set('Content-Type', 'application/json').send(JSON.stringify(payload));
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('validates filters, selection flags, JSON size and unknown routes', async () => {
    expect((await request(runtime.app).get('/api/items?side=wrong')).status).toBe(400);
    expect((await request(runtime.app).get('/api/items?side=available&q=a&q=b')).status).toBe(400);
    expect((await request(runtime.app).put('/api/selection').send({ id: '1', selected: 'true' })).status).toBe(400);
    expect((await request(runtime.app).put('/api/selection').send({ id: 'unknown', selected: true })).status).toBe(404);
    expect((await request(runtime.app).post('/api/items').send({ id: 'x'.repeat(5000) })).status).toBe(413);
    expect((await request(runtime.app).post('/api/items').set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
    expect((await request(runtime.app).get('/api/unknown')).status).toBe(404);
  });

  it('keeps health checks available when the queue is full', async () => {
    runtime.close();
    runtime = createApp({ scheduler: { queueLimit: 1, readIntervalMs: 100 }, maxConnections: 10 });
    const pending = request(runtime.app).get('/api/items?side=available&q=1').then(response => response);
    await new Promise(resolve => setTimeout(resolve, 20));
    const rejected = await request(runtime.app).get('/api/items?side=available&q=2');
    expect(rejected.status).toBe(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect((await request(runtime.app).get('/api/health')).status).toBe(200);
    expect((await pending).status).toBe(200);
  });
});
