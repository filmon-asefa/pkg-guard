import { errorMessage, isRecord } from "../errors.js";
import type { Finding, ScannerOutcome, Severity } from "../types.js";
import type { ScannerContext } from "./context.js";

const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

function normalizeSeverity(value: unknown): Severity {
  switch (value) {
    case "critical":
    case "high":
    case "moderate":
    case "low":
      return value;
    case "info":
      return "low";
    default:
      return "moderate"; // unknown severity: do not under-report
  }
}

export interface ParsedAudit {
  findings: Finding[];
}

/**
 * Converts the JSON printed by `npm audit --json` (npm 7+, auditReportVersion 2)
 * into findings. Throws if the format is not recognised.
 */
export function parseAuditReport(report: unknown): ParsedAudit {
  if (!isRecord(report) || report["auditReportVersion"] !== 2 || !isRecord(report["vulnerabilities"])) {
    throw new Error("Unrecognised `npm audit --json` format (expected auditReportVersion 2, npm 7 or newer).");
  }

  const findings: Finding[] = [];

  for (const [name, entryRaw] of Object.entries(report["vulnerabilities"])) {
    if (!isRecord(entryRaw)) continue;
    const entrySeverity = normalizeSeverity(entryRaw["severity"]);

    let fix: string | undefined;
    let fixIsBreaking = false;
    const fixAvailable = entryRaw["fixAvailable"];
    if (isRecord(fixAvailable) && typeof fixAvailable["name"] === "string" && typeof fixAvailable["version"] === "string") {
      fix = `npm install ${fixAvailable["name"]}@${fixAvailable["version"]}`;
      fixIsBreaking = fixAvailable["isSemVerMajor"] === true;
    } else if (fixAvailable === true) {
      fix = "npm audit fix";
    }

    const via = Array.isArray(entryRaw["via"]) ? (entryRaw["via"] as unknown[]) : [];
    const advisories = via.filter(isRecord);
    const chain = via.filter((item): item is string => typeof item === "string");

    if (advisories.length > 0) {
      const seen = new Set<string>();
      for (const advisory of advisories) {
        const title = typeof advisory["title"] === "string" ? advisory["title"] : "Known vulnerability";
        const url = typeof advisory["url"] === "string" ? advisory["url"] : undefined;
        const source = advisory["source"];
        const ids: string[] = [];
        const ghsa = url ? GHSA_RE.exec(url)?.[0] : undefined;
        if (ghsa) ids.push(`GHSA-${ghsa.slice(5).toLowerCase()}`);
        if (typeof source === "number" || typeof source === "string") ids.push(String(source));

        const key = ids.join("|") || `${title}|${url ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const range = typeof advisory["range"] === "string" ? ` (affected versions: ${advisory["range"]})` : "";
        const finding: Finding = {
          kind: "vulnerability",
          package: name,
          severity: normalizeSeverity(advisory["severity"] ?? entrySeverity),
          message: `${title}${range}`,
          advisoryIds: ids,
        };
        if (url) finding.url = url;
        if (fix) {
          finding.fix = fix;
          finding.fixIsBreaking = fixIsBreaking;
        }
        findings.push(finding);
      }
    } else {
      const finding: Finding = {
        kind: "vulnerability",
        package: name,
        severity: entrySeverity,
        message:
          chain.length > 0
            ? `Vulnerable through its dependency: ${chain.join(", ")}`
            : "Vulnerable (no advisory details provided by npm)",
        advisoryIds: [],
      };
      if (fix) {
        finding.fix = fix;
        finding.fixIsBreaking = fixIsBreaking;
      }
      findings.push(finding);
    }
  }

  return { findings };
}

export async function runAudit(ctx: ScannerContext): Promise<ScannerOutcome> {
  const outcome: ScannerOutcome = { scanner: "audit", ok: false, findings: [], warnings: [] };
  const args = ["audit", "--json"];
  if (ctx.config.production) args.push("--omit=dev");

  const result = await ctx.run("npm", args, { cwd: ctx.cwd, timeoutMs: ctx.config.timeoutMs });

  if (result.spawnError) {
    outcome.error = result.timedOut
      ? `npm audit timed out after ${Math.round(ctx.config.timeoutMs / 1000)}s.`
      : `Could not run npm: ${result.spawnError}`;
    return outcome;
  }

  const text = result.stdout.trim();
  if (text.length === 0) {
    const detail = result.stderr.trim().split("\n")[0] ?? "";
    outcome.error = `npm audit produced no output${detail ? `: ${detail}` : "."}`;
    return outcome;
  }

  let report: unknown;
  try {
    report = JSON.parse(text) as unknown;
  } catch {
    outcome.error = "npm audit returned output that is not valid JSON.";
    return outcome;
  }

  if (isRecord(report) && isRecord(report["error"])) {
    const code = typeof report["error"]["code"] === "string" ? report["error"]["code"] : "";
    const rawSummary = typeof report["error"]["summary"] === "string" ? report["error"]["summary"] : "unknown error";
    const summary = rawSummary.replace(/\.+$/, "");
    let hint = "";
    if (code === "ENOLOCK") hint = " Run `npm install` to create a package-lock.json first.";
    else if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /network|ENOTFOUND|getaddrinfo|ECONNREFUSED|fetch failed/i.test(summary)) {
      hint = " Check your internet connection and npm registry settings.";
    }
    outcome.error = `npm audit failed (${code || "error"}): ${summary}.${hint}`;
    return outcome;
  }

  try {
    outcome.findings = parseAuditReport(report).findings;
    outcome.ok = true;
  } catch (error) {
    outcome.error = errorMessage(error);
  }
  return outcome;
}
