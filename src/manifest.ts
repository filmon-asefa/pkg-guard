import * as fs from "node:fs";
import * as path from "node:path";
import { UsageError, isRecord } from "./errors.js";
import type { Manifest } from "./types.js";

function stringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

export function readManifest(cwd: string): Manifest {
  const file = path.join(cwd, "package.json");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`No package.json found in ${cwd}. Run pkg-guard from your project's root folder (or use --cwd).`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    throw new UsageError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(json)) throw new UsageError(`${file} must contain a JSON object.`);

  const engines = isRecord(json["engines"]) ? json["engines"] : {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    if (!["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].includes(key)) {
      rest[key] = value;
    }
  }

  const manifest: Manifest = {
    name: typeof json["name"] === "string" ? json["name"] : path.basename(cwd),
    version: typeof json["version"] === "string" ? json["version"] : "0.0.0",
    dependencies: stringMap(json["dependencies"]),
    devDependencies: stringMap(json["devDependencies"]),
    optionalDependencies: stringMap(json["optionalDependencies"]),
    scripts: stringMap(json["scripts"]),
    hasWorkspaces: json["workspaces"] !== undefined,
    otherFieldsText: JSON.stringify(rest),
  };
  if (typeof engines["node"] === "string") manifest.enginesNode = engines["node"];
  return manifest;
}

/** Installed version of a package, read from node_modules. Undefined if not installed. */
export function installedVersion(cwd: string, name: string): string | undefined {
  try {
    const file = path.join(cwd, "node_modules", ...name.split("/"), "package.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (isRecord(json) && typeof json["version"] === "string") return json["version"];
  } catch {
    /* not installed or unreadable */
  }
  return undefined;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "none";

/** Detects the package manager from the lockfile. */
export function detectPackageManager(cwd: string): PackageManager {
  const has = (file: string): boolean => fs.existsSync(path.join(cwd, file));
  if (has("package-lock.json") || has("npm-shrinkwrap.json")) return "npm";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  return "none";
}
