# Publishing to npm

A step-by-step checklist for releasing `pkg-guard` (or your renamed copy of it).

## 0. Choose the package name

The name `pkg-guard` may already be taken on npm. Check first:

```bash
npm view pkg-guard
```

- If it prints package details, the name is taken. If it says `404 Not Found`, it is free.
- If taken, use a **scoped** name, which is always available under your own account or organization: change `"name"` in `package.json` to `"@your-username/pkg-guard"` and publish with `--access public` (step 5).
- Also update the name in `README.md`, `schema.json` (`$id`), `.npmignore` is unaffected, and the `$schema` path written by `pkg-guard init` (`src/config.ts`, search for `node_modules/pkg-guard`). A quick way to find every place: `grep -rn "pkg-guard" --include=*.ts --include=*.json --include=*.md . --exclude-dir=node_modules`.

## 1. One-time setup

1. Create an account at <https://www.npmjs.com/signup>.
2. **Turn on two-factor authentication** in your account settings. npm requires it for publishing.
3. Log in from the terminal:
   ```bash
   npm login
   ```
4. In `package.json`, fill in the fields that make the package look trustworthy on npmjs.com:
   ```json
   "author": "Your Name <you@example.com>",
   "repository": { "type": "git", "url": "git+https://github.com/you/pkg-guard.git" },
   "homepage": "https://github.com/you/pkg-guard#readme",
   "bugs": { "url": "https://github.com/you/pkg-guard/issues" }
   ```
5. Replace `pkg-guard contributors` in `LICENSE` with your name.

## 2. Install, build and test

```bash
npm install
npm run build
npm test
```

All tests must pass. `npm test` compiles everything with strict TypeScript settings, then runs the suite.

## 3. Check exactly what will be published

```bash
npm pack --dry-run
```

You should see only: `dist/`, `docs/`, `schema.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`. No `src/`, `test/`, `.test-build/` or `node_modules/`.

Optionally try the real package in another project before publishing:

```bash
npm pack                                   # creates pkg-guard-1.0.0.tgz
cd /path/to/some-other-project
npm install --save-dev /path/to/pkg-guard-1.0.0.tgz
npx pkg-guard scan
```

## 4. Set the version

Follow [semantic versioning](https://semver.org/): `patch` for bug fixes, `minor` for new backwards compatible features, `major` for breaking changes.

```bash
npm version patch      # or minor / major. Updates package.json and creates a git tag
```

Add an entry to `CHANGELOG.md` for every release.

## 5. Publish

```bash
npm publish                      # unscoped name
npm publish --access public      # scoped name (@you/pkg-guard); scoped packages are private by default
```

`prepublishOnly` runs automatically: it rebuilds and re-runs the tests, so a broken build cannot be published. npm asks for your 2FA code.

Verify:

```bash
npm view pkg-guard version
npx pkg-guard@latest --version
```

## 6. Publish from CI with provenance (recommended later)

Provenance shows users that the package was built from your public repository. In GitHub Actions:

```yaml
name: Publish
on:
  release:
    types: [published]
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Create `NPM_TOKEN` at npmjs.com (Access Tokens, type *Automation*) and store it as a repository secret.

## Mistakes and recovery

- **You cannot re-publish the same version.** Bump the version and publish again.
- **Published something wrong?** Within 72 hours you can `npm unpublish <name>@<version>`; after that, publish a fixed version and run `npm deprecate <name>@<version> "reason"`.
- **Never publish secrets.** Step 3 (`npm pack --dry-run`) is your safety check.

## Release checklist

- [ ] Name checked (`npm view`) and replaced everywhere if renamed
- [ ] `author`, `repository`, `homepage`, `bugs`, and `LICENSE` name filled in
- [ ] `npm test` passes
- [ ] `npm pack --dry-run` lists only the expected files
- [ ] `CHANGELOG.md` updated, version bumped
- [ ] `npm publish` done, `npx <name>@latest --version` works
