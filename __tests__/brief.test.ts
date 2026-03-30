import { describe, expect, it } from 'vitest';
import {
  buildDelegationContext,
  buildDelegationPrompt,
} from '../src/brief';

describe('delegation brief helpers', () => {
  it('renders structured delegation context sections compactly', () => {
    const context = buildDelegationContext({
      context: 'Need a bounded specialist review.',
      deliverable: 'Return a minimal patch plan.',
      constraints: ['Do not change public APIs.', 'Keep the diff under 80 lines.'],
      mustInclude: ['Root cause', 'regression risks'],
      acceptanceCriteria: ['Names the exact file to edit', 'Includes one verification step'],
    });

    expect(context).toContain('Need a bounded specialist review.');
    expect(context).toContain('Deliverable:');
    expect(context).toContain('- Return a minimal patch plan.');
    expect(context).toContain('Constraints:');
    expect(context).toContain('- Do not change public APIs.');
    expect(context).toContain('Must include:');
    expect(context).toContain('- regression risks');
    expect(context).toContain('Acceptance criteria:');
    expect(context).toContain('- Includes one verification step');
  });

  it('builds a dispatch prompt with all structured brief fields', () => {
    const prompt = buildDelegationPrompt(
      {
        task: 'Review this TypeScript patch.',
        context: 'This is part of a Codex plugin.',
        deliverable: 'Return a concise review with a fix recommendation.',
        constraints: ['Do not rewrite the feature.'],
        mustInclude: ['Severity-ranked findings'],
        acceptanceCriteria: ['Cites the highest-risk issue first'],
      },
      {
        uaid: 'uaid:test-agent',
        label: 'Test Agent',
      },
    );

    expect(prompt).toContain('Hi Test Agent (uaid:test-agent),');
    expect(prompt).toContain('Review this TypeScript patch.');
    expect(prompt).toContain('Deliverable:');
    expect(prompt).toContain('Must include:');
    expect(prompt).toContain('Acceptance criteria:');
  });
});
