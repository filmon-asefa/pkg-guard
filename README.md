# pkg-guard

**One command that checks your npm dependencies for vulnerabilities, outdated versions and unused packages, and blocks the build when it matters.**

- Zero runtime dependencies. It uses the `npm` you already have.
- Works as a command line tool, as an npm script hook, in CI, and as a library.
- Written in TypeScript, with typed results.
- Never changes your project. It reports problems and suggests the fix command; you decide.

```text
$ npx pkg-guard scan          (example output)

pkg-guard v1.0.0  my-app@2.0.0

Checked 31 packages: 1 vulnerable | 2 outdated | 1 unused | 27 safe

[VULNERABLE] lodash 4.17.15 (dependencies)
    - high: Prototype Pollution in lodash (affected versions: <4.17.21)
      https://github.com/advisories/GHSA-p6mc-m468-83gw
      fix: npm install lodash@4.17.21

[OUTDATED]   express 4.17.1 -> 5.1.0 (dependencies)
    - 4.17.1 -> 5.1.0 (major update; 4.21.2 fits your version range)
      fix: npm update express  (then `npm install express@5.1.0` for the newest)

[UNUSED]     moment 2.29.4 (dependencies)
    - Not imported anywhere, and not used in scripts or config files (42 source files checked).
      fix: npm uninstall moment

FAILED: 1 policy violation
  - lodash: high vulnerability: Prototype Pollution in lodash (affected versions: <4.17.21)
```

## Contents

