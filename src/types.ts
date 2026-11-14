/**
 * Shared types for pkg-guard.
 *
 * Every scanner produces `Finding`s. The merge step groups findings per
 * package into a `PackageVerdict`, and the policy step turns verdicts into
 * `Violation`s that decide the exit code.
 */

export type Severity = "low" | "moderate" | "high" | "critical";

export const SEVERITIES: readonly Severity[] = ["low", "moderate", "high", "critical"];

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

export type UpdateType = "patch" | "minor" | "major" | "unknown";

export type FindingKind = "vulnerability" | "outdated" | "unused" | "fit";

/** Overall state of one package. Precedence: vulnerable > outdated > unused > safe. */
export type Status = "safe" | "outdated" | "vulnerable" | "unused";

export type DependencyType =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "transitive";

export type ScannerName = "audit" | "outdated" | "unused" | "fit";

export const SCANNER_NAMES: readonly ScannerName[] = ["audit", "outdated", "unused", "fit"];

export interface Finding {
  kind: FindingKind;
  /** Name of the package the finding is about. */
  package: string;
  /** Human readable, one line. */
  message: string;
  /** Only for `vulnerability`. */
  severity?: Severity;
  /** Only for `vulnerability`: GHSA ids and numeric npm advisory ids. */
  advisoryIds?: string[];
  /** Link with more information (advisory page). */
  url?: string;
  /** Suggested command or hint. pkg-guard never runs it for you. */
  fix?: string;
  /** True when applying `fix` is a semver-major (possibly breaking) change. */
  fixIsBreaking?: boolean;
  /** Only for `outdated`. */
  updateType?: UpdateType;
  current?: string;
  wanted?: string;
  latest?: string;
}

export interface ScannerOutcome {
  scanner: ScannerName;
  /** False when the scanner could not complete (see `error`). */
  ok: boolean;
  findings: Finding[];
  warnings: string[];
  error?: string;
}

export interface PackageVerdict {
  name: string;
  type: DependencyType;
  /** Version range from package.json (direct dependencies only). */
  spec?: string;
  /** Installed version, when known. */
  current?: string;
  latest?: string;
  status: Status;
  findings: Finding[];
}

export interface Violation {
  rule: "vulnerability" | "outdated" | "unused";
  package: string;
  message: string;
}

export interface IgnoredFinding {
  finding: Finding;
  reason: string;
  expires?: string;
}

export interface ScannerError {
  scanner: ScannerName;
  message: string;
}

export interface Summary {
  total: number;
  safe: number;
  outdated: number;
  vulnerable: number;
  unused: number;
  vulnerabilitiesBySeverity: Record<Severity, number>;
}

export interface ScanResult {
  schemaVersion: 1;
  tool: "pkg-guard";
  version: string;
  project: { name: string; version: string; directory: string };
  generatedAt: string;
  durationMs: number;
  /** Scanners that ran (or were attempted). */
  scanners: ScannerName[];
  verdicts: PackageVerdict[];
  violations: Violation[];
  ignored: IgnoredFinding[];
  warnings: string[];
  scannerErrors: ScannerError[];
  summary: Summary;
  /** True when there are no violations (and, in strict mode, no scanner errors). */
  passed: boolean;
  /** 0 = ok, 1 = policy violation, 2 = scanner/usage error (strict mode). */
  exitCode: 0 | 1 | 2;
}

/** Minimal view of the project's package.json. */
export interface Manifest {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  scripts: Record<string, string>;
  enginesNode?: string;
  hasWorkspaces: boolean;
  /** Everything in package.json except the dependency sections, as raw JSON. */
  otherFieldsText: string;
}
