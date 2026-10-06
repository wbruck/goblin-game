import { defineConfig } from "vite";

// BASE_PATH is set by the GitHub Pages workflow to "/<repo>/" because project
// sites are served from a sub-path. Locally it defaults to "/".
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  server: { port: 5173 },
  build: { target: "es2022" },
});
