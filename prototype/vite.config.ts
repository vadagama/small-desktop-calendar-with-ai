import { defineConfig } from "vite";

// Shared desktop UI imports must use the prototype's React instance.
export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
});
