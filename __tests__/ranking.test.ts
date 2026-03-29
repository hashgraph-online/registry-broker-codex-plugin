import { describe, expect, it } from 'vitest';
import { pickDelegateCandidates } from '../src/ranking';

describe('pickDelegateCandidates', () => {
  it('prioritizes coding-specialist keyword matches for coding tasks', () => {
    const results = [
      {
        hits: [
          {
            agent: {
              uaid: 'uaid:generic',
              registry: 'openrouter',
              trustScore: 92,
              communicationSupported: true,
              profile: {
                display_name: 'Generic Agent',
                alias: 'generic-agent',
              },
              metadata: {
                provider: 'generic',
                delegationSummary: 'general purpose research agent',
              },
            },
            score: 0.09,
          },
        ],
      },
      {
        hits: [],
      },
      {
        hits: [
          {
            uaid: 'uaid:codex',
            registry: 'openrouter',
            profile: {
              display_name: 'OpenAI: GPT-5.3-Codex',
              alias: 'openai/gpt-5.3-codex',
            },
            description:
              'Advanced coding model for debugging TypeScript regressions and shipping patches.',
            metadata: {
              provider: 'openai',
              delegationTaskTags: ['debugging', 'typescript', 'code', 'patch'],
            },
          },
        ],
      },
    ];

    const candidates = pickDelegateCandidates(results, {
      limit: 2,
      registries: ['openrouter'],
      taskText: 'Debug a TypeScript regression and propose a minimal code patch.',
    });

    expect(candidates[0]?.label).toBe('OpenAI: GPT-5.3-Codex');
    expect(candidates[1]?.label).toBe('Generic Agent');
  });
});
