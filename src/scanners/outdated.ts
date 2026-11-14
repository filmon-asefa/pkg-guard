import { isRecord } from "../errors.js";
import { classifyUpdate } from "../semver.js";
import type { Finding, ScannerOutcome } from "../types.js";
import type { ScannerContext } from "./context.js";

export interface ParsedOutdated {
  findings: Finding[];
  warnings: string[];
}

/** Converts the JSON printed by `npm outdated --json` into findings. */
export function parseOutdatedReport(report: unknown): ParsedOutdated {
  if (!isRecord(report)) throw new Error("Unrecognised `npm outdated --json` format.");
  const findings: Finding[] = [];
  const warnings: string[] = [];

  for (const [name, raw] of Object.entries(report)) {
    // npm prints an array when a package is installed at several locations.
    const entry = Array.isArray(raw) ? raw.find(isRecord) : raw;
    if (!isRecord(entry)) continue;

    const current = typeof entry["current"] === "string" ? entry["current"] : undefined;
    const wanted = typeof entry["wanted"] === "string" ? entry["wanted"] : undefined;
    const latest = typeof entry["latest"] === "string" ? entry["latest"] : undefined;

    if (!current || current === "MISSING") {
      warnings.push(`${name} is listed in package.json but is not installed. Run \`npm install\`.`);
      continue;
    }
    if (!latest) continue;

    const updateType = classifyUpdate(current, latest);
    if (updateType === "none") continue;

    const finding: Finding = {
      kind: "outdated",
      package: name,
      message: "",
      updateType,
      current,
      latest,
    };
    if (wanted) finding.wanted = wanted;

    const label = updateType === "unknown" ? "update" : `${updateType} update`;
    let note = "";
    if (wanted && wanted !== current && wanted !== latest) {
      note = `; ${wanted} fits your version range`;
    }
    finding.message = `${current} -> ${latest} (${label}${note})`;

    if (wanted && wanted !== current && wanted === latest) {
      finding.fix = `npm update ${name}`;
    } else if (wanted && wanted !== current) {
      finding.fix = `npm update ${name}  (then \`npm install ${name}@${latest}\` for the newest)`;
    } else {
      finding.fix = `npm install ${name}@${latest}`;
    }
    finding.fixIsBreaking = updateType === "major";
    findings.push(finding);
  }

  return { findings, warnings };
}

export async function runOutdated(ctx: ScannerContext): Promise<ScannerOutcome> {
  const outcome: ScannerOutcome = { scanner: "outdated", ok: false, findings: [], warnings: [] };
  const result = await ctx.run("npm", ["outdated", "--json"], { cwd: ctx.cwd, timeoutMs: ctx.config.timeoutMs });

  if (result.spawnError) {
    outcome.error = result.timedOut
      ? `npm outdated timed out after ${Math.round(ctx.config.timeoutMs / 1000)}s.`
      : `Could not run npm: ${result.spawnError}`;
    return outcome;
  }

  const text = result.stdout.trim();
  const stderrText = result.stderr.trim();

  if (text.length === 0) {
    // npm prints nothing when everything is up to date. A non-zero exit with an
    // error message means the registry could not be reached (or similar).
    if (result.code !== 0 && /npm (ERR!|error)/i.test(stderrText)) {
      const line = stderrText.split("\n").find((l) => /npm (ERR!|error)/i.test(l)) ?? stderrText;
      outcome.error = `npm outdated failed: ${line.replace(/^npm (ERR!|error)\s*/i, "").trim()}`;
      return outcome;
    }
    outcome.ok = true;
    return outcome;
  }

  let report: unknown;
  try {
    report = JSON.parse(text) as unknown;
  } catch {
    outcome.error = "npm outdated returned output that is not valid JSON.";
    return outcome;
  }

  if (isRecord(report) && isRecord(report["error"])) {
    const summary = typeof report["error"]["summary"] === "string" ? report["error"]["summary"] : "unknown error";
    outcome.error = `npm outdated failed: ${summary}`;
    return outcome;
  }

  try {
    const parsed = parseOutdatedReport(report);
    const devOnly = new Set(Object.keys(ctx.manifest.devDependencies));
    const prodNames = new Set([
      ...Object.keys(ctx.manifest.dependencies),
      ...Object.keys(ctx.manifest.optionalDependencies),
    ]);
    const keep = (name: string): boolean => !(ctx.config.production && devOnly.has(name) && !prodNames.has(name));
    outcome.findings = parsed.findings.filter((f) => keep(f.package));
    outcome.warnings = parsed.warnings;
    outcome.ok = true;
  } catch (error) {
    outcome.error = (error as Error).message;
  }
  return outcome;
}
