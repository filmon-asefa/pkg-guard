import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigError, isRecord } from "./errors.js";
import { SCANNER_NAMES, SEVERITIES } from "./types.js";
import type { ScannerName, Severity } from "./types.js";

export const CONFIG_FILE_NAME = "pkg-guard.config.json";

export type OutdatedFailOn = "never" | "patch" | "minor" | "major";

export interface IgnoreRule {
  /** Package name the rule applies to. */
  package: string;
  /** Optional advisory id (GHSA-xxxx-xxxx-xxxx or numeric id). Without it, ALL advisories of the package are ignored. */
  advisory?: string;
  /** Why this is safe to ignore. Required, so the decision is documented. */
  reason: string;
  /** Optional date (YYYY-MM-DD). After it the rule stops applying. */
  expires?: string;
}

export interface ResolvedConfig {
  failOn: Severity | "none";
  production: boolean;
  strict: boolean;
  timeoutMs: number;
  checks: Record<ScannerName, boolean>;
  outdated: { failOn: OutdatedFailOn; ignore: string[] };
  unused: { fail: boolean; ignore: string[]; sourceDirs: string[] };
  ignore: IgnoreRule[];
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  failOn: "high",
  production: false,
  strict: false,
  timeoutMs: 120_000,
  checks: { audit: true, outdated: true, unused: true, fit: true },
  outdated: { failOn: "never", ignore: [] },
  unused: { fail: false, ignore: [], sourceDirs: [] },
  ignore: [],
};

/** Values given on the command line. They win over the config file. */
export interface ConfigOverrides {
  failOn?: Severity | "none";
  production?: boolean;
  strict?: boolean;
  skip?: ScannerName[];
}

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "failOn",
  "production",
  "strict",
  "timeoutMs",
  "checks",
  "outdated",
  "unused",
  "ignore",
]);

function cloneDefaults(): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    checks: { ...DEFAULT_CONFIG.checks },
    outdated: { failOn: DEFAULT_CONFIG.outdated.failOn, ignore: [] },
    unused: { fail: false, ignore: [], sourceDirs: [] },
    ignore: [],
  };
}

function expectBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new ConfigError(`${where} must be true or false.`);
  return value;
}

function expectStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ConfigError(`${where} must be an array of non-empty strings.`);
  }
  return value as string[];
}

function checkKeys(obj: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        `Unknown option "${key}" in ${where}. Allowed options: ${allowed.join(", ")}.`,
      );
    }
  }
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Validates a raw (parsed JSON) config object and fills in defaults.
 * Unknown keys are rejected so typos do not silently disable protection.
 */
export function resolveConfig(raw: unknown, source = "config"): ResolvedConfig {
  const config = cloneDefaults();
  if (raw === undefined || raw === null) return config;
  if (!isRecord(raw)) throw new ConfigError(`${source}: the configuration must be a JSON object.`);

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new ConfigError(
        `${source}: unknown option "${key}". Allowed options: ${[...TOP_LEVEL_KEYS].filter((k) => k !== "$schema").join(", ")}.`,
      );
    }
  }

  try {
    if (raw["failOn"] !== undefined) {
      const value = raw["failOn"];
      if (value !== "none" && !SEVERITIES.includes(value as Severity)) {
        throw new ConfigError(`"failOn" must be one of: none, ${SEVERITIES.join(", ")}.`);
      }
      config.failOn = value as Severity | "none";
    }
    if (raw["production"] !== undefined) config.production = expectBoolean(raw["production"], '"production"');
    if (raw["strict"] !== undefined) config.strict = expectBoolean(raw["strict"], '"strict"');
    if (raw["timeoutMs"] !== undefined) {
      const value = raw["timeoutMs"];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1000) {
        throw new ConfigError('"timeoutMs" must be an integer of at least 1000.');
      }
      config.timeoutMs = value;
    }

    if (raw["checks"] !== undefined) {
      const checks = raw["checks"];
      if (!isRecord(checks)) throw new ConfigError('"checks" must be an object.');
      checkKeys(checks, [...SCANNER_NAMES], '"checks"');
      for (const name of SCANNER_NAMES) {
        if (checks[name] !== undefined) config.checks[name] = expectBoolean(checks[name], `"checks.${name}"`);
      }
    }

    if (raw["outdated"] !== undefined) {
      const outdated = raw["outdated"];
      if (!isRecord(outdated)) throw new ConfigError('"outdated" must be an object.');
      checkKeys(outdated, ["failOn", "ignore"], '"outdated"');
      if (outdated["failOn"] !== undefined) {
        const value = outdated["failOn"];
        if (value !== "never" && value !== "patch" && value !== "minor" && value !== "major") {
          throw new ConfigError('"outdated.failOn" must be one of: never, patch, minor, major.');
        }
        config.outdated.failOn = value;
      }
      if (outdated["ignore"] !== undefined) {
        config.outdated.ignore = expectStringArray(outdated["ignore"], '"outdated.ignore"');
      }
    }

    if (raw["unused"] !== undefined) {
      const unused = raw["unused"];
      if (!isRecord(unused)) throw new ConfigError('"unused" must be an object.');
      checkKeys(unused, ["fail", "ignore", "sourceDirs"], '"unused"');
      if (unused["fail"] !== undefined) config.unused.fail = expectBoolean(unused["fail"], '"unused.fail"');
      if (unused["ignore"] !== undefined) config.unused.ignore = expectStringArray(unused["ignore"], '"unused.ignore"');
      if (unused["sourceDirs"] !== undefined) {
        config.unused.sourceDirs = expectStringArray(unused["sourceDirs"], '"unused.sourceDirs"');
      }
    }

    if (raw["ignore"] !== undefined) {
      const rules = raw["ignore"];
      if (!Array.isArray(rules)) throw new ConfigError('"ignore" must be an array.');
      config.ignore = rules.map((rule, index): IgnoreRule => {
        const where = `"ignore[${index}]"`;
        if (!isRecord(rule)) throw new ConfigError(`${where} must be an object.`);
        checkKeys(rule, ["package", "advisory", "reason", "expires"], where);
        if (typeof rule["package"] !== "string" || rule["package"].length === 0) {
          throw new ConfigError(`${where}.package is required.`);
        }
        if (typeof rule["reason"] !== "string" || rule["reason"].trim().length === 0) {
          throw new ConfigError(`${where}.reason is required: explain why it is safe to ignore.`);
        }
        const result: IgnoreRule = { package: rule["package"], reason: rule["reason"].trim() };
        if (rule["advisory"] !== undefined) {
          if (typeof rule["advisory"] !== "string" || rule["advisory"].length === 0) {
            throw new ConfigError(`${where}.advisory must be a non-empty string.`);
          }
          result.advisory = rule["advisory"];
        }
        if (rule["expires"] !== undefined) {
          if (typeof rule["expires"] !== "string" || !isValidDate(rule["expires"])) {
            throw new ConfigError(`${where}.expires must be a valid date in YYYY-MM-DD format.`);
          }
          result.expires = rule["expires"];
        }
        return result;
      });
    }
  } catch (error) {
    if (error instanceof ConfigError) throw new ConfigError(`${source}: ${error.message}`);
    throw error;
  }

  return config;
}

