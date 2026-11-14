# How it works

```
 package.json ─┐
 lockfile      │      ┌─ audit    (npm audit --json)      ─┐
 node_modules  ├─ scan┼─ outdated (npm outdated --json)   ─┼─ findings ─ ignore rules ─ merge ─ policy ─ report + exit code
 source files  │      ├─ unused   (static scan of imports) ─┤
 config file  ─┘      └─ fit      (built-in hint list)     ─┘
```

All checks run in parallel and each one returns a list of **findings**. A failing check never crashes the scan; it is recorded as a warning (or, with `strict`, as exit code 2).

## 1. Checks

### `audit`: vulnerabilities
Runs `npm audit --json` (npm 7 or newer, report version 2) and reads the result. Notes:

- `npm audit` exits with code 1 when it finds vulnerabilities. That is normal, so `pkg-guard` reads the output instead of treating the exit code as a crash.
- Each advisory becomes one finding with its severity, link and advisory ids (`GHSA-...` and npm's numeric id). A package that is only vulnerable *through* another package gets a finding saying so.
- The suggested fix comes from npm. A fix that needs a new major version is marked as possibly breaking.
- If the output is not in the expected format, the check fails with a clear message instead of guessing.

### `outdated`: newer versions
Runs `npm outdated --json` and compares `current` with `latest`:

| Update | Example |
|---|---|
| `patch` | 1.2.3 → 1.2.4 |
| `minor` | 1.2.3 → 1.3.0 |
| `major` | 1.2.3 → 2.0.0 |

If a newer version also fits your range in `package.json` (`wanted`), the fix is `npm update <name>`; otherwise `npm install <name>@<latest>`. Packages declared but not installed are reported as a warning, not as outdated.

### `unused`: dependencies nobody uses
A dependency counts as **used** if any of these is true:

1. A source file imports or requires it (`import`, `export ... from`, `require`, `require.resolve`, dynamic `import()`, `/// <reference types>`). Sub-paths like `lodash/get` and scoped names like `@scope/pkg/x` are mapped to the package name.
2. Its name appears in a `package.json` script, or one of the commands it installs does (for example `typescript` installs `tsc`, so `"build": "tsc"` counts).
3. Its name appears in root-level config files (`.eslintrc*`, `jest.config.*`, `tsconfig*.json`, any dotfile, `*.config.*`, `*rc`) or in non-dependency fields of `package.json` (such as a `"jest"` section).

These are never reported: `@types/*`, and ESLint / Stylelint / Prettier / Babel / PostCSS plugins and presets, because tools load them by name from config.

Packages that are **not installed** are skipped (with a warning), because their command names cannot be read. Run `npm install` first. Projects with `workspaces` are skipped.

When unsure, the check chooses "used" over "unused". It is meant to avoid deleting something that matters, even if that means missing an unused package.

### `fit`: hints
A small, fixed list of packages whose job Node.js now does itself, shown only when your `engines.node` (or Node 18 if unset) is new enough:

| Package | Built-in alternative | Node.js |
|---|---|---|
| `axios`, `node-fetch`, `cross-fetch`, `isomorphic-fetch` | `fetch()` | 18+ |
| `uuid` | `crypto.randomUUID()` | 16+ |
| `rimraf` | `fs.rm(path, { recursive: true, force: true })` | 14+ |
| `mkdirp` | `fs.mkdir(path, { recursive: true })` | 12+ |
| `clone-deep`, `lodash.clonedeep` | `structuredClone()` | 17+ |
| `left-pad` | `String.prototype.padStart()` | 8+ |
| `object-assign` | `Object.assign()` | 4+ |
| `request`, `request-promise`, `request-promise-native` | deprecated, use a maintained client | any |

Hints appear with `--verbose`. They never change a package's status and never block.

## 2. Ignore rules
Vulnerability findings are matched against `ignore` rules. Matching findings are moved to the "ignored" list (still visible in the report). Expired rules do not apply and produce a warning; rules that match nothing produce a clean-up warning.

## 3. Merge
Findings are grouped per package into one **verdict**. Every direct dependency gets a verdict (even `safe` ones); an indirect dependency only appears if it has a vulnerability. Status precedence: `vulnerable` > `outdated` > `unused` > `safe`. Verdicts are sorted most serious first.

## 4. Policy
The configured thresholds turn findings into **violations**:

| Rule | Violation when |
|---|---|
| vulnerability | severity ≥ `failOn` |
| outdated | update size ≥ `outdated.failOn` (and not `never`) |
| unused | `unused.fail` is `true` |

## 5. Exit code
- any violation → `1`
- otherwise, `strict` and a check could not run → `2`
- otherwise → `0`

`--warn-only` converts `1` to `0` for that run (the problems are still printed).

## Design decisions

- **Reuse npm instead of reimplementing it.** `npm audit` and `npm outdated` are maintained by the npm team and always match your registry settings (proxies, private registries, `.npmrc`).
- **No runtime dependencies.** Fewer things to break, nothing extra to audit, instant install.
- **Never modify the project.** Automatic upgrades can break an app; this tool only suggests commands.
- **Fail safe, report loudly.** Unknown formats, missing locks and network errors are reported with a reason, and `--strict` makes them fail the build.
