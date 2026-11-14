import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { readManifest } from "../src/manifest.js";
import { extractImportedPackages, globToRegExp, toPackageName } from "../src/scanners/unused.js";
import { findUnusedDependencies, runUnused } from "../src/scanners/unused.js";
import type { ScannerContext } from "../src/scanners/context.js";
import { fakeInstall, fakeRunner, makeProject, removeProject } from "./helpers.js";

test("toPackageName normalises specifiers", () => {
  assert.equal(toPackageName("lodash/get"), "lodash");
  assert.equal(toPackageName("@scope/pkg/deep/file"), "@scope/pkg");
  assert.equal(toPackageName("./local"), undefined);
  assert.equal(toPackageName("../up"), undefined);
  assert.equal(toPackageName("/abs/path"), undefined);
  assert.equal(toPackageName("node:fs"), undefined);
  assert.equal(toPackageName("https://example.com/x.js"), undefined);
  assert.equal(toPackageName("@/alias"), undefined);
  assert.equal(toPackageName("#internal"), undefined);
});

test("extractImportedPackages understands the common import styles", () => {
  const source = `
    import a from "alpha";
    import { b,
      c } from 'beta/sub';
    import type { T } from "@scope/gamma";
    import "delta";
    export * from "epsilon";
    export { x } from "zeta";
    const f = require("eta");
    const g = await import("theta");
    import iota = require("iota");
    /// <reference types="kappa" />
    import local from "./local";
  `;
  const found = extractImportedPackages(source);
  for (const name of ["alpha", "beta", "@scope/gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"]) {
    assert.ok(found.has(name), `expected ${name}`);
  }
  assert.ok(!found.has("local"));
});

test("globToRegExp supports * wildcards", () => {
  assert.ok(globToRegExp("@types/*").test("@types/node"));
  assert.ok(globToRegExp("eslint*").test("eslint-plugin-x"));
  assert.ok(!globToRegExp("eslint").test("eslint-plugin-x"));
});

function context(dir: string, overrides: Partial<typeof DEFAULT_CONFIG["unused"]> = {}): ScannerContext {
  return {
    cwd: dir,
    run: fakeRunner({}),
    config: { ...DEFAULT_CONFIG, unused: { ...DEFAULT_CONFIG.unused, ...overrides } },
    manifest: readManifest(dir),
  };
}

test("flags a dependency that is never used and keeps the ones that are", () => {
  const dir = makeProject({
    "package.json": {
      name: "app", version: "1.0.0",
      scripts: { lint: "eslint .", build: "tsc" },
      dependencies: { used: "^1.0.0", dead: "^1.0.0", "@scope/scoped": "^1.0.0" },
      devDependencies: { eslint: "^9.0.0", typescript: "^5.0.0", jest: "^29.0.0", "@types/node": "^20.0.0", "eslint-plugin-x": "^1.0.0" },
      jest: { testEnvironment: "node" },
    },
    "src/index.ts": 'import u from "used"; import s from "@scope/scoped/sub";',
  });
  try {
    for (const name of ["used", "dead", "@scope/scoped", "eslint", "typescript", "jest"]) fakeInstall(dir, name);
    // eslint's command is named "eslint", typescript's command is "tsc"
    fakeInstall(dir, "eslint", { bin: { eslint: "bin/eslint.js" } });
    fakeInstall(dir, "typescript", { bin: { tsc: "bin/tsc", tsserver: "bin/tsserver" } });

    const result = findUnusedDependencies(context(dir));
    const names = result.findings.map((f) => f.package).sort();
    assert.deepEqual(names, ["dead"]);
    assert.equal(result.findings[0]?.fix, "npm uninstall dead");
  } finally {
    removeProject(dir);
  }
});

test("respects unused.ignore patterns", () => {
  const dir = makeProject({
    "package.json": { name: "app", version: "1.0.0", dependencies: { dead: "1.0.0", "keep-me": "1.0.0" } },
    "src/index.js": "console.log(1)",
  });
  try {
    fakeInstall(dir, "dead");
    fakeInstall(dir, "keep-me");
    const result = findUnusedDependencies(context(dir, { ignore: ["keep-*"] }));
    assert.deepEqual(result.findings.map((f) => f.package), ["dead"]);
  } finally {
    removeProject(dir);
  }
});

test("does not judge packages that are not installed, and says so", () => {
  const dir = makeProject({
    "package.json": { name: "app", version: "1.0.0", dependencies: { ghost: "1.0.0" } },
    "src/index.js": "console.log(1)",
  });
  try {
    const result = findUnusedDependencies(context(dir));
    assert.equal(result.findings.length, 0);
    assert.match(result.warnings.join(" "), /not installed/);
  } finally {
    removeProject(dir);
  }
});

test("a config file reference counts as use", () => {
  const dir = makeProject({
    "package.json": { name: "app", version: "1.0.0", devDependencies: { vitest: "1.0.0" } },
    "vitest.config.ts": 'import { defineConfig } from "vitest/config"; export default defineConfig({});',
    "src/a.ts": "export const a = 1;",
  });
  try {
    fakeInstall(dir, "vitest");
    assert.equal(findUnusedDependencies(context(dir)).findings.length, 0);
  } finally {
    removeProject(dir);
  }
});

test("node_modules and dist folders are not scanned", () => {
  const dir = makeProject({
    "package.json": { name: "app", version: "1.0.0", dependencies: { hidden: "1.0.0" } },
    "src/a.js": "export default 1;",
    "dist/b.js": 'import "hidden";',
    "node_modules/other/index.js": 'require("hidden")',
  });
  try {
    fakeInstall(dir, "hidden");
    assert.deepEqual(findUnusedDependencies(context(dir)).findings.map((f) => f.package), ["hidden"]);
  } finally {
    removeProject(dir);
  }
});

test("sourceDirs limits the scan to the given folders", () => {
  const dir = makeProject({
    "package.json": { name: "app", version: "1.0.0", dependencies: { a: "1.0.0", b: "1.0.0" } },
    "src/x.js": 'import "a";',
    "other/y.js": 'import "b";',
  });
  try {
    fakeInstall(dir, "a");
    fakeInstall(dir, "b");
    const result = findUnusedDependencies(context(dir, { sourceDirs: ["src"] }));
    assert.deepEqual(result.findings.map((f) => f.package), ["b"]);
  } finally {
    removeProject(dir);
  }
});

test("runUnused skips workspaces and projects without source files", () => {
  const ws = makeProject({ "package.json": { name: "m", version: "1.0.0", workspaces: ["packages/*"], dependencies: { a: "1.0.0" } } });
  const empty = makeProject({ "package.json": { name: "e", version: "1.0.0", dependencies: { a: "1.0.0" } } });
  try {
    const first = runUnused(context(ws));
    assert.equal(first.findings.length, 0);
    assert.match(first.warnings.join(" "), /workspaces/);
    const second = runUnused(context(empty));
    assert.equal(second.findings.length, 0);
    assert.match(second.warnings.join(" "), /no JavaScript\/TypeScript source files/);
  } finally {
    removeProject(ws);
    removeProject(empty);
  }
});
