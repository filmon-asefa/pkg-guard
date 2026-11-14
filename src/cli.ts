#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { ConfigError, UsageError, errorMessage } from "./errors.js";
import { initProject } from "./init.js";
import { formatJson, formatMarkdown, formatText, shouldUseColor } from "./report.js";
import type { ReportFormat } from "./report.js";
import { scan } from "./scan.js";
import { SCANNER_NAMES, SEVERITIES } from "./types.js";
import type { ScannerName, Severity } from "./types.js";
import type { ConfigOverrides } from "./config.js";
import { getToolVersion } from "./version.js";

const HELP = `pkg-guard - check your npm dependencies for vulnerabilities, outdated and unused packages

USAGE
  pkg-guard [scan] [options]     Scan the project in the current folder (default command)
  pkg-guard init [options]       Create pkg-guard.config.json and a "guard" npm script
  pkg-guard --help | --version

SCAN OPTIONS
  --fail-on <level>     Fail when a vulnerability of this severity or higher is found:
                        low | moderate | high (default) | critical | none
  --production          Ignore devDependencies
  --strict              Fail (exit 2) when a check cannot run, e.g. no internet
  --skip <checks>       Comma-separated checks to skip: audit, outdated, unused, fit
  --format <format>     text (default) | json | markdown
  --output <file>       Also write the report (in the chosen format) to a file
  --config <file>       Use a specific config file
  --cwd <folder>        Project folder (default: current folder)
  --warn-only           Print problems but always exit 0 (handy for postinstall)
  --quiet               Short output
  --verbose             Also list safe packages and hints
  --no-color            Disable colors

INIT OPTIONS
  --hooks               Also run pkg-guard before "build" and "start"
  --force               Overwrite an existing pkg-guard.config.json

EXIT CODES
  0  passed
  1  policy violation (for example a high severity vulnerability)
  2  error (bad options/config, or a check could not run in --strict mode)

Docs: see README.md in the package, or https://www.npmjs.com/package/pkg-guard
`;

function parseSkip(value: string | undefined): ScannerName[] {
  if (!value) return [];
  const names = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  for (const name of names) {
    if (!SCANNER_NAMES.includes(name as ScannerName)) {
      throw new UsageError(`Unknown check "${name}" in --skip. Choose from: ${SCANNER_NAMES.join(", ")}.`);
    }
  }
  return names as ScannerName[];
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        cwd: { type: "string" },
        config: { type: "string", short: "c" },
        format: { type: "string", short: "f" },
        output: { type: "string", short: "o" },
        "fail-on": { type: "string" },
        production: { type: "boolean" },
        strict: { type: "boolean" },
        skip: { type: "string" },
        quiet: { type: "boolean", short: "q" },
        verbose: { type: "boolean" },
        "warn-only": { type: "boolean" },
        "no-color": { type: "boolean" },
        hooks: { type: "boolean" },
        force: { type: "boolean" },
      },
    });
  } catch (error) {
    throw new UsageError(`${errorMessage(error)}\nRun \`pkg-guard --help\` for usage.`);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${getToolVersion()}\n`);
    return 0;
  }

  const command = positionals[0] ?? "scan";
  if (positionals.length > 1) throw new UsageError(`Unexpected argument "${positionals[1]}". Run \`pkg-guard --help\` for usage.`);
  const cwd = path.resolve(values.cwd ?? process.cwd());

  if (command === "init") {
    const result = initProject({ cwd, force: values.force === true, hooks: values.hooks === true });
    for (const message of result.messages) process.stdout.write(`${message}\n`);
    process.stdout.write("\nNext step: run `npx pkg-guard scan` (or `npm run guard`).\n");
    return 0;
  }

  if (command !== "scan") throw new UsageError(`Unknown command "${command}". Use "scan" or "init".`);

  const format = (values.format ?? "text") as ReportFormat;
  if (format !== "text" && format !== "json" && format !== "markdown") {
    throw new UsageError(`Unknown format "${values.format}". Choose: text, json, markdown.`);
  }

  const overrides: ConfigOverrides = { skip: parseSkip(values.skip) };
  const failOn = values["fail-on"];
  if (failOn !== undefined) {
    if (failOn !== "none" && !SEVERITIES.includes(failOn as Severity)) {
      throw new UsageError(`Unknown level "${failOn}" for --fail-on. Choose: none, ${SEVERITIES.join(", ")}.`);
    }
    overrides.failOn = failOn as Severity | "none";
  }
  if (values.production) overrides.production = true;
  if (values.strict) overrides.strict = true;

  const scanOptions: Parameters<typeof scan>[0] = { cwd, overrides };
  if (values.config) scanOptions.configPath = values.config;
  const result = await scan(scanOptions);

  let report: string;
  if (format === "json") report = formatJson(result);
  else if (format === "markdown") report = formatMarkdown(result);
  else {
    report = formatText(result, {
      color: shouldUseColor(process.stdout, process.env, values["no-color"] === true),
      verbose: values.verbose === true,
      quiet: values.quiet === true,
    });
  }
  process.stdout.write(report);

  if (values.output) {
    const target = path.resolve(cwd, values.output);
    // The file never contains color codes, whatever the terminal supports.
    const fileReport =
      format === "json" ? formatJson(result)
      : format === "markdown" ? formatMarkdown(result)
      : formatText(result, { color: false, verbose: values.verbose === true, quiet: values.quiet === true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fileReport);
  }

  if (values["warn-only"] && result.exitCode !== 0) {
    process.stderr.write("pkg-guard: --warn-only is set, so the exit code is 0 even though problems were found.\n");
    return 0;
  }
  return result.exitCode;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError || error instanceof ConfigError) {
      process.stderr.write(`pkg-guard: error: ${error.message}\n`);
    } else {
      process.stderr.write(`pkg-guard: unexpected error: ${errorMessage(error)}\n`);
      if (process.env["PKG_GUARD_DEBUG"] && error instanceof Error && error.stack) process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 2;
  },
);
