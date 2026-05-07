import type { BodyDiff } from "./types.js";

// A JSON pointer-ish path, e.g. "data.items[3].id".
// Compare two values structurally and produce a list of mismatch entries.
// `ignorePaths` is a set of paths that should be considered equal regardless
// of value (timestamps, server-generated IDs, etc.).
export function diffJson(
  expected: unknown,
  actual: unknown,
  ignorePaths: Set<string> = new Set(),
  path = "",
): BodyDiff[] {
  if (ignorePaths.has(path)) return [];

  if (expected === actual) return [];
  if (expected == null || actual == null) {
    return [{ path: path || "(root)", expected, actual }];
  }
  if (typeof expected !== typeof actual) {
    return [{ path: path || "(root)", expected, actual }];
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return [{ path: path || "(root)", expected, actual }];
    }
    const diffs: BodyDiff[] = [];
    const len = Math.max(expected.length, actual.length);
    if (expected.length !== actual.length) {
      diffs.push({
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      });
    }
    for (let i = 0; i < len; i++) {
      diffs.push(
        ...diffJson(expected[i], actual[i], ignorePaths, `${path}[${i}]`),
      );
    }
    return diffs;
  }

  if (typeof expected === "object") {
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    const diffs: BodyDiff[] = [];
    for (const k of keys) {
      const childPath = path ? `${path}.${k}` : k;
      diffs.push(...diffJson(e[k], a[k], ignorePaths, childPath));
    }
    return diffs;
  }

  return [{ path: path || "(root)", expected, actual }];
}

// Convenience: given an array of dot-path strings, build the ignore set.
export function buildIgnoreSet(paths: string[]): Set<string> {
  return new Set(paths.filter(Boolean));
}
