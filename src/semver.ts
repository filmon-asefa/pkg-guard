import type { UpdateType } from "./types.js";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): ParsedVersion | undefined {
  const match = VERSION_RE.exec(input.trim());
  if (!match) return undefined;
  const [, major, minor, patch, pre] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: pre ? pre.split(".") : [],
  };
}

function comparePrerelease(a: string[], b: string[]): number {
  // A version without prerelease is greater than one with.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * How big is the jump from `current` to `latest`?
 * Returns "none" when `latest` is not newer than `current`.
 */
export function classifyUpdate(current: string, latest: string): UpdateType | "none" {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return "unknown";
  if (compareParsed(a, b) >= 0) return "none";
  if (a.major !== b.major) return "major";
  if (a.minor !== b.minor) return "minor";
  return "patch";
}

/** Ordering used by the `outdated.failOn` policy. */
export const UPDATE_RANK: Readonly<Record<UpdateType, number>> = {
  unknown: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

/**
 * Extracts the minimum supported Node.js major version from an `engines.node`
 * range such as ">=18", "^20.11.0" or ">=16 <22". Returns undefined if unknown.
 */
export function minNodeMajor(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const match = /(?:>=|\^|~|>)?\s*v?(\d+)(?:\.\d+|\.x)?/.exec(range);
  if (!match || match[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}
