import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RunOptions, RunResult, Runner } from "../src/runner.js";

/** Creates a temporary project folder with the given files. Returns its path. */
export function makeProject(files: Record<string, string | object>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-guard-test-"));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

export function removeProject(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Pretends to be an installed package so the unused check can judge it. */
export function fakeInstall(dir: string, name: string, extra: object = {}): void {
  const folder = path.join(dir, "node_modules", ...name.split("/"));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, version: "1.0.0", ...extra }));
}

export interface FakeNpm {
  audit?: Partial<RunResult> | string | object;
  outdated?: Partial<RunResult> | string | object;
}

function toResult(value: FakeNpm["audit"], defaultCode: number): RunResult {
  if (value === undefined) return { stdout: "", stderr: "", code: 0, timedOut: false };
  if (typeof value === "string") return { stdout: value, stderr: "", code: defaultCode, timedOut: false };
  if ("stdout" in value || "stderr" in value || "spawnError" in value || "code" in value) {
    return { stdout: "", stderr: "", code: defaultCode, timedOut: false, ...(value as Partial<RunResult>) };
  }
  return { stdout: JSON.stringify(value), stderr: "", code: defaultCode, timedOut: false };
}

/** A runner that answers `npm audit` and `npm outdated` with canned output. */
export function fakeRunner(npm: FakeNpm): Runner {
  return (command: string, args: string[], _options: RunOptions): Promise<RunResult> => {
    void _options;
    if (command === "npm" && args[0] === "audit") return Promise.resolve(toResult(npm.audit, 1));
    if (command === "npm" && args[0] === "outdated") return Promise.resolve(toResult(npm.outdated, 1));
    return Promise.reject(new Error(`unexpected command: ${command} ${args.join(" ")}`));
  };
}

export const AUDIT_FIXTURE = {
  auditReportVersion: 2,
  vulnerabilities: {
    lodash: {
      name: "lodash",
      severity: "high",
      isDirect: true,
      via: [
        {
          source: 1106913,
          name: "lodash",
          title: "Prototype Pollution in lodash",
          url: "https://github.com/advisories/GHSA-p6mc-m468-83gw",
          severity: "high",
          range: "<4.17.21",
        },
      ],
      effects: [],
      range: "<4.17.21",
      fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false },
    },
    "left-transitive": {
      name: "left-transitive",
      severity: "moderate",
      isDirect: false,
      via: ["lodash"],
      effects: [],
      range: "*",
      fixAvailable: false,
    },
  },
  metadata: {},
};

export const OUTDATED_FIXTURE = {
  express: { current: "4.17.1", wanted: "4.21.2", latest: "5.1.0", dependent: "app", location: "node_modules/express" },
  chalk: { current: "5.3.0", wanted: "5.3.0", latest: "5.4.1", dependent: "app", location: "node_modules/chalk" },
  missing: { wanted: "1.0.0", latest: "1.0.0", dependent: "app", location: "node_modules/missing" },
};
