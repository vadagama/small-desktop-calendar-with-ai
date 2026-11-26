import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  publicDir: resolve("resources/renderer"),
  resolve: { dedupe: ["react", "react-dom"] },
  plugins: [
    {
      name: "wails-shell-preview",
      transformIndexHtml: {
        order: "pre",
        handler() {
          return [
            {
              tag: "script",
              attrs: { type: "module", src: "../../desktop-wails/preview.ts" },
              injectTo: "head",
            },
          ];
        },
      },
    },
  ],
  build: {
    outDir: resolve("desktop-wails/dist"),
    emptyOutDir: true,
    cssMinify: "lightningcss",
  },
});
