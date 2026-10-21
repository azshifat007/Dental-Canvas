/**
 * Version comparison for the update path.
 *
 * The updater trusts the Tauri plugin's verdict, but when that plugin fails
 * (an install whose NSIS registry entry is missing, a machine behind a proxy,
 * a UI still served from an old service-worker cache) the app falls back to
 * comparing the feed's version with its own build version. That comparison
 * must be stable across the shapes the release pipeline produces:
 *   "1.4.22", "v1.4.22", "1.4.22-beta.1", "1.4.22+build.7"
 */

/** Parse "v1.4.22-beta.1" → { numbers: [1,4,22], prerelease: ["beta","1"] }. */
export function parseVersion(version: string): { numbers: number[]; prerelease: string[] } {
  const cleaned = version.trim().replace(/^v/i, "").split("+")[0];
  const [core, ...rest] = cleaned.split("-");
  const numbers = core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (numbers.length < 3) numbers.push(0);
  const prerelease = rest.length > 0 ? rest.join("-").split(".") : [];
  return { numbers, prerelease };
}

/**
 * Compare two versions: negative when `a` is older than `b`, 0 when equal,
 * positive when newer. A prerelease sorts before its release ("1.4.23-beta" <
 * "1.4.23"), matching semver and how the updater feed is ordered.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.numbers.length, right.numbers.length);
  for (let i = 0; i < len; i++) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  // A release outranks its prereleases.
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const plen = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < plen; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    const lIsNum = Number.isFinite(ln) && String(ln) === l;
    const rIsNum = Number.isFinite(rn) && String(rn) === r;
    if (lIsNum && rIsNum) return ln < rn ? -1 : 1;
    if (lIsNum) return -1; // numeric identifiers sort before alphanumeric
    if (rIsNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
