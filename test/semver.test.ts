import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyUpdate, minNodeMajor, parseVersion } from "../src/semver.js";

test("parseVersion reads normal and prerelease versions", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(parseVersion("v2.0.0-beta.1"), { major: 2, minor: 0, patch: 0, prerelease: ["beta", "1"] });
  assert.equal(parseVersion("not-a-version"), undefined);
  assert.equal(parseVersion("1.2"), undefined);
});

test("classifyUpdate detects major, minor and patch jumps", () => {
  assert.equal(classifyUpdate("1.2.3", "2.0.0"), "major");
  assert.equal(classifyUpdate("1.2.3", "1.3.0"), "minor");
  assert.equal(classifyUpdate("1.2.3", "1.2.4"), "patch");
});

test("classifyUpdate returns none when not newer", () => {
  assert.equal(classifyUpdate("1.2.3", "1.2.3"), "none");
  assert.equal(classifyUpdate("2.0.0", "1.9.9"), "none");
  assert.equal(classifyUpdate("2.0.0-beta.1", "2.0.0-alpha.9"), "none");
});

test("classifyUpdate treats a release as newer than its prerelease", () => {
  assert.equal(classifyUpdate("2.0.0-rc.1", "2.0.0"), "patch");
  assert.equal(classifyUpdate("2.0.0-beta.2", "2.0.0-beta.10"), "patch");
});

test("classifyUpdate returns unknown for unparseable versions", () => {
  assert.equal(classifyUpdate("workspace:*", "1.0.0"), "unknown");
});

test("minNodeMajor extracts the minimum major version", () => {
  assert.equal(minNodeMajor(">=18"), 18);
  assert.equal(minNodeMajor("^20.11.0"), 20);
  assert.equal(minNodeMajor(">=16.0.0 <22"), 16);
  assert.equal(minNodeMajor(undefined), undefined);
  assert.equal(minNodeMajor("lts"), undefined);
});
