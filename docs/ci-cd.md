# CI/CD recipes

In CI, always use `--strict`. Without it, a network problem would only print a warning and the build would pass without having checked anything.

## GitHub Actions

Create `.github/workflows/pkg-guard.yml`:

```yaml
name: Dependency check

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 6 * * *"   # every day: new vulnerabilities appear after you ship

jobs:
  pkg-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Scan dependencies
        run: npx pkg-guard scan --strict --format markdown --output pkg-guard-report.md

      - name: Show report in the job summary
        if: always()
        run: cat pkg-guard-report.md >> "$GITHUB_STEP_SUMMARY"

      - name: Keep the report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: pkg-guard-report
          path: pkg-guard-report.md
```

The scan step fails the job on a violation (exit 1) or when a check cannot run (exit 2). The `if: always()` steps still run, so you can read the report.

## GitLab CI

```yaml
pkg-guard:
  image: node:20
  stage: test
  script:
    - npm ci
    - npx pkg-guard scan --strict --format json --output pkg-guard-report.json
  artifacts:
    when: always
    paths:
      - pkg-guard-report.json
```

Add a scheduled pipeline (CI/CD > Schedules) to run it daily.

## Docker builds

Fail the image build when the production dependencies are vulnerable:

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN npx pkg-guard scan --production --strict
COPY . .
RUN npm run build
```

## Pre-commit / pre-push

With [husky](https://typicode.github.io/husky/), put this line in `.husky/pre-push`:

```bash
npx pkg-guard scan --quiet --skip outdated
```

`--skip outdated` keeps the hook fast, because the vulnerability check is the one that matters before pushing.

## Using the JSON output

`--format json` prints the full result, which is easy to process:

```bash
# count high and critical vulnerabilities
npx pkg-guard scan --format json | node -e "
  const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const s = r.summary.vulnerabilitiesBySeverity;
  console.log('high+critical:', s.high + s.critical);
"
```

The JSON has a `schemaVersion` field. It only changes when fields are removed or renamed, so scripts keep working across minor releases.

## Exit codes in pipelines

| Code | Meaning |
|---|---|
| `0` | Passed |
| `1` | Policy violation: fix the dependency or [ignore it with a reason](../README.md#accepting-a-risk-you-have-reviewed) |
| `2` | Error: bad config, or a check could not run (`--strict`) |

To keep a job from failing while you introduce the tool, use `--warn-only` first, then remove it once the report is clean.
