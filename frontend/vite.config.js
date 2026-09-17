import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000, // keep 3000 so the backend's CORS allowlist still matches
  },
  test: {
    globals: true, // `describe`/`test`/`expect`/`vi` without importing them
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    css: false, // don't process CSS imports during tests
  },
});
