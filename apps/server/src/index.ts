import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async (signal: string) => {
  app.fastify.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.fastify.listen({ port: config.port, host: config.host });
