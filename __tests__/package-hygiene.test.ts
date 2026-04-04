import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');

describe('package hygiene', () => {
  it('ships publishable interface metadata and a codex ignore file', () => {
    const pluginManifest = JSON.parse(
      readFileSync(path.join(projectRoot, '.codex-plugin', 'plugin.json'), 'utf8'),
    ) as {
      interface?: Record<string, unknown>;
    };

    expect(pluginManifest.interface).toBeDefined();
    expect(pluginManifest.interface).not.toHaveProperty('type');
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
    const apiKeyVariable = ['REGISTRY', 'BROKER', 'API', 'KEY'].join('_');
    const shellGuidance = `If your broker requires an API key, set \`${apiKeyVariable}\` in your shell before running the command.`;
    const quotedPlaceholder = `${apiKeyVariable}="<broker-api-key-if-required>"`;

    expect(readme).not.toContain("'your-api-key-if-needed'");
    expect(readme).toContain(shellGuidance);
    expect(readme).not.toContain(quotedPlaceholder);
    expect(brokerClientTest).not.toContain("'test-key'");
    expect(brokerClientTest).toContain("['fixture', 'value'].join('-')");
  });

  it('pins github actions, dogfoods the scanner action, and enables dependabot', () => {
    const ciWorkflow = readFileSync(
      path.join(projectRoot, '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    const releaseDrafterWorkflow = readFileSync(
      path.join(projectRoot, '.github', 'workflows', 'release-drafter.yml'),
      'utf8',
    );
    const releaseDrafterAutolabelerWorkflow = readFileSync(
      path.join(projectRoot, '.github', 'workflows', 'release-drafter-autolabeler.yml'),
      'utf8',
    );

    expect(ciWorkflow).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(ciWorkflow).toMatch(/pnpm\/action-setup@[0-9a-f]{40}/);
    expect(ciWorkflow).toMatch(/actions\/setup-node@[0-9a-f]{40}/);
    expect(ciWorkflow).toMatch(
      /hashgraph-online\/codex-plugin-scanner\/action@[0-9a-f]{40}/,
    );
    expect(ciWorkflow).toMatch(/github\/codeql-action\/upload-sarif@[0-9a-f]{40}/);
    expect(ciWorkflow).toContain('format: sarif');
    expect(ciWorkflow).toContain('min_score: 95');
    expect(ciWorkflow).toContain('output: codex-plugin-scanner.sarif');
    expect(ciWorkflow).toContain('fail_on_severity: high');
    expect(releaseDrafterWorkflow).toMatch(
      /release-drafter\/release-drafter@[0-9a-f]{40}/,
    );
    expect(releaseDrafterAutolabelerWorkflow).toMatch(
      /release-drafter\/release-drafter\/autolabeler@[0-9a-f]{40}/,
    );
    expect(existsSync(path.join(projectRoot, '.github', 'dependabot.yml'))).toBe(true);
  });
});
