// @spec DFF-SM-040
// @spec DFF-SM-041
// @spec DFF-SM-042
// @spec DFF-SM-043
// @spec DFF-SM-044
// @spec DFF-SM-072
// @spec DFF-SM-086
import type { LeagueContext } from './context.js';
import type { TradeScore } from './tradeScorer.js';

export type AdvisorFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type AdvisorResult = {
  narrative: string | null;
  claudeUnavailable: boolean;
};

export type SeasonAdvisor = {
  explainTrade: (context: LeagueContext, score: TradeScore) => Promise<AdvisorResult>;
};

const defaultModel = 'claude-sonnet-4-6';
const defaultEndpoint = 'https://api.anthropic.com/v1/messages';
const responseFormat = `**Verdict:** Win / Loss / Neutral

**Primary signal:** [Which of the five signals most drives this verdict and why]

**Key factors:**
- [Factor citing a specific signal value or roster context]
- [Factor]

**Non-obvious consideration:** [Something the signals don't directly capture]

**Recommendation:** [Single clear sentence]`;

function counterpartyRosterId(context: LeagueContext, score: TradeScore): number | null {
  const offer = context.pendingOffers.find((entry) => String(entry.transactionId) === score.transactionId);

  if (!offer) {
    return null;
  }

  if (offer.proposerRosterId !== context.userRosterId) {
    return offer.proposerRosterId;
  }

  return offer.responderRosterIds.find((id) => id !== context.userRosterId) ?? null;
}

function rosterLines(context: LeagueContext, rosterId: number): string[] {
  const team = context.allRosters.find((candidate) => candidate.rosterId === rosterId);

  if (!team) {
    return ['(unknown roster)'];
  }

  return team.players.map(
    (entry) => `- ${entry.name} (${entry.position}, ${entry.age ?? '?'}y) — dynasty value ${entry.dynastyValue}`,
  );
}

// @spec DFF-SM-044 — static league context is sent as a cacheable system prefix.
// @spec DFF-SM-072 — only the user roster, counterparty roster, medians, and the score object.
function contextSummary(context: LeagueContext, score: TradeScore): string {
  const medianLines = Object.entries(context.leagueMedians).map(
    ([position, value]) => `- ${position}: ${value}`,
  );
  const counterparty = counterpartyRosterId(context, score);

  return [
    'You are a dynasty fantasy football trade analyst. Be opinionated and ground every claim in the provided signal data.',
    '',
    `League: ${context.league.name} (${context.league.season}), ${context.league.totalRosters} teams.`,
    '',
    'User roster:',
    ...rosterLines(context, context.userRosterId),
    '',
    'Counterparty roster:',
    ...(counterparty === null ? ['(unknown)'] : rosterLines(context, counterparty)),
    '',
    'League median positional value (depth totals):',
    ...medianLines,
  ].join('\n');
}

function tradePrompt(score: TradeScore): string {
  const assets = (label: string, items: TradeScore['assetsIn']): string =>
    `${label}: ${items.length === 0 ? '(none)' : items.map((asset) => `${asset.label} (value ${asset.dynastyValue})`).join(', ')}`;

  return [
    `Trade ${score.transactionId}:`,
    assets('User sends', score.assetsOut),
    assets('User receives', score.assetsIn),
    '',
    'Five-signal score:',
    `- value delta: ${score.signals.valueDelta.toFixed(1)}`,
    `- age curve: ${score.signals.ageCurveScore.toFixed(1)} (positive = buying older)`,
    `- positional need: ${score.signals.positionalNeedScore.toFixed(1)}`,
    `- asset liquidity: ${score.signals.assetLiquidity}`,
    `- composite: ${score.compositeScore.toFixed(1)} (${score.verdict})`,
    score.warnings.length > 0 ? `- warnings: ${score.warnings.join('; ')}` : '',
    '',
    'Explain why the composite is what it is. Cite specific dynasty value figures (e.g. "dynasty value: 4200") in every value claim. Highlight the most decisive signal and surface at least one non-obvious factor.',
    'Respond in exactly this format:',
    responseFormat,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function extractText(payload: unknown): string | null {
  const content =
    payload && typeof payload === 'object' && 'content' in payload
      ? (payload as { content?: unknown }).content
      : undefined;

  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text);

  return parts.length > 0 ? parts.join('\n').trim() : null;
}

// @spec DFF-SM-043 — any failure yields `claudeUnavailable` so the raw score is always usable.
// @spec DFF-SM-086 — narratives are never persisted; each call recomputes.
export function createSeasonAdvisor({
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = fetch as AdvisorFetch,
  model = defaultModel,
  endpoint = defaultEndpoint,
}: {
  apiKey?: string;
  fetchImpl?: AdvisorFetch;
  model?: string;
  endpoint?: string;
} = {}): SeasonAdvisor {
  async function explainTrade(context: LeagueContext, score: TradeScore): Promise<AdvisorResult> {
    if (!apiKey) {
      return { narrative: null, claudeUnavailable: true };
    }

    const body = {
      model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: contextSummary(context, score),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: tradePrompt(score) }],
    };

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return { narrative: null, claudeUnavailable: true };
      }

      const narrative = extractText(await response.json());

      return narrative === null
        ? { narrative: null, claudeUnavailable: true }
        : { narrative, claudeUnavailable: false };
    } catch {
      return { narrative: null, claudeUnavailable: true };
    }
  }

  return { explainTrade };
}
