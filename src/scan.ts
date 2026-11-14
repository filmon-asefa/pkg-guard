import * as path from "node:path";
import { applyOverrides, loadConfig, resolveConfig } from "./config.js";
import type { ConfigOverrides, ResolvedConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { detectPackageManager, installedVersion, readManifest } from "./manifest.js";
import { buildVerdicts, summarize } from "./merge.js";
import { applyIgnores, evaluatePolicy } from "./policy.js";
import { defaultRunner } from "./runner.js";
import type { Runner } from "./runner.js";
import { runAudit } from "./scanners/audit.js";
import type { ScannerContext } from "./scanners/context.js";
import { runFit } from "./scanners/fit.js";
import { runOutdated } from "./scanners/outdated.js";
import { globToRegExp, runUnused } from "./scanners/unused.js";
import type { Finding, ScanResult, ScannerError, ScannerName, ScannerOutcome } from "./types.js";
import { getToolVersion } from "./version.js";

export interface ScanOptions {
  /** Project folder. Defaults to the current working directory. */
  cwd?: string;
  /** Path to a config file. Defaults to pkg-guard.config.json / package.json "pkg-guard". */
  configPath?: string;
  /** Configuration object (same shape as the JSON file). If given, no config file is read. */
  config?: unknown;
  /** Overrides applied on top of the configuration (what CLI flags do). */
  overrides?: ConfigOverrides;
  /** Custom command runner (used in tests). */
  run?: Runner;
  /** Current time (used in tests). */
  now?: Date;
}

function failedOutcome(scanner: ScannerName, error: string): ScannerOutcome {
  return { scanner, ok: false, findings: [], warnings: [], error };
}

async function guarded(scanner: ScannerName, task: () => Promise<ScannerOutcome> | ScannerOutcome): Promise<ScannerOutcome> {
  try {
    return await task();
  } catch (error) {
    return failedOutcome(scanner, `Unexpected error: ${errorMessage(error)}`);
  }
}

/** Runs all enabled checks and returns a complete, serialisable result. Never throws for scanner failures. */
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
  const started = Date.now();
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const now = options.now ?? new Date();

  const manifest = readManifest(cwd);

  let config: ResolvedConfig =
    options.config !== undefined ? resolveConfig(options.config, "config option") : loadConfig(cwd, options.configPath).config;
  if (options.overrides) config = applyOverrides(config, options.overrides);

  const ctx: ScannerContext = { cwd, run: options.run ?? defaultRunner, config, manifest };
  const packageManager = detectPackageManager(cwd);
  const unsupported = packageManager === "pnpm" || packageManager === "yarn" || packageManager === "bun";
  const unsupportedMessage = `This project uses ${packageManager}. Vulnerability and outdated checks currently support npm projects (package-lock.json) only.`;

  const tasks: Array<Promise<ScannerOutcome>> = [];
  const attempted: ScannerName[] = [];
  if (config.checks.audit) {
    attempted.push("audit");
    tasks.push(guarded("audit", () => (unsupported ? failedOutcome("audit", unsupportedMessage) : runAudit(ctx))));
  }
  if (config.checks.outdated) {
    attempted.push("outdated");
    tasks.push(guarded("outdated", () => (unsupported ? failedOutcome("outdated", unsupportedMessage) : runOutdated(ctx))));
  }
  if (config.checks.unused) {
    attempted.push("unused");
    tasks.push(guarded("unused", () => runUnused(ctx)));
  }
  if (config.checks.fit) {
    attempted.push("fit");
    tasks.push(guarded("fit", () => runFit(ctx)));
  }
  const outcomes = await Promise.all(tasks);

  const warnings: string[] = [];
  const scannerErrors: ScannerError[] = [];
  const allFindings: Finding[] = [];
  const outdatedIgnore = config.outdated.ignore.map(globToRegExp);

  for (const outcome of outcomes) {
    warnings.push(...outcome.warnings);
    if (!outcome.ok && outcome.error) scannerErrors.push({ scanner: outcome.scanner, message: outcome.error });
    for (const finding of outcome.findings) {
      if (finding.kind === "outdated" && outdatedIgnore.some((re) => re.test(finding.package))) continue;
      allFindings.push(finding);
    }
  }

  if (!unsupported && detectPackageManager(cwd) === "none" && (config.checks.audit || config.checks.outdated)) {
    warnings.push("No package-lock.json found. Run `npm install` so vulnerabilities can be checked.");
  }

  const auditOutcome = outcomes.find((o) => o.scanner === "audit");
  const vulnerabilities = allFindings.filter((f) => f.kind === "vulnerability");
  const others = allFindings.filter((f) => f.kind !== "vulnerability");
  const ignoreOutcome = applyIgnores(vulnerabilities, config.ignore, now, auditOutcome?.ok === true);
  warnings.push(...ignoreOutcome.warnings);

  const verdicts = buildVerdicts({
    manifest,
    findings: [...ignoreOutcome.active, ...others],
    production: config.production,
    installed: (name) => installedVersion(cwd, name),
  });
  const violations = evaluatePolicy(verdicts, config);

  let exitCode: 0 | 1 | 2 = 0;
  if (violations.length > 0) exitCode = 1;
  else if (config.strict && scannerErrors.length > 0) exitCode = 2;

  if (!config.strict) {
    for (const error of scannerErrors) {
      warnings.unshift(`The ${error.scanner} check could not run and was skipped: ${error.message}`);
    }
  }

  return {
    schemaVersion: 1,
    tool: "pkg-guard",
    version: getToolVersion(),
    project: { name: manifest.name, version: manifest.version, directory: cwd },
    generatedAt: now.toISOString(),
    durationMs: Date.now() - started,
    scanners: attempted,
    verdicts,
    violations,
    ignored: ignoreOutcome.ignored,
    warnings,
    scannerErrors,
    summary: summarize(verdicts),
    passed: exitCode === 0,
    exitCode,
  };
}
