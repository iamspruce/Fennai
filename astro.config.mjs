// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react()],
  site: "https://fennai.web.app",
  security: {
    checkOrigin: false,
  },

  image: {
    domains: [
      "firebasestorage.googleapis.com",
      "localhost",
      "fennai.com",
      "lh3.googleusercontent.com",
    ],
  },

  adapter: node({
    mode: "middleware",
  }),
});
