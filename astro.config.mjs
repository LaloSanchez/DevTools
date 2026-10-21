// @ts-check
import process from 'node:process';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// El sitemap y las URLs canónicas necesitan el dominio definitivo (SITE_URL).
// Sin él, el sitio compila igual, pero no genera sitemap ni URLs absolutas.
const site = process.env.SITE_URL?.replace(/\/+$/, '') || undefined;

export default defineConfig({
  site,
  integrations: [react(), ...(site ? [sitemap()] : [])],
  vite: {
    plugins: [tailwindcss()],
  },
});
