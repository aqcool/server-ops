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

export async function checkForUpdates({
  currentVersion,
  npmPackage = DEFAULT_NPM_PACKAGE,
  repo = DEFAULT_REPO,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
} = {}) {
  const checkedAt = new Date().toISOString();
  const repoUrl = `https://github.com/${repo}`;
  const npmUrl = `https://www.npmjs.com/package/${npmPackage}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1. Check npm registry first (matches `npx antigravity-server-ops init`)
    try {
      const npmRes = await fetchImpl(`https://registry.npmjs.org/${npmPackage}/latest`, {
        headers: { Accept: "application/json", "User-Agent": `${npmPackage}/${currentVersion}` },
        signal: controller.signal,
      });
      if (npmRes.ok) {
        const data = await npmRes.json();
        const latestVersion = String(data?.version || "").trim();
        if (latestVersion) {
          return {
            currentVersion,
            latestVersion,
            hasUpdate: compareSemver(latestVersion, currentVersion) > 0,
            releaseUrl: npmUrl,
            releaseName: `v${latestVersion}`,
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
          "User-Agent": `${npmPackage}/${currentVersion}`,
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
            checkedAt,
          };
        }
      }
    } catch {
      // Fall through to raw package.json
    }

    // 3. Fallback to raw package.json on main branch
    const pkgRes = await fetchImpl(`https://raw.githubusercontent.com/${repo}/main/package.json`, {
      headers: { "User-Agent": `${npmPackage}/${currentVersion}` },
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
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
