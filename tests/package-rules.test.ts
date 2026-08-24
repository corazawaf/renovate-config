import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// applyPackageRules is an internal Renovate utility that evaluates packageRules
// against a dependency config object, returning the merged result. We use it
// to assert that our packageRules route each update type to the correct group
// and settings without needing to run Renovate end-to-end.
// Pinned to renovate 43.84.2 in package.json.
import { applyPackageRules } from 'renovate/dist/util/package-rules/index.js';
import { getOptions } from 'renovate/dist/config/options/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, '..', 'package-rules.json');
const packageRules: any[] = JSON.parse(readFileSync(configPath, 'utf8')).packageRules;

const defaultConfigPath = join(__dirname, '..', 'default.json');
const defaultConfig: any = JSON.parse(readFileSync(defaultConfigPath, 'utf8'));

// ---------------------------------------------------------------------------
// Helper: apply our packageRules to a simulated dependency update
// ---------------------------------------------------------------------------
function applyRules(dep: {
  depName: string;
  packageName?: string;
  depType?: string;
  manager?: string;
  datasource?: string;
  updateType?: string;
}) {
  return applyPackageRules({
    packageName: dep.packageName ?? dep.depName,
    depName: dep.depName,
    depType: dep.depType,
    manager: dep.manager,
    datasource: dep.datasource,
    updateType: dep.updateType,
    packageRules,
  });
}

// ---------------------------------------------------------------------------
// 1. Minimum release age stabilization
// ---------------------------------------------------------------------------
describe('minimumReleaseAge stabilization (default.json)', () => {
  // These are top-level Renovate config options in default.json,
  // not packageRules (which require match* selectors).
  it('applies 15-day minimum release age globally', () => {
    expect(defaultConfig.minimumReleaseAge).toBe('15 days');
  });

  it('sets prCreation to not-pending', () => {
    expect(defaultConfig.prCreation).toBe('not-pending');
  });

  it('sets internalChecksFilter to strict', () => {
    expect(defaultConfig.internalChecksFilter).toBe('strict');
  });
});

// ---------------------------------------------------------------------------
// 2. GitHub Actions → grouped and auto-merged
// ---------------------------------------------------------------------------
describe('GitHub Actions updates', () => {
  it('auto-merges github-actions updates', async () => {
    const result = await applyRules({
      depName: 'actions/checkout',
      manager: 'github-actions',
      updateType: 'minor',
    });

    expect(result.automerge).toBe(true);
  });

  it('applies github-actions grouping (overridden by later non-major rule)', async () => {
    const result = await applyRules({
      depName: 'actions/checkout',
      manager: 'github-actions',
      updateType: 'minor',
    });

    // The github-actions rule sets groupName, but the broader "all non-major
    // dependencies" rule matches later and overrides it. Both rules apply automerge.
    expect(result.groupName).toBe('all non-major dependencies');
  });

  it('groups major github-actions into all major dependencies', async () => {
    const result = await applyRules({
      depName: 'actions/checkout',
      manager: 'github-actions',
      updateType: 'major',
    });

    // The "all major dependencies" rule is the last matching rule for major updates
    expect(result.groupName).toBe('all major dependencies');
  });
});

