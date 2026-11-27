import { build } from "esbuild";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const nodeBanner =
  '#!/usr/bin/env node\nimport { createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __pathDirname } from "node:path"; const require = createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);';

await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ["src/server-entry.mjs"],
    outfile: "dist/server.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["cpu-features"],
    banner: { js: nodeBanner },
  }),
  build({
    absWorkingDir: root,
    entryPoints: ["src/cli-entry.mjs"],
    outfile: "dist/cli.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["cpu-features"],
    banner: { js: nodeBanner },
  }),
]);

await Promise.all([
  chmod(new URL("dist/server.mjs", import.meta.url), 0o755),
  chmod(new URL("dist/cli.mjs", import.meta.url), 0o755),
]);

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
