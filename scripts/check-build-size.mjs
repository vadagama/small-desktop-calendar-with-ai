import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const directory = "out/renderer/assets";
const sizes = { js: 0, css: 0 };
for (const name of await readdir(directory)) {
  const type = name.endsWith(".js")
    ? "js"
    : name.endsWith(".css")
      ? "css"
      : null;
  if (type) sizes[type] += (await stat(join(directory, name))).size;
}
console.log(JSON.stringify({ rendererBytes: sizes }, null, 2));
if (!sizes.js || !sizes.css) throw new Error("Missing renderer build");
if (sizes.js > 1_200_000 || sizes.css > 225_000)
  throw new Error("Renderer exceeds its JS (1.2 MB) or CSS (225 kB) budget");
