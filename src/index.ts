/**
 * Programmatic API of pkg-guard.
 *
 *   import { scan } from "@filmona/pkg-guard";
 *   const result = await scan({ cwd: process.cwd() });
 *   if (!result.passed) process.exitCode = result.exitCode;
 */
export { scan } from "./scan.js";
export type { ScanOptions } from "./scan.js";
export { loadConfig, resolveConfig, DEFAULT_CONFIG, CONFIG_FILE_NAME } from "./config.js";
export type { ResolvedConfig, IgnoreRule, ConfigOverrides, OutdatedFailOn } from "./config.js";
export { formatText, formatJson, formatMarkdown } from "./report.js";
export type { ReportFormat, TextOptions } from "./report.js";
export { ConfigError, UsageError } from "./errors.js";
export type { Runner, RunResult, RunOptions } from "./runner.js";
export type {
  Finding,
  FindingKind,
  PackageVerdict,
  ScanResult,
  ScannerName,
  Severity,
  Status,
  Summary,
  UpdateType,
  Violation,
} from "./types.js";