export interface LoadedConfig {
  config: ResolvedConfig;
  /** Where the configuration came from, or undefined when defaults were used. */
  source: string | undefined;
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read ${file}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Looks for configuration in this order:
 *   1. the file given with --config
 *   2. pkg-guard.config.json in the project directory
 *   3. the "pkg-guard" key in package.json
 *   4. built-in defaults
 */
export function loadConfig(cwd: string, explicitPath?: string): LoadedConfig {
  if (explicitPath) {
    const file = path.resolve(cwd, explicitPath);
    if (!fs.existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
    return { config: resolveConfig(readJson(file), file), source: file };
  }

  const defaultFile = path.join(cwd, CONFIG_FILE_NAME);
  if (fs.existsSync(defaultFile)) {
    return { config: resolveConfig(readJson(defaultFile), defaultFile), source: defaultFile };
  }

  const manifestFile = path.join(cwd, "package.json");
  if (fs.existsSync(manifestFile)) {
    const manifest = readJson(manifestFile);
    if (isRecord(manifest) && manifest["pkg-guard"] !== undefined) {
      return {
        config: resolveConfig(manifest["pkg-guard"], `${manifestFile} ("pkg-guard")`),
        source: manifestFile,
      };
    }
  }

  return { config: cloneDefaults(), source: undefined };
}

export function applyOverrides(config: ResolvedConfig, overrides: ConfigOverrides): ResolvedConfig {
  const result: ResolvedConfig = {
    ...config,
    checks: { ...config.checks },
    outdated: { ...config.outdated, ignore: [...config.outdated.ignore] },
    unused: { ...config.unused, ignore: [...config.unused.ignore], sourceDirs: [...config.unused.sourceDirs] },
    ignore: [...config.ignore],
  };
  if (overrides.failOn !== undefined) result.failOn = overrides.failOn;
  if (overrides.production !== undefined) result.production = overrides.production;
  if (overrides.strict !== undefined) result.strict = overrides.strict;
  for (const name of overrides.skip ?? []) result.checks[name] = false;
  return result;
}

/** The file written by `pkg-guard init`. */
export function defaultConfigFileContent(): string {
  const content = {
    $schema: "./node_modules/pkg-guard/schema.json",
    failOn: DEFAULT_CONFIG.failOn,
    production: DEFAULT_CONFIG.production,
    strict: DEFAULT_CONFIG.strict,
    checks: DEFAULT_CONFIG.checks,
    outdated: { failOn: DEFAULT_CONFIG.outdated.failOn, ignore: [] },
    unused: { fail: false, ignore: [], sourceDirs: [] },
    ignore: [],
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}
