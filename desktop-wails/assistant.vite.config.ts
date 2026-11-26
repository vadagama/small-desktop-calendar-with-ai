import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const outDir = resolve("desktop-wails/assistant-dist");
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  ssr: { noExternal: true },
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      input: {
        "assistant-host": resolve("desktop-wails/assistant-host.ts"),
        "agent-worker": resolve("src/main/agent-worker.ts"),
      },
      output: {
        entryFileNames: "[name].mjs",
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
  },
  plugins: [
    {
      name: "assistant-content",
      writeBundle() {
        cpSync(resolve("src/agent/content"), resolve(outDir, "content"), {
          recursive: true,
        });
      },
    },
  ],
});
