import { build } from "esbuild";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["src/server.mjs"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});

await chmod(new URL("dist/server.mjs", import.meta.url), 0o755);

const panel = await build({
  absWorkingDir: root,
  entryPoints: ["src/picker.mjs"],
  bundle: true,
  format: "iife",
  write: false,
});

const html = await readFile(new URL("src/picker.html", import.meta.url), "utf8");
await writeFile(
  new URL("dist/picker.html", import.meta.url),
  html.replace("/* picker */", () =>
    panel.outputFiles[0].text.replaceAll("</script", "<\\/script"),
  ),
);
