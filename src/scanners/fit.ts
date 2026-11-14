import { minNodeMajor } from "../semver.js";
import type { Finding, ScannerOutcome } from "../types.js";
import type { ScannerContext } from "./context.js";

interface Hint {
  packages: string[];
  /** Minimum Node.js major version that provides the built-in alternative. */
  minNode: number;
  message: string;
}

/**
 * Hints, not rules: they point at packages whose job is now covered by Node.js
 * itself. They never change a package's status and never fail a build.
 */
const HINTS: Hint[] = [
  { packages: ["axios", "node-fetch", "cross-fetch", "isomorphic-fetch"], minNode: 18, message: "Node.js 18+ has a built-in fetch(); you may not need an HTTP client package." },
  { packages: ["uuid"], minNode: 16, message: "Node.js 16+ has crypto.randomUUID() for generating v4 UUIDs." },
  { packages: ["rimraf"], minNode: 14, message: "fs.rm(path, { recursive: true, force: true }) in Node.js 14.14+ replaces rimraf." },
  { packages: ["mkdirp"], minNode: 12, message: "fs.mkdir(path, { recursive: true }) replaces mkdirp." },
  { packages: ["clone-deep", "lodash.clonedeep"], minNode: 17, message: "structuredClone() (Node.js 17+) covers most deep-copy needs." },
  { packages: ["left-pad"], minNode: 8, message: "String.prototype.padStart() replaces left-pad." },
  { packages: ["object-assign"], minNode: 4, message: "Object.assign() is built in." },
  { packages: ["request", "request-promise", "request-promise-native"], minNode: 0, message: "This package is deprecated and no longer maintained. Use a maintained HTTP client or the built-in fetch()." },
];

export function runFit(ctx: ScannerContext): ScannerOutcome {
  const outcome: ScannerOutcome = { scanner: "fit", ok: true, findings: [], warnings: [] };
  const declared = new Set([
    ...Object.keys(ctx.manifest.dependencies),
    ...Object.keys(ctx.manifest.devDependencies),
    ...Object.keys(ctx.manifest.optionalDependencies),
  ]);
  // Unknown engines: assume a currently supported Node.js (18+).
  const projectNode = minNodeMajor(ctx.manifest.enginesNode) ?? 18;

  for (const hint of HINTS) {
    if (projectNode < hint.minNode) continue;
    for (const name of hint.packages) {
      if (!declared.has(name)) continue;
      const finding: Finding = { kind: "fit", package: name, message: hint.message };
      outcome.findings.push(finding);
    }
  }
  return outcome;
}
