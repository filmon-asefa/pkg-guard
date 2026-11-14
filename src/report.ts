import type { PackageVerdict, ScanResult, Severity } from "./types.js";

export type ReportFormat = "text" | "json" | "markdown";

export interface TextOptions {
  color: boolean;
  /** Show safe packages and fit hints too. */
  verbose: boolean;
  /** Only print a short summary and the reasons for failing. */
  quiet: boolean;
}

interface Styler {
  red(text: string): string;
  yellow(text: string): string;
  green(text: string): string;
  cyan(text: string): string;
  bold(text: string): string;
  dim(text: string): string;
}

function makeStyler(enabled: boolean): Styler {
  const wrap = (open: number, close: number) => (text: string): string =>
    enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    cyan: wrap(36, 39),
    bold: wrap(1, 22),
    dim: wrap(2, 22),
  };
}

/** Whether colors should be used for a stream, honouring NO_COLOR / FORCE_COLOR. */
export function shouldUseColor(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv, noColorFlag: boolean): boolean {
  if (noColorFlag) return false;
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "0") return true;
  if (env["TERM"] === "dumb") return false;
  return stream.isTTY === true;
}

function severityColor(style: Styler, severity: Severity | undefined, text: string): string {
  switch (severity) {
    case "critical":
    case "high":
      return style.red(text);
    case "moderate":
      return style.yellow(text);
    default:
      return style.cyan(text);
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function describeVersions(verdict: PackageVerdict): string {
  const current = verdict.current ?? verdict.spec ?? "?";
  return verdict.latest && verdict.latest !== verdict.current ? `${current} -> ${verdict.latest}` : current;
}

function typeLabel(verdict: PackageVerdict): string {
  return verdict.type === "transitive" ? "indirect dependency" : verdict.type;
}

export function formatText(result: ScanResult, options: TextOptions): string {
  const style = makeStyler(options.color);
  const lines: string[] = [];
  const { summary } = result;

  lines.push(style.bold(`pkg-guard v${result.version}`) + style.dim(`  ${result.project.name}@${result.project.version}`));
  lines.push("");

  const parts = [
    `${summary.vulnerable} vulnerable`,
    `${summary.outdated} outdated`,
    `${summary.unused} unused`,
    `${summary.safe} safe`,
  ];
  lines.push(`Checked ${plural(summary.total, "package")}: ${parts.join(" | ")}`);

  if (!options.quiet) {
    const attention = result.verdicts.filter(
      (v) => v.status !== "safe" || (options.verbose && v.findings.length > 0),
    );

    for (const verdict of attention) {
      lines.push("");
      const tag =
        verdict.status === "vulnerable"
          ? style.red("[VULNERABLE]")
          : verdict.status === "outdated"
            ? style.yellow("[OUTDATED]  ")
            : verdict.status === "unused"
              ? style.yellow("[UNUSED]    ")
              : style.dim("[HINT]      ");
      lines.push(`${tag} ${style.bold(verdict.name)} ${describeVersions(verdict)} ${style.dim(`(${typeLabel(verdict)})`)}`);

      for (const finding of verdict.findings) {
        if (finding.kind === "fit" && !options.verbose) continue;
        if (finding.kind === "vulnerability") {
          lines.push(`    - ${severityColor(style, finding.severity, `${finding.severity ?? "moderate"}`)}: ${finding.message}`);
          if (finding.url) lines.push(style.dim(`      ${finding.url}`));
        } else if (finding.kind === "fit") {
          lines.push(`    - hint: ${finding.message}`);
        } else {
          lines.push(`    - ${finding.message}`);
        }
        if (finding.fix) {
          const warn = finding.fixIsBreaking ? style.yellow("  (major version: may contain breaking changes)") : "";
          lines.push(`      fix: ${style.green(finding.fix)}${warn}`);
        }
      }
    }

    if (options.verbose) {
      const safe = result.verdicts.filter((v) => v.status === "safe" && v.findings.length === 0);
      if (safe.length > 0) {
        lines.push("");
        lines.push(style.green(`[SAFE] ${safe.map((v) => `${v.name}@${v.current ?? v.spec ?? "?"}`).join(", ")}`));
      }
    } else if (summary.safe > 0) {
      lines.push("");
      lines.push(style.dim(`${plural(summary.safe, "safe package")} not shown. Use --verbose to list everything.`));
    }
  }

  if (result.ignored.length > 0) {
    lines.push("");
    lines.push(style.dim(`${plural(result.ignored.length, "finding")} ignored by your configuration:`));
    for (const item of result.ignored) {
      const until = item.expires ? `, until ${item.expires}` : "";
      lines.push(style.dim(`  - ${item.finding.package}: ${item.finding.message} (${item.reason}${until})`));
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    for (const warning of result.warnings) lines.push(`${style.yellow("[WARN]")} ${warning}`);
  }

  if (result.scannerErrors.length > 0 && result.exitCode === 2) {
    lines.push("");
    for (const error of result.scannerErrors) lines.push(`${style.red("[ERROR]")} ${error.scanner}: ${error.message}`);
  }

  lines.push("");
  if (result.violations.length > 0) {
    lines.push(style.red(style.bold(`FAILED: ${plural(result.violations.length, "policy violation")}`)));
    for (const violation of result.violations) lines.push(`  - ${style.bold(violation.package)}: ${violation.message}`);
  } else if (result.exitCode === 2) {
    lines.push(style.red(style.bold("FAILED: a check could not run (strict mode).")));
  } else {
    lines.push(style.green(style.bold("PASSED: no policy violations.")));
  }

  return `${lines.join("\n")}\n`;
}

export function formatJson(result: ScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function formatMarkdown(result: ScanResult): string {
  const { summary } = result;
  const out: string[] = [];
  out.push(`## pkg-guard report: ${result.project.name}@${result.project.version}`);
  out.push("");
  out.push(result.passed ? "**Result: passed**" : result.exitCode === 2 ? "**Result: failed (a check could not run)**" : "**Result: failed**");
  out.push("");
  out.push("| Vulnerable | Outdated | Unused | Safe |");
  out.push("|---:|---:|---:|---:|");
  out.push(`| ${summary.vulnerable} | ${summary.outdated} | ${summary.unused} | ${summary.safe} |`);

  const vulnerable = result.verdicts.filter((v) => v.status === "vulnerable");
  if (vulnerable.length > 0) {
    out.push("", "### Vulnerabilities", "", "| Package | Version | Severity | Issue | Fix |", "|---|---|---|---|---|");
    for (const verdict of vulnerable) {
      for (const f of verdict.findings.filter((x) => x.kind === "vulnerability")) {
        out.push(`| ${escapeCell(verdict.name)} | ${escapeCell(verdict.current ?? "?")} | ${f.severity ?? "moderate"} | ${escapeCell(f.message)} | ${escapeCell(f.fix ? `\`${f.fix}\`` : "none yet")} |`);
      }
    }
  }

  const outdated = result.verdicts.filter((v) => v.findings.some((f) => f.kind === "outdated"));
  if (outdated.length > 0) {
    out.push("", "### Outdated", "", "| Package | Installed | Latest | Update |", "|---|---|---|---|");
    for (const verdict of outdated) {
      const f = verdict.findings.find((x) => x.kind === "outdated");
      out.push(`| ${escapeCell(verdict.name)} | ${escapeCell(f?.current ?? "?")} | ${escapeCell(f?.latest ?? "?")} | ${f?.updateType ?? "unknown"} |`);
    }
  }

  const unused = result.verdicts.filter((v) => v.findings.some((f) => f.kind === "unused"));
  if (unused.length > 0) {
    out.push("", "### Possibly unused", "");
    for (const verdict of unused) out.push(`- \`${verdict.name}\` (\`npm uninstall ${verdict.name}\`)`);
  }

  if (result.violations.length > 0) {
    out.push("", "### Why it failed", "");
    for (const violation of result.violations) out.push(`- **${violation.package}**: ${violation.message}`);
  }

  if (result.warnings.length > 0) {
    out.push("", "### Warnings", "");
    for (const warning of result.warnings) out.push(`- ${warning}`);
  }
  return `${out.join("\n")}\n`;
}