1. [Quick start](#quick-start)
2. [What it checks](#what-it-checks)
3. [Protect your app automatically](#protect-your-app-automatically)
4. [Reading the report](#reading-the-report)
5. [Command reference](#command-reference)
6. [Configuration](#configuration)
7. [Accepting a risk you have reviewed](#accepting-a-risk-you-have-reviewed)
8. [Use it in code](#use-it-in-code)
9. [Troubleshooting](#troubleshooting)
10. [Limitations](#limitations)
11. [Privacy and security](#privacy-and-security)

More guides: [Configuration reference](docs/configuration.md) · [CI/CD recipes](docs/ci-cd.md) · [How it works](docs/how-it-works.md) · [Publishing to npm](docs/publishing.md)

---

## Quick start

**Requirements:** Node.js 18 or newer, and an **npm** project with a `package-lock.json`.

```bash
# 1. Install it in your project
npm install --save-dev pkg-guard

# 2. Create the config file and a "guard" script
npx pkg-guard init --hooks

# 3. Run it
npm run guard
```

That's it. Step 2 does two things:

- creates `pkg-guard.config.json` with safe defaults, and
- adds `"guard": "pkg-guard scan"` to your `package.json` scripts. With `--hooks`, it also runs the scan before `npm run build` and `npm start`, so a risky package stops the build.

Don't want to install anything yet? Try it once with `npx pkg-guard scan` in your project folder.

---

## What it checks

| Check | What it finds | Based on | Can block the build? |
|---|---|---|---|
| **Vulnerabilities** (`audit`) | Packages with known security advisories, including packages deep inside your dependency tree | `npm audit` | Yes, by default for `high` and `critical` |
| **Outdated** (`outdated`) | Packages with a newer version, labelled patch, minor or major | `npm outdated` | Only if you choose (`outdated.failOn`) |
| **Unused** (`unused`) | Dependencies that your code, scripts and config never reference | Scans your source files | Only if you choose (`unused.fail`) |
| **Fit hints** (`fit`) | Packages that Node.js now covers itself, like `axios` (use `fetch`) or `uuid` (use `crypto.randomUUID()`), and deprecated packages like `request` | A small built-in list | Never. Hints only |

Every package ends up with **one status**:

| Status | Meaning |
|---|---|
| `vulnerable` | Has at least one known vulnerability (highest priority) |
| `outdated` | A newer version exists |
| `unused` | Nothing in your project seems to use it |
| `safe` | Nothing found |

A package with several problems shows the most serious status and lists all its findings.

---

## Protect your app automatically

A package cannot watch your app by itself. It has to be started at the right moments. `pkg-guard` gives you four ways, and you can combine them:

### 1. Before every build and start (recommended)

```bash
npx pkg-guard init --hooks
```

This adds the following to `package.json`. npm runs `pre*` scripts automatically, so a failed scan stops the command that follows:

```json
"scripts": {
  "guard": "pkg-guard scan",
  "prebuild": "pkg-guard scan --quiet",
  "prestart": "pkg-guard scan --quiet"
}
```

### 2. After every `npm install` (warns, never blocks)

```json
"scripts": {
  "postinstall": "pkg-guard scan --quiet --warn-only"
}
```

`--warn-only` prints problems but always exits `0`, so an install is never broken by a scan. It is skipped when someone installs with `--ignore-scripts`.

### 3. In CI, on every pull request

```bash
npx pkg-guard scan --strict
```

`--strict` also fails when a check could not run (for example, no internet), so CI can never pass by accident. Ready-made workflows are in [docs/ci-cd.md](docs/ci-cd.md).

### 4. On a schedule

New vulnerabilities are published every day, so a package that was safe yesterday can be flagged today. Run the CI job on a daily schedule as well (the example in [docs/ci-cd.md](docs/ci-cd.md) does this).

---

## Reading the report

- **`[VULNERABLE]`** lists each advisory with its severity, a link, and the command that fixes it. A fix marked *major version* may contain breaking changes, so test after applying it.
- **`[OUTDATED]`** shows `installed -> latest`. If a newer version fits your version range in `package.json`, `npm update <name>` is enough.
- **`[UNUSED]`** means no import, script or config references the package. Check it before uninstalling (see [Limitations](#limitations)).
- **`indirect dependency`** marks a vulnerable package you did not install yourself; it comes with one of your dependencies. Updating the parent package usually fixes it.
- **`[WARN]`** lines are things that did not stop the scan but you should know, such as an expired ignore rule or a check that could not run.
- The last line is `PASSED` or `FAILED`, and the process exit code matches (see below).

---

## Command reference

```text
pkg-guard [scan] [options]     Scan the project (this is the default command)
pkg-guard init [options]       Create pkg-guard.config.json and a "guard" script
pkg-guard --help | --version
```

### Scan options

| Option | Description |
|---|---|
| `--fail-on <level>` | Block on vulnerabilities of this severity or higher: `low`, `moderate`, `high` (default), `critical`, or `none` |
| `--production` | Ignore `devDependencies` |
| `--strict` | Exit with code `2` if any check could not run |
| `--skip <checks>` | Skip checks, comma separated: `audit`, `outdated`, `unused`, `fit` |
| `--format <format>` | `text` (default), `json` or `markdown` |
| `--output <file>` | Also save the report (in the chosen format) to a file |
| `--config <file>` | Use a specific config file |
| `--cwd <folder>` | Project folder (default: current folder) |
| `--warn-only` | Print problems but always exit `0` |
| `--quiet`, `-q` | Short output: summary and reasons for failing only |
| `--verbose` | Also list safe packages and fit hints |
| `--no-color` | Disable colors (also honours `NO_COLOR`; `FORCE_COLOR` forces them on) |

### Init options

| Option | Description |
|---|---|
| `--hooks` | Also run `pkg-guard scan --quiet` before `build` and `start` (only if those scripts exist; existing `prebuild`/`prestart` commands are kept and run after the scan) |
| `--force` | Overwrite an existing `pkg-guard.config.json` |

### Exit codes

| Code | Meaning | What to do |
|---|---|---|
| `0` | Passed | Nothing |
| `1` | Policy violation, for example a high severity vulnerability | Fix it, or review and [ignore it with a reason](#accepting-a-risk-you-have-reviewed) |
| `2` | Error: bad option, invalid config, no `package.json`, or (with `--strict`) a check could not run | Read the message; it says what to fix |

If there is a violation and a failed check at the same time, the exit code is `1`.

---

## Configuration

Settings live in `pkg-guard.config.json` in your project root (or under a `"pkg-guard"` key in `package.json`). Everything is optional. Command line flags override the file.

```json
{
  "$schema": "./node_modules/pkg-guard/schema.json",
  "failOn": "high",
  "production": false,
  "strict": false,
  "checks": { "audit": true, "outdated": true, "unused": true, "fit": true },
  "outdated": { "failOn": "never", "ignore": [] },
  "unused": { "fail": false, "ignore": [], "sourceDirs": [] },
  "ignore": []
}
```

The `$schema` line gives you autocomplete and error checking in VS Code and most editors. Unknown option names are rejected with a clear error, so a typo can never silently turn protection off.

Common setups:

```jsonc
// Strict production app: fail on anything moderate or worse, and on unused packages
{ "failOn": "moderate", "production": true, "strict": true, "unused": { "fail": true } }

// Block builds that are a whole major version behind
{ "outdated": { "failOn": "major" } }

// Source code lives in "app" and "lib" only; ignore two known tool packages
{ "unused": { "sourceDirs": ["app", "lib"], "ignore": ["my-cli-tool", "@company/*"] } }
```

Every option is explained in the [configuration reference](docs/configuration.md).

---

## Accepting a risk you have reviewed

Sometimes a vulnerability does not affect you (for example, the vulnerable function is never called) and there is no fix yet. Record that decision instead of switching the check off:

```json
{
  "ignore": [
    {
      "package": "lodash",
      "advisory": "GHSA-p6mc-m468-83gw",
      "reason": "We only use lodash.get in a build script; no user input reaches it.",
      "expires": "2026-12-31"
    }
  ]
}
```

- **`reason` is required**, so the decision is documented for your team.
- **`advisory`** limits the rule to one advisory. Without it, *every* advisory for that package is ignored, including ones published later. Prefer using it.
- **`expires`** (`YYYY-MM-DD`) makes the rule stop working on that date, and `pkg-guard` warns you. Forgotten exceptions cannot hide a problem forever.
- Rules that no longer match anything produce a warning, so you can clean them up.
- Ignored findings are still listed in the report, under "ignored by your configuration".

---

## Use it in code

```js
const { scan, formatText } = require("pkg-guard"); // or: import { scan, formatText } from "pkg-guard";

const result = await scan({ cwd: process.cwd() });

console.log(formatText(result, { color: true, verbose: false, quiet: false }));

for (const pkg of result.verdicts) {
  if (pkg.status === "vulnerable") console.log(pkg.name, pkg.findings.map((f) => f.severity));
}

process.exitCode = result.exitCode; // 0, 1 or 2
```

`scan(options)` accepts:

| Option | Description |
|---|---|
| `cwd` | Project folder (default: `process.cwd()`) |
| `configPath` | Path to a config file |
| `config` | A config object (same shape as the JSON file). If given, no file is read |
| `overrides` | `{ failOn, production, strict, skip }`, the same as the command line flags |

The result is plain JSON (`schemaVersion: 1`) with `verdicts`, `violations`, `ignored`, `warnings`, `scannerErrors`, `summary`, `passed` and `exitCode`. Full TypeScript types are included. The same data is printed by `--format json`.

Other exports: `formatJson`, `formatMarkdown`, `loadConfig`, `resolveConfig`, `DEFAULT_CONFIG`, `ConfigError`, `UsageError`.

---

## Troubleshooting

| You see | Why | Fix |
|---|---|---|
| `npm audit failed (ENOLOCK) ... requires an existing lockfile` | There is no `package-lock.json` | Run `npm install` once and commit the lockfile |
| `npm audit failed ... ENOTFOUND` / `network` | No internet, a proxy, or an unreachable registry | Check your connection and `npm config get registry`. In CI use `--strict` so this fails loudly |
| `X is listed in package.json but is not installed` | `node_modules` is missing or out of date | Run `npm install` (or `npm ci`) |
| `N dependencies were not checked for unused status because they are not installed` | Same as above; without the installed package, its command names cannot be read | Run `npm install` first |
| `This project uses pnpm/yarn ...` | Vulnerability and outdated checks need npm | See [Limitations](#limitations). `unused` and `fit` still work with `--skip audit,outdated` |
| `Unused-package check skipped: ... workspaces` | The project is a monorepo | Run `pkg-guard` inside each workspace folder |
| A package is reported unused but you do use it | It is loaded in a way that cannot be seen (see below) | Add it to `unused.ignore` |
| `pkg-guard: error: unknown option "..."` in config | Typo in the config file | The message lists the allowed names |
| Scan takes long | Slow registry | Raise `timeoutMs`, or run `--skip outdated` locally and the full scan in CI |

Set `PKG_GUARD_DEBUG=1` to print a stack trace for unexpected errors.

---

## Limitations

Being honest about what the tool cannot do helps you trust it where it can:

- **npm projects only** (needs `package-lock.json`). pnpm, Yarn and Bun are detected and reported clearly, but their vulnerability and outdated checks are not supported yet.
- **Vulnerability data comes from npm's audit service.** `pkg-guard` is exactly as good as that database. It does not scan your own source code for bugs, and it does not detect malicious packages that have no advisory yet.
- **The unused check is a best-effort static scan.** It reads `import`, `require`, `import()` and `export ... from` in `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte` and `.astro` files, plus `package.json` scripts and root-level config files. It cannot see packages loaded by a variable name (`require(name)`), by tools that look them up by naming convention (ESLint/Babel/PostCSS/Prettier plugins and presets, and `@types/*` packages are therefore never reported), or from files outside your project. Treat `[UNUSED]` as "please check", not "delete".
- **Monorepos:** the unused check is skipped for projects with `workspaces`.
- **Fit hints are suggestions.** They only look at package names and never at how you use the package.
- **Windows, macOS and Linux** are supported; the npm commands are run through your own `npm`.

---

## Privacy and security

- `pkg-guard` itself makes **no network requests and sends no telemetry**. It has **no runtime dependencies**, so there is nothing hidden to audit besides its own source.
- The vulnerability and outdated checks run your installed `npm` (`npm audit`, `npm outdated`). Like running those commands yourself, this sends package names and versions to your configured npm registry (by default `registry.npmjs.org`), and nothing else.
- It only **reads** files in your project and never modifies `package.json` or `node_modules`. The one exception is `pkg-guard init`, which writes `pkg-guard.config.json` and adds scripts, and only when you run it.
- It never runs the fix commands it suggests.

## Developing

```bash
git clone <your repository>
cd pkg-guard
npm install
npm run build      # compiles src/ to dist/
npm test           # type-checks and runs all tests (Node's built-in test runner)
node dist/cli.js scan
```

Source layout: `src/scanners/` (one file per check), `src/merge.ts` (verdicts), `src/policy.ts` (rules), `src/report.ts` (output), `src/cli.ts` (command line), `src/index.ts` (public API). Tests live in `test/` and use fake `npm` output, so they run offline. See [docs/how-it-works.md](docs/how-it-works.md) for the design, and [docs/publishing.md](docs/publishing.md) to release it.

## License

MIT
