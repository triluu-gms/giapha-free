// Local / long-running server entry point. On Vercel, api/index.ts is used instead.
import app from './app';
import { config } from './config';
import { closeDriver } from './db';

const server = app.listen(config.port, () => {
  console.log(`Family Tree API listening on http://localhost:${config.port}`);
});

const shutdown = () => {
  server.close(() => {
    void closeDriver().finally(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
