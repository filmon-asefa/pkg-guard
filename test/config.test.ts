import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, applyOverrides, loadConfig, resolveConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { makeProject, removeProject } from "./helpers.js";

test("defaults are used for an empty config", () => {
  assert.deepEqual(resolveConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(resolveConfig(undefined), DEFAULT_CONFIG);
});

test("valid options are applied", () => {
  const config = resolveConfig({
    failOn: "critical", production: true, strict: true, timeoutMs: 5000,
    checks: { unused: false },
    outdated: { failOn: "major", ignore: ["react"] },
    unused: { fail: true, ignore: ["x"], sourceDirs: ["src"] },
    ignore: [{ package: "lodash", advisory: "GHSA-aaaa-bbbb-cccc", reason: "not reachable", expires: "2030-01-01" }],
  });
  assert.equal(config.failOn, "critical");
  assert.equal(config.checks.unused, false);
  assert.equal(config.checks.audit, true);
  assert.equal(config.outdated.failOn, "major");
  assert.equal(config.ignore[0]?.expires, "2030-01-01");
});

test("typos and invalid values are rejected with clear messages", () => {
  assert.throws(() => resolveConfig({ failon: "high" }), /unknown option "failon"/);
  assert.throws(() => resolveConfig({ failOn: "severe" }), /"failOn" must be one of/);
  assert.throws(() => resolveConfig({ production: "yes" }), /must be true or false/);
  assert.throws(() => resolveConfig({ timeoutMs: 5 }), /timeoutMs/);
  assert.throws(() => resolveConfig({ checks: { audti: true } }), /Unknown option "audti"/);
  assert.throws(() => resolveConfig({ outdated: { failOn: "huge" } }), /outdated.failOn/);
  assert.throws(() => resolveConfig({ ignore: [{ package: "x" }] }), /reason is required/);
  assert.throws(() => resolveConfig({ ignore: [{ package: "x", reason: "r", expires: "2030-13-40" }] }), /valid date/);
  assert.throws(() => resolveConfig({ ignore: [{ reason: "r" }] }), /package is required/);
  assert.throws(() => resolveConfig([]), ConfigError);
});

test("applyOverrides: CLI values win and skip disables checks", () => {
  const config = applyOverrides(resolveConfig({ failOn: "low" }), { failOn: "critical", production: true, strict: true, skip: ["audit", "fit"] });
  assert.equal(config.failOn, "critical");
  assert.equal(config.production, true);
  assert.equal(config.strict, true);
  assert.equal(config.checks.audit, false);
  assert.equal(config.checks.fit, false);
  assert.equal(config.checks.outdated, true);
});

test("loadConfig finds pkg-guard.config.json, then package.json, then defaults", () => {
  const withFile = makeProject({ "package.json": { name: "a" }, "pkg-guard.config.json": { failOn: "low" } });
  const withKey = makeProject({ "package.json": { name: "a", "pkg-guard": { failOn: "critical" } } });
  const none = makeProject({ "package.json": { name: "a" } });
  try {
    assert.equal(loadConfig(withFile).config.failOn, "low");
    assert.equal(loadConfig(withKey).config.failOn, "critical");
    const defaults = loadConfig(none);
    assert.equal(defaults.config.failOn, "high");
    assert.equal(defaults.source, undefined);
  } finally {
    removeProject(withFile);
    removeProject(withKey);
    removeProject(none);
  }
});

test("loadConfig reports unreadable and invalid files", () => {
  const dir = makeProject({ "package.json": { name: "a" }, "pkg-guard.config.json": "{ not json" });
  try {
    assert.throws(() => loadConfig(dir), /not valid JSON/);
    assert.throws(() => loadConfig(dir, "missing.json"), /not found/);
  } finally {
    removeProject(dir);
  }
});
