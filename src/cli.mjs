import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main as runServer } from "./server.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PLUGIN_DIR = join(homedir(), ".gemini", "config", "plugins", "server-ops");

const PLUGIN_FILES = [
  "plugin.json",
  "mcp_config.json",
  "skills",
  "dist/server.mjs",
  "dist/picker.html",
];

function parseDirFlag(args, fallback) {
  for (const arg of args) {
    if (arg.startsWith("--dir=")) return resolve(arg.slice("--dir=".length));
  }
  return fallback;
}

export async function installPlugin(targetDir = DEFAULT_PLUGIN_DIR, sourceRoot = PACKAGE_ROOT) {
  await mkdir(targetDir, { recursive: true });
  for (const rel of PLUGIN_FILES) {
    const src = join(sourceRoot, rel);
    const dst = join(targetDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst, { recursive: true, force: true });
  }
  await chmod(join(targetDir, "dist", "server.mjs"), 0o755).catch(() => {});
  return targetDir;
}

export async function uninstallPlugin(targetDir = DEFAULT_PLUGIN_DIR) {
  await rm(targetDir, { recursive: true, force: true });
  return targetDir;
}

function printHelp() {
  console.log(`antigravity-server-ops

Usage:
  npx antigravity-server-ops init [--dir=<path>]     Install/update the Antigravity plugin
  npx antigravity-server-ops uninstall [--dir=<path>] Remove the Antigravity plugin
  npx antigravity-server-ops [--data-dir=<path>]     Run the MCP Stdio server directly

Default plugin directory:
  ${DEFAULT_PLUGIN_DIR}
`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;

  if (cmd === "init" || cmd === "install") {
    const targetDir = parseDirFlag(rest, DEFAULT_PLUGIN_DIR);
    await installPlugin(targetDir);
    console.log(`✓ Installed Antigravity plugin "server-ops" to:\n  ${targetDir}`);
    console.log(
      `\nAntigravity discovers it automatically without restarting.\nOpen "Server Ops" from the left sidebar or the side pane "+" menu.`,
    );
    return;
  }

  if (cmd === "uninstall" || cmd === "remove") {
    const targetDir = parseDirFlag(rest, DEFAULT_PLUGIN_DIR);
    await uninstallPlugin(targetDir);
    console.log(`✓ Removed Antigravity plugin from:\n  ${targetDir}`);
    return;
  }

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    printHelp();
    return;
  }

  await runServer(argv);
}
