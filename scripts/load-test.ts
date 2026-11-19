import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Agent, request as httpRequest } from 'node:http';
import { createApp } from '../server/src/app.js';

const runtime = createApp();
const server = runtime.app.listen(0);
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Server did not start');
const base = `http://127.0.0.1:${address.port}`;
const agent = new Agent({ keepAlive: true, maxSockets: 100 });

function send(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${base}${path}`, {
      agent, method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try { resolve({ ok: response.statusCode! < 400, status: response.statusCode!, body: JSON.parse(text) }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(70_000, () => request.destroy(new Error('Request timed out')));
    request.end(init?.body as string | undefined);
  });
}

async function wave(name: string, count: number, path: string, init?: RequestInit) {
  const start = performance.now();
  const timings: number[] = [];
  const responses = await Promise.all(Array.from({ length: count }, async () => {
    const sent = performance.now();
    const response = await send(path, init);
    const body = response.body;
    timings.push(performance.now() - sent);
    assert(response.ok || (path === '/api/items' && response.status === 409 && body.error?.code === 'ID_EXISTS'), `${response.status}: ${JSON.stringify(body)}`);
    return body;
  }));
  timings.sort((a, b) => a - b);
  console.info(JSON.stringify({
    scenario: name, requests: count, maxConnections: 100, elapsedMs: Math.round(performance.now() - start),
    p50Ms: Math.round(timings[Math.floor(count * .5)]!),
    p95Ms: Math.round(timings[Math.floor(count * .95)]!),
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  }));
  return responses;
}

try {
  assert((await send('/api/health')).ok, 'Health check failed');
  console.info('Local server is ready.');
  const pages = await wave('500 identical reads', 500, '/api/items?side=available&q=999');
  assert(pages.every(page => page.items.length <= 20));
  await wave('300 repeated selections', 300, '/api/selection', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '1', selected: true }),
  });
  assert.equal(runtime.store.state().totals.selected, 1);
  await wave('200 duplicate additions', 200, '/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'load-test-item' }),
  });
  assert.equal(runtime.store.state().totals.all, 1_000_001);

  const start = performance.now();
  const mixed = await Promise.all(Array.from({ length: 100 }, (_, i) =>
    send(`/api/items?side=available&q=${encodeURIComponent(`no-result-${i}`)}`).then(response => {
      assert(response.ok);
      return response.body;
    }),
  ));
  assert(mixed.every(page => page.items.length === 0));
  console.info(JSON.stringify({ scenario: '100 distinct full-range searches', requests: 100, elapsedMs: Math.round(performance.now() - start), rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }));
  console.info('All load-test assertions passed.');
} finally {
  runtime.close();
  agent.destroy();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
