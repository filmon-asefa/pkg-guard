# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0]

First release.

### Added
- `pkg-guard scan`: one report combining vulnerabilities (`npm audit`), outdated packages (`npm outdated`), unused dependencies (static scan) and "fit" hints.
- Per-package verdicts: `vulnerable`, `outdated`, `unused`, `safe`, with suggested fix commands.
- Policy: `failOn` severity threshold, `outdated.failOn`, `unused.fail`, `production` and `strict` modes.
- Documented, expiring ignore rules for reviewed vulnerabilities.
- `pkg-guard init` (config file, `guard` script, optional `prebuild`/`prestart` hooks).
- Text, JSON and Markdown reports; `--output` to save a copy.
- Exit codes 0 (passed), 1 (policy violation), 2 (error).
- `--warn-only` for `postinstall` use.
- Programmatic API with TypeScript types.
- JSON schema for editor support (`schema.json`).
- Zero runtime dependencies; Node.js 18 or newer.

### Known limitations
- npm projects only for vulnerability and outdated checks (pnpm, Yarn and Bun are detected and reported clearly).
- The unused check is skipped for workspaces (monorepos).
