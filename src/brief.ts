export interface DelegationBriefInput {
  task: string;
  context?: string;
  deliverable?: string;
  constraints?: string[];
  mustInclude?: string[];
  acceptanceCriteria?: string[];
}

type BriefSection = {
  title: string;
  values?: string[];
};

export function buildDelegationContext(
  input: Omit<DelegationBriefInput, 'task'>,
): string | undefined {
  const sections = collectBriefSections(input);

  if (sections.length === 0) {
    return undefined;
  }

  return sections
    .map((section) => renderBriefSection(section))
    .filter((value): value is string => value !== undefined)
    .join('\n\n');
}

export function buildDelegationBrief(input: DelegationBriefInput): string {
  const sections = [
    sanitizeString(input.task),
    buildDelegationContext({
      context: input.context,
      deliverable: input.deliverable,
      constraints: input.constraints,
      mustInclude: input.mustInclude,
      acceptanceCriteria: input.acceptanceCriteria,
    }),
  ].filter((value): value is string => value !== undefined);

  return sections.join('\n\n');
}

export function buildDelegationPrompt(
  input: DelegationBriefInput,
  candidate: { uaid: string; label: string },
): string {
  const header =
    candidate.label && candidate.label !== 'agent'
      ? `${candidate.label} (${candidate.uaid})`
      : candidate.uaid;

  return [
    `Hi ${header},`,
    '',
    'Can you help with this focused subtask?',
    '',
    buildDelegationBrief(input),
    '',
    'Please respond with: (1) approach, (2) key pitfalls, (3) concrete steps or code if helpful.',
  ].join('\n');
}

function collectBriefSections(
  input: Omit<DelegationBriefInput, 'task'>,
): BriefSection[] {
  const context = sanitizeString(input.context);
  const deliverable = sanitizeString(input.deliverable);
  const constraints = normalizeList(input.constraints);
  const mustInclude = normalizeList(input.mustInclude);
  const acceptanceCriteria = normalizeList(input.acceptanceCriteria);
  const sections: BriefSection[] = [];

  if (context) {
    sections.push({ title: '', values: [context] });
  }

  if (deliverable) {
    sections.push({ title: 'Deliverable', values: [deliverable] });
  }

  if (constraints) {
    sections.push({ title: 'Constraints', values: constraints });
  }

  if (mustInclude) {
    sections.push({ title: 'Must include', values: mustInclude });
  }

  if (acceptanceCriteria) {
    sections.push({
      title: 'Acceptance criteria',
      values: acceptanceCriteria,
    });
  }

  return sections;
}

function renderBriefSection(section: BriefSection): string | undefined {
  const values = normalizeList(section.values);
  if (!values) {
    return undefined;
  }

  if (!section.title) {
    return values.join('\n');
  }

  return [section.title + ':', ...values.map((value) => `- ${value}`)].join('\n');
}

function sanitizeString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      values
        .map((value) => sanitizeString(value))
        .filter((value): value is string => value !== undefined),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}
