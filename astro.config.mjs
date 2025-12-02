// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
output: "server",
  integrations: [react()],
  site: "https://www.fennai.com",

  image: {
    domains: ["firebasestorage.googleapis.com", "localhost", "fennai.com"],
  },

  adapter: node({
    mode: "middleware",
  }),
});