import { createApp } from '../server/src/app.js';

const { app, close } = createApp({ scheduler: { readIntervalMs: 20, addIntervalMs: 100 } });
const server = app.listen(3100, '127.0.0.1');
process.on('SIGTERM', () => { close(); server.close(); });
process.on('SIGINT', () => { close(); server.close(); });
