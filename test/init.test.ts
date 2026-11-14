import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { resolveConfig } from "../src/config.js";
import { initProject } from "../src/init.js";
import { makeProject, removeProject } from "./helpers.js";

test("init writes a valid config and adds the guard script, keeping indentation", () => {
  const dir = makeProject({ "package.json": '{\n    "name": "a",\n    "scripts": { "build": "tsc" }\n}\n' });
  try {
    initProject({ cwd: dir, force: false, hooks: false });
    const config = JSON.parse(fs.readFileSync(path.join(dir, "pkg-guard.config.json"), "utf8")) as unknown;
    assert.doesNotThrow(() => resolveConfig(config));
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    assert.match(raw, /^ {4}"name"/m);
    assert.ok(raw.endsWith("\n"));
    const manifest = JSON.parse(raw) as { scripts: Record<string, string> };
    assert.equal(manifest.scripts["guard"], "pkg-guard scan");
    assert.equal(manifest.scripts["prebuild"], undefined);
  } finally {
    removeProject(dir);
  }
});

test("init --hooks chains onto existing scripts and is idempotent", () => {
  const dir = makeProject({ "package.json": { name: "a", scripts: { build: "tsc", prebuild: "rimraf dist", start: "node ." } } });
  try {
    initProject({ cwd: dir, force: false, hooks: true });
    initProject({ cwd: dir, force: false, hooks: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.equal(manifest.scripts["prebuild"], "pkg-guard scan --quiet && rimraf dist");
    assert.equal(manifest.scripts["prestart"], "pkg-guard scan --quiet");
  } finally {
    removeProject(dir);
  }
});

test("init does not overwrite an existing config without --force", () => {
  const dir = makeProject({ "package.json": { name: "a" }, "pkg-guard.config.json": '{ "failOn": "low" }' });
  try {
    const kept = initProject({ cwd: dir, force: false, hooks: false });
    assert.match(kept.messages.join(" "), /already exists/);
    assert.equal((JSON.parse(fs.readFileSync(path.join(dir, "pkg-guard.config.json"), "utf8")) as { failOn: string }).failOn, "low");
    initProject({ cwd: dir, force: true, hooks: false });
    assert.equal((JSON.parse(fs.readFileSync(path.join(dir, "pkg-guard.config.json"), "utf8")) as { failOn: string }).failOn, "high");
  } finally {
    removeProject(dir);
  }
});

test("init fails clearly without a package.json", () => {
  const dir = makeProject({ "x.txt": "x" });
  try {
    assert.throws(() => initProject({ cwd: dir, force: false, hooks: false }), /No package.json/);
  } finally {
    removeProject(dir);
  }
});
