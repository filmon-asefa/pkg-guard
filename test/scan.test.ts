import assert from "node:assert/strict";
import { test } from "node:test";
import { scan } from "../src/scan.js";
import { AUDIT_FIXTURE, OUTDATED_FIXTURE, fakeInstall, fakeRunner, makeProject, removeProject } from "./helpers.js";

function project(extra: Record<string, string | object> = {}): string {
  const dir = makeProject({
    "package.json": {
      name: "demo", version: "2.0.0",
      dependencies: { lodash: "^4.17.1", express: "^4.17.1" },
      devDependencies: { chalk: "^5.3.0" },
    },
    "package-lock.json": { lockfileVersion: 3 },
    "src/index.js": 'require("lodash"); require("express"); require("chalk");',
    ...extra,
  });
  for (const name of ["lodash", "express", "chalk"]) fakeInstall(dir, name);
  return dir;
}

const NOW = new Date("2026-06-15T12:00:00Z");

test("full scan merges vulnerabilities and outdated info and fails on high severity", async () => {
  const dir = project();
  try {
    const result = await scan({ cwd: dir, run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: OUTDATED_FIXTURE }), now: NOW });
    assert.equal(result.exitCode, 1);
    assert.equal(result.passed, false);
    assert.equal(result.project.name, "demo");
    const lodash = result.verdicts.find((v) => v.name === "lodash");
    assert.equal(lodash?.status, "vulnerable");
    assert.equal(result.verdicts.find((v) => v.name === "express")?.latest, "5.1.0");
    assert.equal(result.verdicts.find((v) => v.name === "left-transitive")?.type, "transitive");
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0]?.message ?? "", /high vulnerability/);
    assert.equal(result.summary.vulnerable, 2);
  } finally {
    removeProject(dir);
  }
});

test("failOn none lets the scan pass even with vulnerabilities", async () => {
  const dir = project();
  try {
    const result = await scan({ cwd: dir, run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: {} }), overrides: { failOn: "none" }, now: NOW });
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.vulnerable, 2);
  } finally {
    removeProject(dir);
  }
});

test("ignored vulnerabilities do not fail the scan but are reported", async () => {
  const dir = project({
    "pkg-guard.config.json": { ignore: [{ package: "lodash", advisory: "GHSA-p6mc-m468-83gw", reason: "only used in a build script", expires: "2027-01-01" }] },
  });
  try {
    const result = await scan({ cwd: dir, run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: {} }), now: NOW });
    assert.equal(result.exitCode, 0);
    assert.equal(result.ignored.length, 1);
    assert.equal(result.ignored[0]?.reason, "only used in a build script");
    assert.equal(result.verdicts.find((v) => v.name === "lodash")?.status, "safe");
  } finally {
    removeProject(dir);
  }
});

test("a failing check is a warning normally, and exit code 2 in strict mode", async () => {
  const dir = project();
  const offline = { audit: { stdout: "", stderr: "npm error network", code: 1 }, outdated: { stdout: "", stderr: "npm error network", code: 1 } };
  try {
    const lenient = await scan({ cwd: dir, run: fakeRunner(offline), now: NOW });
    assert.equal(lenient.exitCode, 0);
    assert.equal(lenient.scannerErrors.length, 2);
    assert.match(lenient.warnings.join("\n"), /audit check could not run/);

    const strict = await scan({ cwd: dir, run: fakeRunner(offline), overrides: { strict: true }, now: NOW });
    assert.equal(strict.exitCode, 2);
    assert.equal(strict.passed, false);
  } finally {
    removeProject(dir);
  }
});

test("violations take precedence over scanner errors in strict mode", async () => {
  const dir = project();
  try {
    const result = await scan({
      cwd: dir,
      run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: { stdout: "", stderr: "npm error network", code: 1 } }),
      overrides: { strict: true },
      now: NOW,
    });
    assert.equal(result.exitCode, 1);
  } finally {
    removeProject(dir);
  }
});

test("skip disables checks", async () => {
  const dir = project();
  try {
    const result = await scan({ cwd: dir, run: fakeRunner({}), overrides: { skip: ["audit", "outdated", "unused", "fit"] }, now: NOW });
    assert.deepEqual(result.scanners, []);
    assert.equal(result.exitCode, 0);
  } finally {
    removeProject(dir);
  }
});

test("pnpm and yarn projects get a clear 'not supported' message", async () => {
  const dir = makeProject({ "package.json": { name: "p", version: "1.0.0", dependencies: { a: "1.0.0" } }, "pnpm-lock.yaml": "lockfileVersion: 9" });
  try {
    const result = await scan({ cwd: dir, run: fakeRunner({}), now: NOW, overrides: { skip: ["unused", "fit"] } });
    assert.equal(result.exitCode, 0);
    assert.match(result.scannerErrors[0]?.message ?? "", /pnpm/);
    const strict = await scan({ cwd: dir, run: fakeRunner({}), now: NOW, overrides: { skip: ["unused", "fit"], strict: true } });
    assert.equal(strict.exitCode, 2);
  } finally {
    removeProject(dir);
  }
});

test("a missing package.json is a usage error", async () => {
  const dir = makeProject({ "readme.txt": "hi" });
  try {
    await assert.rejects(() => scan({ cwd: dir, run: fakeRunner({}) }), /No package.json found/);
  } finally {
    removeProject(dir);
  }
});

test("config can be passed programmatically", async () => {
  const dir = project();
  try {
    const result = await scan({ cwd: dir, config: { failOn: "critical", checks: { unused: false } }, run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: {} }), now: NOW });
    assert.equal(result.exitCode, 0);
    assert.ok(!result.scanners.includes("unused"));
  } finally {
    removeProject(dir);
  }
});

test("scan results are plain JSON that survives a round trip", async () => {
  const dir = project();
  try {
    const result = await scan({ cwd: dir, run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: OUTDATED_FIXTURE }), now: NOW });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  } finally {
    removeProject(dir);
  }
});
