# Renovate Bot Shared Config

This repo contains the shared configuration for Renovate Bot used across Coraza WAF repositories.

## Configuration

### default.json

The main entry point that extends Renovate built-in presets (best-practices, semantic versioning, monorepos, Docker/GitHub Actions managers) and imports the modular configs below via `github>corazawaf/renovate-config`. Adds a commit message suffix with the package file path and auto-closes the dependency dashboard.

### package-rules.json

Defines how dependency updates are handled:

- **Stability gate**: All updates require a 15-day minimum release age before a PR is created (`prCreation: not-pending`).
- **GitHub Actions**: Auto-merged as a group.
- **Golang version pinning**: Both the Go toolchain (`golang-version`/`docker` datasources) and the `go` directive in `go.mod` are constrained to `~1.25.0` (i.e. only 1.25.x patch updates are allowed). This keeps Coraza one minor release behind the latest Go version for stability.
- **Go modules**: Minor, patch, pin, and digest updates are auto-merged with `gomodUpdateImportPaths` and `goModTidy` post-update options.
- **Non-major dependencies**: Grouped, auto-merged, and annotated with an [OpenSSF Scorecard](https://securityscorecards.dev) badge for GitHub-sourced packages.
- **Dev dependencies**: Auto-merged.
- **Major updates**: Grouped into a single PR for manual review (not auto-merged).

### labels.json

Applies three labels to every PR: `dependencies`, the datasource name, and the update type.

### security.json

Enables OSV vulnerability alerts and labels security-related PRs with `security`.

## Testing

Tests use [Jest](https://jestjs.io/) with Renovate's internal `applyPackageRules` utility to verify that each package rule routes dependency updates to the correct group, automerge setting, and version constraint.

```bash
npm install
npm test
```
