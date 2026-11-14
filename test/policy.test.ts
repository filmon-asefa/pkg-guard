import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { ResolvedConfig } from "../src/config.js";
import { buildVerdicts, summarize } from "../src/merge.js";
import { applyIgnores, evaluatePolicy } from "../src/policy.js";
import type { Finding, Manifest } from "../src/types.js";

const manifest: Manifest = {
  name: "app", version: "1.0.0",
  dependencies: { lodash: "^4.0.0", express: "^4.0.0", safe: "^1.0.0" },
  devDependencies: { jest: "^29.0.0" },
  optionalDependencies: {}, scripts: {}, hasWorkspaces: false, otherFieldsText: "{}",
};

const vuln = (pkg: string, severity: Finding["severity"], ids: string[] = []): Finding => ({
  kind: "vulnerability", package: pkg, severity, message: `${severity} issue`, advisoryIds: ids,
});
const outdated = (pkg: string, updateType: Finding["updateType"]): Finding => ({
  kind: "outdated", package: pkg, updateType, message: "old", current: "1.0.0", latest: "2.0.0",
});

const NOW = new Date("2026-06-15T12:00:00Z");

test("applyIgnores ignores by package and by advisory id (case-insensitive)", () => {
  const findings = [vuln("lodash", "high", ["GHSA-aaaa-bbbb-cccc"]), vuln("lodash", "low", ["GHSA-dddd-eeee-ffff"]), vuln("express", "high")];
  const byAdvisory = applyIgnores(findings, [{ package: "lodash", advisory: "ghsa-aaaa-bbbb-cccc", reason: "not reachable" }], NOW, true);
  assert.equal(byAdvisory.ignored.length, 1);
  assert.equal(byAdvisory.active.length, 2);

  const byPackage = applyIgnores(findings, [{ package: "lodash", reason: "internal tool" }], NOW, true);
  assert.equal(byPackage.ignored.length, 2);
  assert.deepEqual(byPackage.active.map((f) => f.package), ["express"]);
});

test("expired ignore rules stop applying and warn", () => {
  const rules = [{ package: "lodash", reason: "temporary", expires: "2026-06-14" }];
  const result = applyIgnores([vuln("lodash", "high")], rules, NOW, true);
  assert.equal(result.ignored.length, 0);
  assert.equal(result.active.length, 1);
  assert.match(result.warnings.join(" "), /expired on 2026-06-14/);
});

test("a rule is still valid on its expiry day", () => {
  const rules = [{ package: "lodash", reason: "temporary", expires: "2026-06-15" }];
  const result = applyIgnores([vuln("lodash", "high")], rules, NOW, true);
  assert.equal(result.ignored.length, 1);
});

test("rules that match nothing produce a clean-up warning (only if audit ran)", () => {
  const rules = [{ package: "gone", reason: "old" }];
  assert.match(applyIgnores([], rules, NOW, true).warnings.join(" "), /matches nothing/);
  assert.equal(applyIgnores([], rules, NOW, false).warnings.length, 0);
});

test("buildVerdicts: precedence, transitive packages and ordering", () => {
  const verdicts = buildVerdicts({
    manifest,
    findings: [vuln("lodash", "moderate"), outdated("lodash", "major"), outdated("express", "minor"), vuln("deep-dep", "critical")],
    production: false,
    installed: (name) => (name === "safe" ? "1.2.3" : undefined),
  });
  const byName = Object.fromEntries(verdicts.map((v) => [v.name, v]));
  assert.equal(byName["lodash"]?.status, "vulnerable");
  assert.equal(byName["express"]?.status, "outdated");
  assert.equal(byName["safe"]?.status, "safe");
  assert.equal(byName["safe"]?.current, "1.2.3");
  assert.equal(byName["deep-dep"]?.type, "transitive");
  assert.equal(byName["jest"]?.type, "devDependencies");
  // critical transitive first, then moderate direct, then outdated, then safe
  assert.deepEqual(verdicts.slice(0, 3).map((v) => v.name), ["deep-dep", "lodash", "express"]);
  assert.equal(verdicts.at(-1)?.status, "safe");
});

test("buildVerdicts: production mode leaves out devDependencies", () => {
  const verdicts = buildVerdicts({ manifest, findings: [outdated("jest", "major")], production: true, installed: () => undefined });
  assert.ok(!verdicts.some((v) => v.name === "jest"));
});

test("buildVerdicts: fit hints never change status", () => {
  const verdicts = buildVerdicts({
    manifest,
    findings: [{ kind: "fit", package: "safe", message: "use fetch" }],
    production: false,
    installed: () => undefined,
  });
  assert.equal(verdicts.find((v) => v.name === "safe")?.status, "safe");
});

function policyFor(config: Partial<ResolvedConfig>, findings: Finding[]) {
  const verdicts = buildVerdicts({ manifest, findings, production: false, installed: () => undefined });
  return evaluatePolicy(verdicts, { ...DEFAULT_CONFIG, ...config });
}

test("failOn controls which severities block", () => {
  const findings = [vuln("lodash", "moderate"), vuln("express", "high")];
  assert.equal(policyFor({ failOn: "high" }, findings).length, 1);
  assert.equal(policyFor({ failOn: "moderate" }, findings).length, 2);
  assert.equal(policyFor({ failOn: "critical" }, findings).length, 0);
  assert.equal(policyFor({ failOn: "none" }, findings).length, 0);
});

test("outdated.failOn thresholds", () => {
  const findings = [outdated("lodash", "patch"), outdated("express", "major")];
  const withThreshold = (failOn: "never" | "patch" | "minor" | "major") =>
    policyFor({ outdated: { failOn, ignore: [] } }, findings).length;
  assert.equal(withThreshold("never"), 0);
  assert.equal(withThreshold("patch"), 2);
  assert.equal(withThreshold("minor"), 1);
  assert.equal(withThreshold("major"), 1);
});

test("unused only blocks when unused.fail is true", () => {
  const findings: Finding[] = [{ kind: "unused", package: "safe", message: "unused" }];
  assert.equal(policyFor({}, findings).length, 0);
  assert.equal(policyFor({ unused: { fail: true, ignore: [], sourceDirs: [] } }, findings).length, 1);
});

test("summarize counts statuses and severities", () => {
  const verdicts = buildVerdicts({ manifest, findings: [vuln("lodash", "high"), vuln("lodash", "low"), outdated("express", "minor")], production: false, installed: () => undefined });
  const summary = summarize(verdicts);
  assert.equal(summary.vulnerable, 1);
  assert.equal(summary.outdated, 1);
  assert.equal(summary.safe, 2);
  assert.equal(summary.vulnerabilitiesBySeverity.high, 1);
  assert.equal(summary.vulnerabilitiesBySeverity.low, 1);
  assert.equal(summary.total, 4);
});
