import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

function expandHome(filePath) {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
  return filePath;
}

function splitDirective(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/);
  if (!match) return null;
  return { key: match[1].toLowerCase(), value: match[2].trim() };
}

function isConcreteAlias(pattern) {
  return Boolean(pattern) && !/[*?![\]]/.test(pattern) && !pattern.startsWith("!");
}

async function resolveIncludeFiles(pattern, baseDir) {
  const expanded = expandHome(pattern);
  const full = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);
  if (!full.includes("*")) return [full];
  const dir = dirname(full);
  const base = full.slice(dir.length + 1);
  const regex = new RegExp(
    "^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*") + "$",
  );
  try {
    const entries = await readdir(dir);
    return entries
      .filter((entry) => regex.test(entry))
      .sort()
      .map((entry) => join(dir, entry));
  } catch {
    return [];
  }
}

export function parseSshConfigText(text) {
  const hosts = new Map();
  let activeAliases = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const directive = splitDirective(rawLine);
    if (!directive) continue;

    if (directive.key === "host") {
      const patterns = directive.value.split(/\s+/).filter(Boolean);
      activeAliases = patterns.filter(isConcreteAlias);
      for (const alias of activeAliases) {
        if (!hosts.has(alias)) {
          hosts.set(alias, { id: alias, name: alias });
        }
      }
      continue;
    }

    if (directive.key === "match") {
      activeAliases = [];
      continue;
    }

    if (activeAliases.length === 0) continue;

    for (const alias of activeAliases) {
      const entry = hosts.get(alias);
      if (!entry) continue;
      if (directive.key === "hostname" && !entry.hostName) {
        entry.hostName = directive.value;
      } else if (directive.key === "user" && !entry.user) {
        entry.user = directive.value;
      } else if (directive.key === "port" && !entry.port) {
        const parsed = Number.parseInt(directive.value, 10);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
          entry.port = parsed;
        }
      }
    }
  }

  return [...hosts.values()].map((entry) => {
    const target = [entry.user ? `${entry.user}@` : "", entry.hostName || ""]
      .join("")
      .trim();
    const portSuffix = entry.port && entry.port !== 22 ? `:${entry.port}` : "";
    return {
      id: entry.id,
      name: entry.id,
      subtitle: target ? `${target}${portSuffix}` : undefined,
    };
  });
}

async function readConfigRecursive(filePath, visited, out) {
  const resolved = resolve(expandHome(filePath));
  if (visited.has(resolved)) return;
  visited.add(resolved);

  let text;
  try {
    text = await readFile(resolved, "utf8");
  } catch {
    return;
  }

  const baseDir = dirname(resolved);
  for (const rawLine of text.split(/\r?\n/)) {
    const directive = splitDirective(rawLine);
    if (directive?.key === "include") {
      for (const pattern of directive.value.split(/\s+/).filter(Boolean)) {
        const files = await resolveIncludeFiles(pattern, baseDir);
        for (const inc of files) {
          await readConfigRecursive(inc, visited, out);
        }
      }
    }
  }

  for (const host of parseSshConfigText(text)) {
    if (!out.has(host.id)) {
      out.set(host.id, host);
    }
  }
}

export async function loadSshProfiles(configPath = join(homedir(), ".ssh", "config")) {
  const profiles = new Map();
  await readConfigRecursive(configPath, new Set(), profiles);
  return [...profiles.values()];
}
