import assert from "node:assert/strict";
import { test } from "node:test";
import { formatJson, formatMarkdown, formatText, shouldUseColor } from "../src/report.js";
import { scan } from "../src/scan.js";
import { AUDIT_FIXTURE, OUTDATED_FIXTURE, fakeInstall, fakeRunner, makeProject, removeProject } from "./helpers.js";

async function sampleResult() {
  const dir = makeProject({
    "package.json": { name: "demo", version: "2.0.0", dependencies: { lodash: "^4.17.1", express: "^4.17.1", axios: "^1.0.0" } },
    "package-lock.json": {},
    "src/a.js": 'require("lodash"); require("express");',
  });
  for (const n of ["lodash", "express", "axios"]) fakeInstall(dir, n);
  try {
    return await scan({ cwd: dir, run: fakeRunner({ audit: AUDIT_FIXTURE, outdated: OUTDATED_FIXTURE }), now: new Date("2026-06-15T00:00:00Z") });
  } finally {
    removeProject(dir);
  }
}

test("text report shows verdicts, fixes and the final result without colors", async () => {
  const result = await sampleResult();
  const text = formatText(result, { color: false, verbose: false, quiet: false });
  assert.match(text, /\[VULNERABLE\] lodash/);
  assert.match(text, /fix: npm install lodash@4\.17\.21/);
  assert.match(text, /\[OUTDATED\]\s+express/);
  assert.match(text, /\[UNUSED\]\s+axios/);
  assert.match(text, /FAILED: 1 policy violation/);
  assert.doesNotMatch(text, /\u001b\[/);
  assert.doesNotMatch(text, /hint:/);
});

test("text report: verbose shows hints, quiet hides details, color adds escape codes", async () => {
  const result = await sampleResult();
  assert.match(formatText(result, { color: false, verbose: true, quiet: false }), /hint: Node\.js 18\+ has a built-in fetch/);
  const quiet = formatText(result, { color: false, verbose: false, quiet: true });
  assert.doesNotMatch(quiet, /\[VULNERABLE\]/);
  assert.match(quiet, /FAILED/);
  assert.match(formatText(result, { color: true, verbose: false, quiet: false }), /\u001b\[31m/);
});

test("json report is valid and complete", async () => {
  const result = await sampleResult();
  const parsed = JSON.parse(formatJson(result)) as typeof result;
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.tool, "pkg-guard");
  assert.equal(parsed.exitCode, 1);
  assert.ok(Array.isArray(parsed.verdicts));
});

test("markdown report has tables and sections", async () => {
  const markdown = formatMarkdown(await sampleResult());
  assert.match(markdown, /^## pkg-guard report: demo@2\.0\.0/);
  assert.match(markdown, /### Vulnerabilities/);
  assert.match(markdown, /\| lodash \|/);
  assert.match(markdown, /### Why it failed/);
});

test("shouldUseColor honours NO_COLOR, FORCE_COLOR, flags and TTY", () => {
  assert.equal(shouldUseColor({ isTTY: true }, {}, false), true);
  assert.equal(shouldUseColor({ isTTY: false }, {}, false), false);
  assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: "1" }, false), false);
  assert.equal(shouldUseColor({ isTTY: false }, { FORCE_COLOR: "1" }, false), true);
  assert.equal(shouldUseColor({ isTTY: true }, {}, true), false);
  assert.equal(shouldUseColor({ isTTY: true }, { TERM: "dumb" }, false), false);
});
