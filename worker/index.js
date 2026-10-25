/**
 * Cloudflare Workers entry point.
 *
 * The existing Express app runs on Workers' Node HTTP server. Only the data
 * layer changes: D1 is async, so `server/app.js` awaits every repository call
 * and `server/repos-d1.js` provides the D1 implementation.
 *
 * Static SPA files are served by Workers Assets (see wrangler.jsonc); only
 * `/api/*` invokes this Worker.
 */
import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';

import { createApp } from '../server/app.js';
import { createD1Repos } from '../server/repos-d1.js';
import { KNOWLEDGE_SEED } from '../server/knowledge-seed.js';

const PORT = 8787;

let app = null;
let ready = null;

const server = createServer((req, res) => {
  if (!app) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'The API is still starting. Retry in a moment.' } }));
    return;
  }
  app(req, res);
});
server.listen(PORT);

async function initialise(env) {
  if (!env?.DB) {
    throw new Error(
      'D1 binding "DB" is missing. Create the database and set d1_databases[0].database_id in wrangler.jsonc.'
    );
  }

  if (!ready) {
    ready = (async () => {
      const repos = createD1Repos(env.DB);

      await repos.auth.purgeExpired();
      await repos.auth.seedSecretsFromEnv({
        adminPin: (env.ADMIN_PIN || '').trim(),
        studentPasscode: (env.STUDENT_PASSCODE || '').trim(),
      });

      // A fresh D1 database gets the built-in study bank on first request.
      // An imported database already has it, so avoid 180 writes per cold start.
      const existing = await repos.knowledge.list();
      if (existing.length < 100) {
        const seeded = await repos.knowledge.seed(KNOWLEDGE_SEED);
        console.log(`Knowledge base: +${seeded.added} Q&A seeded, ${seeded.updated} updated`);
      }

      app = createApp({
        repos,
        config: {
          zoomAccountId: env.ZOOM_ACCOUNT_ID,
          zoomClientId: env.ZOOM_CLIENT_ID,
          zoomClientSecret: env.ZOOM_CLIENT_SECRET,
          rosterCacheMs: env.ROSTER_CACHE_MS,
        },
      });
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }

  return ready;
}

export default {
  async fetch(request, env) {
    try {
      await initialise(env);
    } catch (err) {
      return Response.json(
        { error: { message: err.message || 'The API could not start.' } },
        { status: 500 }
      );
    }
    return handleAsNodeRequest(PORT, request);
  },
};
