import Fastify from 'fastify';
import { registerAuth, type AuthOptions } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { songRoutes } from './routes/songs.js';

export async function buildApp(opts: AuthOptions & { logger?: boolean }) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });

  await registerAuth(app, opts);
  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(songRoutes);

  return app;
}
