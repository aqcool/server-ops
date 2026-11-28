const DEFAULT_NPM_PACKAGE = "antigravity-server-ops";
const DEFAULT_REPO = "aqcool/server-ops";

/**
 * Compare two semver strings (e.g. "0.2.0" vs "0.3.0" or "v0.3.0").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a, b) {
  const parse = (v) =>
    String(v || "")
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/**
 * Extract a concise plain-text summary from Markdown release notes.
 */
export function extractReleaseSummary(markdown, maxLength = 140) {
  if (typeof markdown !== "string" || !markdown.trim()) return "";
  const lines = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw
      .trim()
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .trim();
    if (!line) continue;
    if (/^(what'?s changed|full changelog|changelog|release notes|更新日志|更新内容)[:：]?$/i.test(line)) {
      continue;
    }
    if (/^https?:\/\//i.test(line)) continue;
    lines.push(line);
    if (lines.join("；").length >= maxLength) break;
  }
  const joined = lines.join("；");
  if (joined.length <= maxLength) return joined;
  return `${joined.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseNpmDist(dist) {
  const tarballUrl = typeof dist?.tarball === "string" ? dist.tarball.trim() : "";
  const integrity = typeof dist?.integrity === "string" ? dist.integrity.trim() : "";
  const shasum = typeof dist?.shasum === "string" ? dist.shasum.trim().toLowerCase() : "";
  if (!tarballUrl) return null;
  return {
    tarballUrl,
    ...(integrity ? { integrity } : {}),
    ...(shasum ? { shasum } : {}),
  };
}

async function fetchGithubReleaseMeta({ repo, version, userAgent, fetchImpl, signal }) {
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${repo}/releases/tags/v${encodeURIComponent(version)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": userAgent,
        },
        signal,
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      releaseUrl: typeof data?.html_url === "string" ? data.html_url : "",
      releaseName: typeof data?.name === "string" ? data.name : "",
      notes: typeof data?.body === "string" ? data.body : "",
    };
  } catch {
    return null;
  }
}

export async function checkForUpdates({
  currentVersion,
  npmPackage = DEFAULT_NPM_PACKAGE,
  repo = DEFAULT_REPO,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
  includeReleaseNotes = true,
} = {}) {
  const checkedAt = new Date().toISOString();
  const repoUrl = `https://github.com/${repo}`;
  const npmUrl = `https://www.npmjs.com/package/${npmPackage}`;
  const userAgent = `${npmPackage}/${currentVersion}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Check npm registry first (matches `npx antigravity-server-ops init`)
    try {
      const npmRes = await fetchImpl(`https://registry.npmjs.org/${npmPackage}/latest`, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
        signal: controller.signal,
      });
      if (npmRes.ok) {
        const data = await npmRes.json();
        const latestVersion = String(data?.version || "").trim();
        if (latestVersion) {
          const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
          const dist = parseNpmDist(data?.dist);
          let releaseUrl = npmUrl;
          let releaseName = `v${latestVersion}`;
          let summary = "";

          // 有新版本时顺带拉取 GitHub Release 说明（失败则静默忽略，不影响主流程）
          if (hasUpdate && includeReleaseNotes) {
            const notesSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(3_000)]);
            const gh = await fetchGithubReleaseMeta({
              repo,
              version: latestVersion,
              userAgent,
              fetchImpl,
              signal: notesSignal,
            });
            if (gh?.releaseUrl) releaseUrl = gh.releaseUrl;
            if (gh?.releaseName) releaseName = gh.releaseName;
            if (gh?.notes) summary = extractReleaseSummary(gh.notes);
          }

          return {
            currentVersion,
            latestVersion,
            hasUpdate,
            releaseUrl,
            releaseName,
            summary,
            source: "npm",
            dist,
            checkedAt,
          };
        }
      }
    } catch {
      // Fall through to GitHub
    }

    // 2. Fallback to GitHub Releases latest tag
    try {
      const releaseRes = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": userAgent,
        },
        signal: controller.signal,
      });
      if (releaseRes.ok) {
        const data = await releaseRes.json();
        const latestVersion = String(data?.tag_name || "").replace(/^v/i, "").trim();
        if (latestVersion) {
          return {
            currentVersion,
            latestVersion,
            hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
            releaseUrl: data?.html_url || `${repoUrl}/releases`,
            releaseName: data?.name || `v${latestVersion}`,
            summary: extractReleaseSummary(data?.body || ""),
            source: "github",
            dist: null,
            checkedAt,
          };
        }
      }
    } catch {
      // Fall through to raw package.json
    }

    // 3. Fallback to raw package.json on main branch
    const pkgRes = await fetchImpl(`https://raw.githubusercontent.com/${repo}/main/package.json`, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });
    if (!pkgRes.ok) {
      throw new Error(`Update check failed (HTTP ${pkgRes.status}).`);
    }
    const pkg = await pkgRes.json();
    const latestVersion = String(pkg?.version || "").trim();
    if (!latestVersion) {
      throw new Error("Could not read remote version.");
    }
    return {
      currentVersion,
      latestVersion,
      hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
      releaseUrl: repoUrl,
      releaseName: `v${latestVersion}`,
      summary: "",
      source: "github-raw",
      dist: null,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
