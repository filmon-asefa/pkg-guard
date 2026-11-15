# Configuration reference

`pkg-guard` works with no configuration. Add a file only when you want to change a default.

## Where settings come from

The first match wins:

1. The file given with `--config <file>`
2. `pkg-guard.config.json` in the project folder
3. The `"pkg-guard"` key inside `package.json`
4. Built-in defaults

Command line flags (`--fail-on`, `--production`, `--strict`, `--skip`) are applied on top of whatever was found.

Create a starter file with `npx pkg-guard init`. Add this line to get editor autocomplete and validation:

```json
{ "$schema": "./node_modules/@filmona/pkg-guard/schema.json" }
```

Unknown option names and wrong value types are **errors** (exit code 2), not silently ignored.

## All options

### `failOn`
`"none" | "low" | "moderate" | "high" | "critical"` &nbsp; default `"high"`

Block (exit code 1) when a vulnerability at this severity **or higher** is found. `"high"` blocks `high` and `critical`. `"none"` reports vulnerabilities but never blocks.

### `production`
`boolean` &nbsp; default `false`

Only consider what ships with your app. Dev dependencies (test tools, linters, build tools) are left out of the audit, outdated and unused results. Use this for "is the app I deploy safe?" checks.

### `strict`
`boolean` &nbsp; default `false`

If a check cannot run (no internet, registry down, no lockfile), the default is to print a warning and continue, so a flaky network never breaks a developer's build. With `strict: true` the scan exits with code `2` instead. **Use strict in CI.**

### `timeoutMs`
`integer ≥ 1000` &nbsp; default `120000`

Maximum time, in milliseconds, for each `npm` command.

### `checks`
`{ audit, outdated, unused, fit }`, all `boolean`, all default `true`

Turn individual checks off:

```json
{ "checks": { "outdated": false } }
```

### `outdated`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `failOn` | `"never" \| "patch" \| "minor" \| "major"` | `"never"` | Block when a package is behind by at least this much. `"major"` blocks only when a whole major version behind; `"patch"` blocks on any update |
| `ignore` | `string[]` | `[]` | Package names never reported as outdated. `*` is a wildcard, for example `"@types/*"` |

### `unused`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `fail` | `boolean` | `false` | Block when an unused dependency is found |
| `ignore` | `string[]` | `[]` | Package names never reported as unused. `*` is a wildcard |
| `sourceDirs` | `string[]` | `[]` | Folders (relative to the project) that contain your code. Empty means the whole project, skipping `node_modules`, `dist`, `build`, `out`, `coverage`, hidden folders and similar |

### `ignore`
Array of rules, default `[]`. Each rule:

| Key | Required | Meaning |
|---|---|---|
| `package` | yes | Package name |
| `reason` | yes | Why this is safe to ignore |
| `advisory` | no | Only ignore this advisory (`GHSA-xxxx-xxxx-xxxx`, case-insensitive). Without it, all advisories of the package are ignored |
| `expires` | no | `YYYY-MM-DD`. The rule is valid through the end of that day (UTC), then stops applying and a warning is shown |

`ignore` rules apply to **vulnerabilities**. To silence outdated or unused results, use `outdated.ignore` and `unused.ignore`.

## Recipes

**Strict CI gate for a deployed service**
```json
{ "failOn": "moderate", "production": true, "strict": true }
```

**Warn about everything, block only on critical**
```json
{ "failOn": "critical" }
```

**Keep dependencies fresh: block if a major version behind**
```json
{ "outdated": { "failOn": "major", "ignore": ["typescript"] } }
```

**Keep the dependency list clean**
```json
{ "unused": { "fail": true, "ignore": ["my-cli-tool"] } }
```

**Only run the offline checks (no internet needed)**
```bash
npx pkg-guard scan --skip audit,outdated
```

**Accept one reviewed vulnerability for a limited time**
```json
{
  "ignore": [
    {
      "package": "some-package",
      "advisory": "GHSA-xxxx-xxxx-xxxx",
      "reason": "Only used on our own constant input; no user data reaches it.",
      "expires": "2026-12-31"
    }
  ]
}
```

## Which checks need what?

| Check | Needs internet | Needs `package-lock.json` | Needs `node_modules` |
|---|---|---|---|
| `audit` | yes | yes | no |
| `outdated` | yes | no | yes (it compares against installed versions) |
| `unused` | no | no | recommended (to read command names of tools) |
| `fit` | no | no | no |
