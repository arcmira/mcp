import { register } from 'node:module';
register('./hooks/cloudflare-workers.mjs', import.meta.url);
