import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_FILE_NAME, defaultConfigFileContent } from "./config.js";
import { UsageError, isRecord } from "./errors.js";

export interface InitOptions {
  cwd: string;
  force: boolean;
  hooks: boolean;
}

export interface InitResult {
  messages: string[];
}

function detectIndent(text: string): string | number {
  const match = /^([ \t]+)"/m.exec(text);
  return match?.[1] ?? 2;
}

/**
 * Creates pkg-guard.config.json and adds a "guard" script to package.json.
 * With `hooks`, also runs the scan before `build` and `start`.
 */
export function initProject(options: InitOptions): InitResult {
  const messages: string[] = [];
  const configFile = path.join(options.cwd, CONFIG_FILE_NAME);
  const manifestFile = path.join(options.cwd, "package.json");

  if (!fs.existsSync(manifestFile)) {
    throw new UsageError(`No package.json found in ${options.cwd}. Run \`npm init\` first.`);
  }

  if (fs.existsSync(configFile) && !options.force) {
    messages.push(`${CONFIG_FILE_NAME} already exists (kept as is; use --force to overwrite).`);
  } else {
    fs.writeFileSync(configFile, defaultConfigFileContent());
    messages.push(`Created ${CONFIG_FILE_NAME}.`);
  }

  const raw = fs.readFileSync(manifestFile, "utf8");
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new UsageError(`${manifestFile} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(manifest)) throw new UsageError(`${manifestFile} must contain a JSON object.`);

  const scripts: Record<string, unknown> = isRecord(manifest["scripts"]) ? { ...manifest["scripts"] } : {};
  let changed = false;

  if (scripts["guard"] === undefined) {
    scripts["guard"] = "pkg-guard scan";
    messages.push('Added script "guard" (run it with `npm run guard`).');
    changed = true;
  }

  if (options.hooks) {
    const hookTargets: Array<[string, string]> = [["prebuild", "build"], ["prestart", "start"]];
    for (const [hook, target] of hookTargets) {
      if (scripts[target] === undefined) {
        messages.push(`Skipped "${hook}": there is no "${target}" script.`);
        continue;
      }
      const existing = scripts[hook];
      if (typeof existing === "string" && existing.includes("pkg-guard")) {
        messages.push(`"${hook}" already runs pkg-guard.`);
        continue;
      }
      scripts[hook] = typeof existing === "string" && existing.trim().length > 0
        ? `pkg-guard scan --quiet && ${existing}`
        : "pkg-guard scan --quiet";
      messages.push(`Added "${hook}": pkg-guard now runs before "${target}".`);
      changed = true;
    }
  }

  if (changed) {
    manifest["scripts"] = scripts;
    const trailingNewline = raw.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, detectIndent(raw))}${trailingNewline}`);
  }

  return { messages };
}
