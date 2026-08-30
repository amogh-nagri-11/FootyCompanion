import Fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { wsRoutes } from './routes/ws.js';
import { matchRoutes } from './routes/matches.js';
import { profileRoutes } from './routes/profile.js';
import { followRoutes } from './routes/follows.js';
import { fplRoutes } from './routes/fpl.js';

const app = Fastify({ logger: true });

// The frontend runs on a different origin in dev (Vite on 5173), so the REST
// routes need CORS. Websockets are not subject to it.
app.register(cors, {
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type'],
});
app.register(websocketPlugin);
app.register(healthRoutes);
app.register(wsRoutes);
app.register(matchRoutes);
app.register(profileRoutes);
app.register(followRoutes);
app.register(fplRoutes);

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});