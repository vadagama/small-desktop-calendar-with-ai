import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// https://electron-vite.org/guide/dev#customizing
export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    root: "prototype",
    publicDir: resolve("prototype/public"),
    resolve: { dedupe: ["react", "react-dom"] },
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
    build: { rollupOptions: { input: resolve("prototype/index.html") } },
  },
});