// ---------------------------------------------------------------------------
// 3. Golang version pinning — the core constraint
// ---------------------------------------------------------------------------
describe('Golang version pinning', () => {
  describe('docker/golang-version datasource (go toolchain)', () => {
    it('restricts go to ~1.25.0 via allowedVersions', async () => {
      const result = await applyRules({
        depName: 'go',
        datasource: 'golang-version',
        updateType: 'minor',
      });

      expect(result.allowedVersions).toBe('~1.25.0');
    });

    it('restricts golang docker image to ~1.25.0', async () => {
      const result = await applyRules({
        depName: 'golang',
        datasource: 'docker',
        updateType: 'minor',
      });

      expect(result.allowedVersions).toBe('~1.25.0');
    });

    it('does not restrict unrelated docker images', async () => {
      const result = await applyRules({
        depName: 'nginx',
        datasource: 'docker',
        updateType: 'minor',
      });

      expect(result.allowedVersions).toBeUndefined();
    });
  });

  describe('gomod manager (go directive in go.mod)', () => {
    it('restricts go version in go.mod to ~1.25.0', async () => {
      const result = await applyRules({
        depName: 'go',
        manager: 'gomod',
        updateType: 'major',
      });

      expect(result.allowedVersions).toBe('~1.25.0');
    });

    it('does not restrict go module dependencies', async () => {
      const result = await applyRules({
        depName: 'github.com/some/module',
        manager: 'gomod',
        updateType: 'minor',
      });

      // allowedVersions from the golang rule should not apply to arbitrary go modules
      expect(result.allowedVersions).toBeUndefined();
    });
  });

  describe('~1.25.0 constraint behavior', () => {
    // These tests document what ~1.25.0 means in semver:
    // >=1.25.0 and <1.26.0 — only patch updates within 1.25.x
    it('~1.25.0 allows 1.25.x patch versions', () => {
      // The tilde range ~1.25.0 means >=1.25.0, <1.26.0
      // This is a documentation test to make the intent explicit
      const allowed = '~1.25.0';
      expect(allowed).toBe('~1.25.0');
    });

    it('both golang rules use the same allowedVersions constraint', async () => {
      const dockerResult = await applyRules({
        depName: 'go',
        datasource: 'golang-version',
        updateType: 'minor',
      });

      const gomodResult = await applyRules({
        depName: 'go',
        manager: 'gomod',
        updateType: 'major',
      });

      expect(dockerResult.allowedVersions).toBe(gomodResult.allowedVersions);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Go modules minor/patch → auto-merged with post-update options
// ---------------------------------------------------------------------------
describe('Go module minor/patch/pin/digest updates', () => {
  const autoMergeUpdateTypes = ['minor', 'patch', 'pin', 'digest'] as const;

  for (const updateType of autoMergeUpdateTypes) {
    it(`auto-merges ${updateType} go module updates`, async () => {
      const result = await applyRules({
        depName: 'github.com/example/module',
        manager: 'gomod',
        updateType,
      });

      expect(result.automerge).toBe(true);
      // The "go modules" groupName is overridden by the later "all non-major
      // dependencies" rule, but automerge and postUpdateOptions persist.
      expect(result.groupName).toBe('all non-major dependencies');
    });
  }

  it('applies gomodUpdateImportPaths post-update option', async () => {
    const result = await applyRules({
      depName: 'github.com/example/module',
      manager: 'gomod',
      updateType: 'minor',
    });

    expect(result.postUpdateOptions).toContain('gomodUpdateImportPaths');
  });

  it('applies gomodTidy post-update option', async () => {
    const result = await applyRules({
      depName: 'github.com/example/module',
      manager: 'gomod',
      updateType: 'minor',
    });

    // Renovate matches this value with an exact string include (see
    // modules/manager/gomod/artifacts.ts), so the casing has to be right or
    // `go mod tidy` silently never runs.
    expect(result.postUpdateOptions).toContain('gomodTidy');
  });

  it('does not auto-merge major go module updates via the go modules rule', async () => {
    const result = await applyRules({
      depName: 'github.com/example/module',
      manager: 'gomod',
      updateType: 'major',
    });

    // Major updates are grouped separately into "all major dependencies"
    expect(result.groupName).toBe('all major dependencies');
  });
});

// ---------------------------------------------------------------------------
// 5. Non-major dependencies → grouped and auto-merged
// ---------------------------------------------------------------------------
describe('Non-major dependency updates', () => {
  const nonMajorTypes = ['minor', 'patch', 'pin', 'digest'] as const;

  for (const updateType of nonMajorTypes) {
    it(`auto-merges ${updateType} updates from GitHub sources`, async () => {
      const result = await applyRules({
        depName: 'some/package',
        updateType,
      });

      expect(result.automerge).toBe(true);
    });
  }

  it('includes OpenSSF scorecard badge in PR body for GitHub-sourced deps', async () => {
    const result = await applyRules({
      depName: 'some/package',
      updateType: 'minor',
    });

    expect(result.prBodyDefinitions).toHaveProperty('OpenSSF');
    expect(result.prBodyDefinitions.OpenSSF).toContain('securityscorecards.dev');
  });
});

// ---------------------------------------------------------------------------
// 6. Dev dependencies → auto-merged
// ---------------------------------------------------------------------------
describe('Dev dependency updates', () => {
  it('auto-merges devDependencies', async () => {
    const result = await applyRules({
      depName: 'some-dev-tool',
      depType: 'devDependencies',
      updateType: 'minor',
    });

    expect(result.automerge).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Major updates → grouped separately
// ---------------------------------------------------------------------------
describe('Major dependency updates', () => {
  it('groups all major updates together', async () => {
    const result = await applyRules({
      depName: 'some/package',
      updateType: 'major',
    });

    expect(result.groupName).toBe('all major dependencies');
    expect(result.groupSlug).toBe('all-major');
  });

  it('does not auto-merge major updates (no automerge in major rule)', async () => {
    const result = await applyRules({
      depName: 'some/package',
      updateType: 'major',
    });

    // The major rule doesn't set automerge, so it should not be true
    // (unless inherited from another matching rule)
    expect(result.automerge).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9. Guardrail: every option value we set must be one Renovate recognises
// ---------------------------------------------------------------------------
describe('postUpdateOptions values are valid', () => {
  // renovate-config-validator does not check allowedValues for this option, and
  // Renovate matches the values by exact string, so a typo is silently ignored
  // rather than reported. This asserts against Renovate's own allowedValues.
  const allowed: string[] =
    getOptions().find((o: any) => o.name === 'postUpdateOptions')?.allowedValues ?? [];

  it('exposes a non-empty allowedValues list to test against', () => {
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed).toContain('gomodTidy');
  });

  it('rejects the goModTidy casing that Renovate ignores', () => {
    expect(allowed).not.toContain('goModTidy');
  });

  for (const rule of packageRules) {
    for (const value of rule.postUpdateOptions ?? []) {
      it(`"${value}" is a recognised postUpdateOptions value`, () => {
        expect(allowed).toContain(value);
      });
    }
  }
});
