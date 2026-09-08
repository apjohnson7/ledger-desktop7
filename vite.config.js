import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built index.html works when Electron
  // loads it straight off disk (file://) instead of from a web server.
  base: "./",
});
