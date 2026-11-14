import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { makeProject, removeProject } from "./helpers.js";

// Compiled location: .test-build/test/cli.test.js -> .test-build/src/cli.js
const CLI = path.join(__dirname, "..", "src", "cli.js");

function run(args: string[], cwd?: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test("--version and --help", () => {
  const version = run(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.out.trim(), /^\d+\.\d+\.\d+/);
  const help = run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /USAGE/);
  assert.match(help.out, /--fail-on/);
});

test("unknown options and commands exit with code 2", () => {
  const bad = run(["--nope"]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /pkg-guard: error/);
  assert.equal(run(["explode"]).code, 2);
  assert.equal(run(["--fail-on", "severe"]).code, 2);
  assert.equal(run(["--skip", "audit,wat"]).code, 2);
  assert.equal(run(["--format", "xml"]).code, 2);
});

test("a missing package.json exits with code 2 and a helpful message", () => {
  const dir = makeProject({ "x.txt": "x" });
  try {
    const result = run(["scan"], dir);
    assert.equal(result.code, 2);
    assert.match(result.err, /No package.json found/);
  } finally {
    removeProject(dir);
  }
});

test("an invalid config file exits with code 2", () => {
  const dir = makeProject({ "package.json": { name: "a", version: "1.0.0" }, "pkg-guard.config.json": { failon: "high" } });
  try {
    const result = run(["scan", "--skip", "audit,outdated"], dir);
    assert.equal(result.code, 2);
    assert.match(result.err, /unknown option "failon"/);
  } finally {
    removeProject(dir);
  }
});

test("scan with network checks skipped: json output, --output file, exit 0", () => {
  const dir = makeProject({
    "package.json": { name: "a", version: "1.0.0", dependencies: {} },
    "src/a.js": "console.log(1)",
  });
  try {
    const result = run(["scan", "--skip", "audit,outdated", "--format", "json", "--output", "out/report.json"], dir);
    assert.equal(result.code, 0);
    const printed = JSON.parse(result.out) as { passed: boolean };
    assert.equal(printed.passed, true);
    const written = JSON.parse(fs.readFileSync(path.join(dir, "out", "report.json"), "utf8")) as { passed: boolean };
    assert.equal(written.passed, true);
  } finally {
    removeProject(dir);
  }
});

test("unused.fail turns an unused dependency into exit code 1, and --warn-only turns it back to 0", () => {
  const dir = makeProject({
    "package.json": { name: "a", version: "1.0.0", dependencies: { ghost: "1.0.0" } },
    "pkg-guard.config.json": { unused: { fail: true } },
    "src/a.js": "console.log(1)",
    "node_modules/ghost/package.json": { name: "ghost", version: "1.0.0" },
  });
  try {
    const failing = run(["scan", "--skip", "audit,outdated"], dir);
    assert.equal(failing.code, 1);
    assert.match(failing.out, /FAILED/);
    const warnOnly = run(["scan", "--skip", "audit,outdated", "--warn-only"], dir);
    assert.equal(warnOnly.code, 0);
    assert.match(warnOnly.err, /warn-only/);
  } finally {
    removeProject(dir);
  }
});

test("init creates files and prints next steps", () => {
  const dir = makeProject({ "package.json": { name: "a", version: "1.0.0", scripts: { build: "tsc" } } });
  try {
    const result = run(["init", "--hooks"], dir);
    assert.equal(result.code, 0);
    assert.match(result.out, /Created pkg-guard\.config\.json/);
    assert.ok(fs.existsSync(path.join(dir, "pkg-guard.config.json")));
  } finally {
    removeProject(dir);
  }
});
