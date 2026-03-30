import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');

describe('package hygiene', () => {
  it('ships publishable interface metadata and a codex ignore file', () => {
    const pluginManifest = JSON.parse(
      readFileSync(path.join(projectRoot, '.codex-plugin', 'plugin.json'), 'utf8'),
    ) as {
      interface?: {
        type?: string;
      };
    };

    expect(pluginManifest.interface?.type).toBe('cli');
    expect(existsSync(path.join(projectRoot, '.codexignore'))).toBe(true);

    const codexIgnore = readFileSync(path.join(projectRoot, '.codexignore'), 'utf8');
    expect(codexIgnore).toContain('node_modules');
    expect(codexIgnore).toContain('dist');
  });

  it('keeps documentation and fixtures free of secret-like placeholders', () => {
    const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
    const brokerClientTest = readFileSync(
      path.join(projectRoot, '__tests__', 'broker-client.test.ts'),
      'utf8',
    );

    expect(readme).not.toContain("'your-api-key-if-needed'");
    expect(readme).toContain('REGISTRY_BROKER_API_KEY=<broker-api-key-if-required>');
    expect(brokerClientTest).not.toContain("'test-key'");
    expect(brokerClientTest).toContain("['fixture', 'value'].join('-')");
  });

  it('pins github actions and enables dependabot', () => {
    const ciWorkflow = readFileSync(
      path.join(projectRoot, '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    const releaseDrafterWorkflow = readFileSync(
      path.join(projectRoot, '.github', 'workflows', 'release-drafter.yml'),
      'utf8',
    );

    expect(ciWorkflow).toContain(
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    );
    expect(ciWorkflow).toContain(
      'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
    );
    expect(ciWorkflow).toContain(
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    );
    expect(releaseDrafterWorkflow).toContain(
      'release-drafter/release-drafter@6a93d829887aa2e0748befe2e808c66c0ec6e4c7',
    );
    expect(existsSync(path.join(projectRoot, '.github', 'dependabot.yml'))).toBe(true);
  });
});
