import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({ output: 'server', server: { port: 4324 }, adapter: node({ mode: 'standalone' }), devToolbar: { enabled: false } });
