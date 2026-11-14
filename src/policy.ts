import type { IgnoreRule, ResolvedConfig } from "./config.js";
import { UPDATE_RANK } from "./semver.js";
import { SEVERITY_RANK } from "./types.js";
import type { Finding, IgnoredFinding, PackageVerdict, Violation } from "./types.js";

export interface IgnoreOutcome {
  active: Finding[];
  ignored: IgnoredFinding[];
  warnings: string[];
}

function ruleIsExpired(rule: IgnoreRule, now: Date): boolean {
  if (!rule.expires) return false;
  // The rule is valid through the whole expiry day (UTC).
  return now.getTime() > new Date(`${rule.expires}T23:59:59.999Z`).getTime();
}

function ruleMatches(rule: IgnoreRule, finding: Finding): boolean {
  if (finding.kind !== "vulnerability" || finding.package !== rule.package) return false;
  if (!rule.advisory) return true;
  const wanted = rule.advisory.toLowerCase();
  return (finding.advisoryIds ?? []).some((id) => id.toLowerCase() === wanted);
}

/**
 * Applies the "ignore" rules from the configuration to vulnerability findings.
 * Expired rules no longer apply and produce a warning, so a forgotten
 * exception cannot hide a problem forever.
 */
export function applyIgnores(
  findings: Finding[],
  rules: IgnoreRule[],
  now: Date,
  auditRan: boolean,
): IgnoreOutcome {
  const active: Finding[] = [];
  const ignored: IgnoredFinding[] = [];
  const warnings: string[] = [];
  const matched = new Set<IgnoreRule>();

  const liveRules: IgnoreRule[] = [];
  for (const rule of rules) {
    if (ruleIsExpired(rule, now)) {
      warnings.push(
        `Ignore rule for "${rule.package}"${rule.advisory ? ` (${rule.advisory})` : ""} expired on ${rule.expires}. The finding is active again.`,
      );
    } else {
      liveRules.push(rule);
    }
  }

  for (const finding of findings) {
    const rule = liveRules.find((candidate) => ruleMatches(candidate, finding));
    if (rule) {
      matched.add(rule);
      const entry: IgnoredFinding = { finding, reason: rule.reason };
      if (rule.expires) entry.expires = rule.expires;
      ignored.push(entry);
    } else {
      active.push(finding);
    }
  }

  if (auditRan) {
    for (const rule of liveRules) {
      if (!matched.has(rule)) {
        warnings.push(
          `Ignore rule for "${rule.package}"${rule.advisory ? ` (${rule.advisory})` : ""} matches nothing. You can remove it.`,
        );
      }
    }
  }

  return { active, ignored, warnings };
}

/** Turns findings into violations according to the configured thresholds. */
export function evaluatePolicy(verdicts: PackageVerdict[], config: ResolvedConfig): Violation[] {
  const violations: Violation[] = [];

  for (const verdict of verdicts) {
    for (const finding of verdict.findings) {
      if (finding.kind === "vulnerability" && config.failOn !== "none") {
        const severity = finding.severity ?? "moderate";
        if (SEVERITY_RANK[severity] >= SEVERITY_RANK[config.failOn]) {
          violations.push({
            rule: "vulnerability",
            package: verdict.name,
            message: `${severity} vulnerability: ${finding.message}`,
          });
        }
      } else if (finding.kind === "outdated" && config.outdated.failOn !== "never") {
        const type = finding.updateType ?? "unknown";
        const threshold = UPDATE_RANK[config.outdated.failOn];
        if (UPDATE_RANK[type] >= threshold && UPDATE_RANK[type] > 0) {
          violations.push({
            rule: "outdated",
            package: verdict.name,
            message: `${type} version behind: ${finding.message}`,
          });
        }
      } else if (finding.kind === "unused" && config.unused.fail) {
        violations.push({ rule: "unused", package: verdict.name, message: "Unused dependency." });
      }
    }
  }

  return violations;
}
