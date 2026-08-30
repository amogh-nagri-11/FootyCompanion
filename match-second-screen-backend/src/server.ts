import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { wsRoutes } from './routes/ws.js';

const app = Fastify({ logger: true });

app.register(websocketPlugin);
app.register(healthRoutes);
app.register(wsRoutes);

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});