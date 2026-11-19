import { createApp } from './app.js';

const port = Number(process.env['PORT'] ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

const { app, close } = createApp();
const server = app.listen({ port, host: '0.0.0.0', backlog: 2048 }, () => console.info(`Listening on http://localhost:${port}`));
server.requestTimeout = 75_000;
server.headersTimeout = 10_000;
server.setTimeout(75_000);

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
