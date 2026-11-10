import { cpSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// https://electron-vite.org/guide/dev#customizing
export default defineConfig({
  main: {
    plugins: [
      {
        name: "agent-markdown-content",
        writeBundle() {
          cpSync(resolve("src/agent/content"), resolve("out/main/content"), {
            recursive: true,
          });
        },
      },
    ],
    build: {
      rollupOptions: {
        // Keep shared modules beside content/ so import.meta.url resolves Markdown in packaged builds.
        output: { chunkFileNames: "[name]-[hash].js" },
        input: {
          index: resolve("src/main/index.ts"),
          "agent-worker": resolve("src/main/agent-worker.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" } },
    },
  },
  renderer: {
    root: "src/renderer",
    // DockWorkspace uses themeLight only; omit the unused bundled themes.
    css: {
      lightningcss: {
        unusedSymbols: [
          "dockview-theme-abyss",
          "dockview-theme-abyss-spaced",
          "dockview-theme-catppuccin-mocha",
          "dockview-theme-catppuccin-mocha-spaced",
          "dockview-theme-dark",
          "dockview-theme-dracula",
          "dockview-theme-github-dark",
          "dockview-theme-github-dark-spaced",
          "dockview-theme-github-light",
          "dockview-theme-github-light-spaced",
          "dockview-theme-light-spaced",
          "dockview-theme-monokai",
          "dockview-theme-nord",
          "dockview-theme-nord-spaced",
          "dockview-theme-solarized-light",
          "dockview-theme-solarized-light-spaced",
          "dockview-theme-vs",
        ],
      },
    },

    publicDir: resolve("resources/renderer"),
    resolve: { dedupe: ["react", "react-dom"] },
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
    build: {
      minify: true,
      cssMinify: true,
      rollupOptions: { input: resolve("src/renderer/index.html") },
    },
  },
});
