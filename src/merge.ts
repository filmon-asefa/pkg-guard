import { SEVERITY_RANK } from "./types.js";
import type {
  DependencyType,
  Finding,
  Manifest,
  PackageVerdict,
  Severity,
  Status,
  Summary,
} from "./types.js";

export interface MergeInput {
  manifest: Manifest;
  findings: Finding[];
  production: boolean;
  /** Looks up the installed version of a package (node_modules). */
  installed: (name: string) => string | undefined;
}

const STATUS_ORDER: Record<Status, number> = { vulnerable: 0, outdated: 1, unused: 2, safe: 3 };

function statusOf(findings: Finding[]): Status {
  if (findings.some((f) => f.kind === "vulnerability")) return "vulnerable";
  if (findings.some((f) => f.kind === "outdated")) return "outdated";
  if (findings.some((f) => f.kind === "unused")) return "unused";
  return "safe";
}

function worstSeverity(verdict: PackageVerdict): number {
  return Math.max(0, ...verdict.findings.map((f) => (f.severity ? SEVERITY_RANK[f.severity] : 0)));
}

/**
 * Groups all findings by package into one verdict each. Every direct
 * dependency gets a verdict (even when it is safe); transitive packages only
 * appear when something was found about them.
 */
export function buildVerdicts(input: MergeInput): PackageVerdict[] {
  const { manifest, findings, production, installed } = input;
  const verdicts = new Map<string, PackageVerdict>();

  const addDirect = (map: Record<string, string>, type: DependencyType): void => {
    for (const [name, spec] of Object.entries(map)) {
      if (verdicts.has(name)) continue;
      const verdict: PackageVerdict = { name, type, spec, status: "safe", findings: [] };
      const version = installed(name);
      if (version) verdict.current = version;
      verdicts.set(name, verdict);
    }
  };
  addDirect(manifest.dependencies, "dependencies");
  addDirect(manifest.optionalDependencies, "optionalDependencies");
  if (!production) addDirect(manifest.devDependencies, "devDependencies");

  for (const finding of findings) {
    let verdict = verdicts.get(finding.package);
    if (!verdict) {
      // Findings for packages we did not seed: transitive dependencies, or
      // dev dependencies that are excluded in production mode.
      if (finding.kind !== "vulnerability") continue;
      verdict = { name: finding.package, type: "transitive", status: "safe", findings: [] };
      const version = installed(finding.package);
      if (version) verdict.current = version;
      verdicts.set(finding.package, verdict);
    }
    verdict.findings.push(finding);
    if (finding.kind === "outdated") {
      if (finding.latest) verdict.latest = finding.latest;
      // npm's own report is the authority for the version it compared.
      if (finding.current) verdict.current = finding.current;
    }
  }

  const result = [...verdicts.values()];
  for (const verdict of result) verdict.status = statusOf(verdict.findings);

  result.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    const bySeverity = worstSeverity(b) - worstSeverity(a);
    if (bySeverity !== 0) return bySeverity;
    return a.name.localeCompare(b.name);
  });
  return result;
}

export function summarize(verdicts: PackageVerdict[]): Summary {
  const summary: Summary = {
    total: verdicts.length,
    safe: 0,
    outdated: 0,
    vulnerable: 0,
    unused: 0,
    vulnerabilitiesBySeverity: { low: 0, moderate: 0, high: 0, critical: 0 },
  };
  for (const verdict of verdicts) {
    summary[verdict.status]++;
    for (const finding of verdict.findings) {
      if (finding.kind === "vulnerability") {
        const severity: Severity = finding.severity ?? "moderate";
        summary.vulnerabilitiesBySeverity[severity]++;
      }
    }
  }
  return summary;
}
