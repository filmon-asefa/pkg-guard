import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseAuditReport, runAudit } from "../src/scanners/audit.js";
import type { ScannerContext } from "../src/scanners/context.js";
import { AUDIT_FIXTURE, fakeRunner } from "./helpers.js";

function context(audit: Parameters<typeof fakeRunner>[0]["audit"], production = false): ScannerContext {
  return {
    cwd: process.cwd(),
    run: fakeRunner({ audit }),
    config: { ...DEFAULT_CONFIG, production },
    manifest: {
      name: "t", version: "1.0.0", dependencies: {}, devDependencies: {}, optionalDependencies: {},
      scripts: {}, hasWorkspaces: false, otherFieldsText: "{}",
    },
  };
}

test("parseAuditReport turns advisories into findings with ids and fixes", () => {
  const { findings } = parseAuditReport(AUDIT_FIXTURE);
  const lodash = findings.find((f) => f.package === "lodash");
  assert.ok(lodash);
  assert.equal(lodash.severity, "high");
  assert.equal(lodash.fix, "npm install lodash@4.17.21");
  assert.equal(lodash.fixIsBreaking, false);
  assert.deepEqual(lodash.advisoryIds, ["GHSA-p6mc-m468-83gw", "1106913"]);
  assert.match(lodash.message, /Prototype Pollution/);
});

test("parseAuditReport describes transitive-only vulnerabilities", () => {
  const { findings } = parseAuditReport(AUDIT_FIXTURE);
  const transitive = findings.find((f) => f.package === "left-transitive");
  assert.ok(transitive);
  assert.equal(transitive.severity, "moderate");
  assert.match(transitive.message, /through its dependency: lodash/);
  assert.equal(transitive.fix, undefined);
});

test("parseAuditReport flags breaking fixes", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      x: { severity: "critical", via: [{ source: 1, title: "Bad", severity: "critical" }], fixAvailable: { name: "x", version: "3.0.0", isSemVerMajor: true } },
    },
  };
  const [finding] = parseAuditReport(report).findings;
  assert.equal(finding?.fixIsBreaking, true);
});

test("parseAuditReport rejects unknown formats", () => {
  assert.throws(() => parseAuditReport({ advisories: {} }), /Unrecognised/);
  assert.throws(() => parseAuditReport(null), /Unrecognised/);
});

test("runAudit returns findings on success (npm exits 1 when vulnerabilities exist)", async () => {
  const outcome = await runAudit(context(AUDIT_FIXTURE));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.findings.length, 2);
});

test("runAudit with a clean report returns no findings", async () => {
  const outcome = await runAudit(context({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.findings.length, 0);
});

test("runAudit reports a helpful error when there is no lockfile", async () => {
  const outcome = await runAudit(context({ error: { code: "ENOLOCK", summary: "This command requires an existing lockfile.", detail: "" } }));
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? "", /ENOLOCK/);
  assert.match(outcome.error ?? "", /npm install/);
});

test("runAudit reports network problems", async () => {
  const outcome = await runAudit(context({ error: { code: "ENOTFOUND", summary: "request failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org" } }));
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? "", /internet connection/);
});

test("runAudit handles spawn errors, timeouts, empty and invalid output", async () => {
  assert.match((await runAudit(context({ spawnError: "spawn npm ENOENT", code: null }))).error ?? "", /Could not run npm/);
  assert.match((await runAudit(context({ spawnError: "killed", code: null, timedOut: true }))).error ?? "", /timed out/);
  assert.match((await runAudit(context({ stdout: "", stderr: "npm error boom", code: 1 }))).error ?? "", /no output: npm error boom/);
  assert.match((await runAudit(context("this is not json"))).error ?? "", /not valid JSON/);
});
