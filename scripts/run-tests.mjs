// Compiles the TypeScript sources and tests, then runs them with Node's built-in test runner.
// Written as a script (instead of a shell one-liner) so it works the same on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, ".test-build");

rmSync(build, { recursive: true, force: true });

const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");
const compile = spawnSync(
  process.execPath,
  [tscBin, "-p", join(root, "tsconfig.test.json"), ...process.argv.slice(2).filter((a) => a.startsWith("--typeRoots") || a.startsWith("--types"))],
  { cwd: root, stdio: "inherit" },
);
if (compile.status !== 0) {
  console.error("TypeScript compilation failed.");
  process.exit(compile.status ?? 1);
}

const testDir = join(build, "test");
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => join(testDir, name));

const run = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
process.exit(run.status ?? 1);
