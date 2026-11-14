import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding, ScannerOutcome } from "../types.js";
import type { ScannerContext } from "./context.js";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules", "dist", "build", "out", "coverage", ".next", ".nuxt", ".output", ".turbo",
  ".cache", ".svelte-kit", "tmp", "temp",
]);

const MAX_FILES = 25_000;
const MAX_FILE_BYTES = 1_500_000;

/** Packages that are loaded by name from tool configuration, so imports can never prove use. */
const CONVENTION_PATTERN =
  /^(@types\/|@babel\/(plugin|preset)-|babel-(plugin|preset)-|(@[^/]+\/)?eslint-(plugin|config)(-|$)|(@[^/]+\/)?stylelint-(config|plugin)(-|$)|(@[^/]+\/)?prettier-plugin-|postcss-)/;

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Maps an import specifier ("lodash/get", "@scope/pkg/x") to its package name. */
export function toPackageName(specifier: string): string | undefined {
  if (specifier.length === 0) return undefined;
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return undefined;
  if (specifier.startsWith("node:") || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) return undefined;
  if (specifier.includes("!")) return undefined;
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    const scope = parts[0];
    const name = parts[1];
    if (!scope || scope.length < 2 || !name) return undefined;
    return `${scope}/${name}`;
  }
  return parts[0];
}

const IMPORT_PATTERNS: RegExp[] = [
  /\bimport\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"'\n]+)["']/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+["']([^"'\n]+)["']/g,
  /\brequire(?:\.resolve)?\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /\/\/\/\s*<reference\s+types=["']([^"']+)["']/g,
];

/** Returns the set of package names referenced by import/require statements in `source`. */
export function extractImportedPackages(source: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1] ? toPackageName(match[1]) : undefined;
      if (name) found.add(name);
    }
  }
  return found;
}

interface WalkResult {
  files: string[];
  truncated: boolean;
}

function walk(root: string): WalkResult {
  const files: string[] = [];
  let truncated = false;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        stack.push(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          return { files, truncated };
        }
        files.push(full);
      }
    }
  }
  return { files, truncated };
}

/** Root-level configuration files (".eslintrc.json", "jest.config.js", "tsconfig.json", ...). */
function readConfigFilesText(cwd: string): string {
  let text = "";
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return text;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const isConfig =
      (name.startsWith(".") && name !== ".gitignore" && name !== ".npmignore") ||
      /\.(config|rc)\.[cm]?[jt]s$/.test(name) ||
      /\.config\.json$/.test(name) ||
      /^(tsconfig|jsconfig)[\w.-]*\.json$/.test(name) ||
      /rc$/.test(name);
    if (!isConfig) continue;
    try {
      const full = path.join(cwd, name);
      if (fs.statSync(full).size <= MAX_FILE_BYTES) text += `\n${fs.readFileSync(full, "utf8")}`;
    } catch {
      /* ignore unreadable file */
    }
  }
  return text;
}

function tokens(text: string): Set<string> {
  return new Set(text.split(/[^\w@/.-]+/).filter((t) => t.length > 0));
}

function binNames(cwd: string, name: string): string[] {
  try {
    const file = path.join(cwd, "node_modules", ...name.split("/"), "package.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { bin?: unknown };
    if (typeof json.bin === "string") return [name.split("/").pop() as string];
    if (json.bin && typeof json.bin === "object") return Object.keys(json.bin as object);
  } catch {
    /* not installed */
  }
  return [];
}

function mentions(tokenSet: Set<string>, name: string): boolean {
  if (tokenSet.has(name)) return true;
  for (const token of tokenSet) if (token.startsWith(`${name}/`)) return true;
  return false;
}

export interface UnusedResult {
  findings: Finding[];
  filesScanned: number;
  warnings: string[];
}

function isInstalled(cwd: string, name: string): boolean {
  return fs.existsSync(path.join(cwd, "node_modules", ...name.split("/")));
}

export function findUnusedDependencies(ctx: ScannerContext): UnusedResult {
  const { cwd, manifest, config } = ctx;
  const warnings: string[] = [];

  const roots = config.unused.sourceDirs.length > 0
    ? config.unused.sourceDirs.map((dir) => path.resolve(cwd, dir))
    : [cwd];

  const files: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      warnings.push(`unused.sourceDirs: folder not found: ${root}`);
      continue;
    }
    const walked = walk(root);
    files.push(...walked.files);
    if (walked.truncated) warnings.push(`Only the first ${MAX_FILES} source files were scanned for unused packages.`);
  }

  const used = new Set<string>();
  let scanned = 0;
  for (const file of files) {
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      for (const name of extractImportedPackages(fs.readFileSync(file, "utf8"))) used.add(name);
      scanned++;
    } catch {
      /* ignore unreadable file */
    }
  }

  const scriptTokens = tokens(Object.values(manifest.scripts).join("\n"));
  const configTokens = tokens(`${manifest.otherFieldsText}\n${readConfigFilesText(cwd)}`);
  const ignoreMatchers = config.unused.ignore.map(globToRegExp);

  const declared: string[] = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
    ...Object.keys(manifest.optionalDependencies),
  ];

  const findings: Finding[] = [];
  let notInstalled = 0;
  for (const name of new Set(declared)) {
    if (CONVENTION_PATTERN.test(name)) continue;
    if (ignoreMatchers.some((re) => re.test(name))) continue;
    if (used.has(name)) continue;
    if (mentions(scriptTokens, name) || mentions(configTokens, name)) continue;
    if (!isInstalled(cwd, name)) {
      // Without the installed package we cannot know which commands it provides
      // (for example "typescript" provides "tsc"), so we cannot judge it safely.
      notInstalled++;
      continue;
    }
    if (binNames(cwd, name).some((bin) => scriptTokens.has(bin))) continue;

    findings.push({
      kind: "unused",
      package: name,
      message: `Not imported anywhere, and not used in scripts or config files (${scanned} source files checked).`,
      fix: `npm uninstall ${name}`,
    });
  }

  if (notInstalled > 0) {
    warnings.push(
      `${notInstalled} ${notInstalled === 1 ? "dependency was" : "dependencies were"} not checked for unused status because ${notInstalled === 1 ? "it is" : "they are"} not installed. Run \`npm install\` first.`,
    );
  }

  return { findings, filesScanned: scanned, warnings };
}

export function runUnused(ctx: ScannerContext): ScannerOutcome {
  const outcome: ScannerOutcome = { scanner: "unused", ok: false, findings: [], warnings: [] };

  if (ctx.manifest.hasWorkspaces) {
    outcome.warnings.push("Unused-package check skipped: this project uses workspaces (monorepo). Run pkg-guard inside each workspace instead.");
    outcome.ok = true;
    return outcome;
  }

  const result = findUnusedDependencies(ctx);
  outcome.warnings.push(...result.warnings);
  if (result.filesScanned === 0 && Object.keys({ ...ctx.manifest.dependencies, ...ctx.manifest.devDependencies }).length > 0) {
    outcome.warnings.push("Unused-package check skipped: no JavaScript/TypeScript source files were found. Set \"unused.sourceDirs\" if your code lives elsewhere.");
    outcome.ok = true;
    return outcome;
  }
  outcome.findings = result.findings;
  outcome.ok = true;
  return outcome;
}
