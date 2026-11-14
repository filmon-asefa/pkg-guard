import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { parseOutdatedReport, runOutdated } from "../src/scanners/outdated.js";
import type { ScannerContext } from "../src/scanners/context.js";
import { OUTDATED_FIXTURE, fakeRunner } from "./helpers.js";

function context(outdated: Parameters<typeof fakeRunner>[0]["outdated"], production = false): ScannerContext {
  return {
    cwd: process.cwd(),
    run: fakeRunner({ outdated }),
    config: { ...DEFAULT_CONFIG, production },
    manifest: {
      name: "t", version: "1.0.0", dependencies: { express: "^4.17.1" }, devDependencies: { chalk: "^5.3.0" },
      optionalDependencies: {}, scripts: {}, hasWorkspaces: false, otherFieldsText: "{}",
    },
  };
}

test("parseOutdatedReport classifies updates and suggests fixes", () => {
  const { findings, warnings } = parseOutdatedReport(OUTDATED_FIXTURE);
  const express = findings.find((f) => f.package === "express");
  assert.equal(express?.updateType, "major");
  assert.equal(express?.fixIsBreaking, true);
  assert.match(express?.fix ?? "", /npm update express/);
  assert.match(express?.fix ?? "", /express@5\.1\.0/);

  const chalk = findings.find((f) => f.package === "chalk");
  assert.equal(chalk?.updateType, "minor");
  assert.equal(chalk?.fix, "npm install chalk@5.4.1");

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /missing is listed in package.json but is not installed/);
});

test("parseOutdatedReport uses `npm update` when wanted equals latest", () => {
  const { findings } = parseOutdatedReport({ a: { current: "1.0.0", wanted: "1.2.0", latest: "1.2.0" } });
  assert.equal(findings[0]?.fix, "npm update a");
  assert.equal(findings[0]?.fixIsBreaking, false);
});

test("parseOutdatedReport accepts arrays for multi-location packages", () => {
  const { findings } = parseOutdatedReport({ a: [{ current: "1.0.0", wanted: "1.0.0", latest: "1.0.1" }] });
  assert.equal(findings.length, 1);
});

test("parseOutdatedReport skips packages that are not older than latest", () => {
  const { findings } = parseOutdatedReport({ a: { current: "2.0.0", wanted: "2.0.0", latest: "1.0.0" } });
  assert.equal(findings.length, 0);
});

test("runOutdated: empty output with exit code 0 means everything is current", async () => {
  const outcome = await runOutdated(context({ stdout: "", stderr: "", code: 0 }));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.findings.length, 0);
});

test("runOutdated: empty output with an npm error is reported as a failure", async () => {
  const outcome = await runOutdated(context({ stdout: "", stderr: "npm error network request failed", code: 1 }));
  assert.equal(outcome.ok, false);
  assert.match(outcome.error ?? "", /network request failed/);
});

test("runOutdated: production mode drops dev-only packages", async () => {
  const all = await runOutdated(context(OUTDATED_FIXTURE, false));
  const prod = await runOutdated(context(OUTDATED_FIXTURE, true));
  assert.ok(all.findings.some((f) => f.package === "chalk"));
  assert.ok(!prod.findings.some((f) => f.package === "chalk"));
  assert.ok(prod.findings.some((f) => f.package === "express"));
});

test("runOutdated handles spawn errors and bad JSON", async () => {
  assert.match((await runOutdated(context({ spawnError: "spawn npm ENOENT", code: null }))).error ?? "", /Could not run npm/);
  assert.match((await runOutdated(context("nope"))).error ?? "", /not valid JSON/);
});
