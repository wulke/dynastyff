// @spec DFF-SM-040
// @spec DFF-SM-041
// @spec DFF-SM-042
// @spec DFF-SM-043
// @spec DFF-SM-044
// @spec DFF-SM-072
// @spec DFF-SM-086
import type { LeagueContext, SleeperTradeOfferRecord } from './context.js';
import type { TradeScore } from './tradeScorer.js';
import type { WaiverPair } from './waiverScorer.js';

export type AdvisorFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type AdvisorResult = {
  narrative: string | null;
  claudeUnavailable: boolean;
};

export type SeasonAdvisor = {
  explainTrade: (
    context: LeagueContext,
    score: TradeScore,
    offer?: SleeperTradeOfferRecord,
  ) => Promise<AdvisorResult>;
  explainWaiver: (context: LeagueContext, pair: WaiverPair) => Promise<AdvisorResult>;
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

function counterpartyRosterId(
  context: LeagueContext,
  score: TradeScore,
  offer?: SleeperTradeOfferRecord,
): number | null {
  if (offer) {
    if (offer.proposerRosterId !== context.userRosterId) {
      return offer.proposerRosterId;
    }

    return offer.responderRosterIds.find((id) => id !== context.userRosterId) ?? null;
  }

  const pending = context.pendingOffers.find((entry) => String(entry.transactionId) === score.transactionId);

  if (!pending) {
    return null;
  }

  if (pending.proposerRosterId !== context.userRosterId) {
    return pending.proposerRosterId;
  }

  return pending.responderRosterIds.find((id) => id !== context.userRosterId) ?? null;
}

function rosterLines(context: LeagueContext, rosterId: number): string[] {
  const team = context.allRosters.find((candidate) => candidate.rosterId === rosterId);

  if (!team) {
    return ['(unknown roster)'];
  }

  return team.players.map(
    (entry) => `- ${sanitize(entry.name)} (${entry.position}, ${entry.age ?? '?'}y) — dynasty value ${entry.dynastyValue}`,
  );
}

// Client- or league-supplied strings (asset labels, warnings, roster and team names) pass
// through the prompt. Strip characters that could reshape it (emphasis markers, backticks,
// line breaks) and cap length so nothing can inject instructions or forge the response format.
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f*`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// @spec DFF-SM-044 — static league context is sent as a cacheable system prefix.
// @spec DFF-SM-072 — only the user roster, counterparty roster (none on waivers), medians, and the score object.
function contextSummary(context: LeagueContext, counterpartyId: number | null): string {
  const medianLines = Object.entries(context.leagueMedians).map(
    ([position, value]) => `- ${position}: ${value}`,
  );

  return [
    'You are a dynasty fantasy football trade analyst. Be opinionated and ground every claim in the provided signal data.',
    '',
    `League: ${context.league.name} (${context.league.season}), ${context.league.totalRosters} teams.`,
    '',
    'User roster:',
    ...rosterLines(context, context.userRosterId),
    '',
    'Counterparty roster:',
    ...(counterpartyId === null ? ['(none — waiver wire addition)'] : rosterLines(context, counterpartyId)),
    '',
    'League median positional value (depth totals):',
    ...medianLines,
  ].join('\n');
}

function tradePrompt(score: TradeScore): string {
  const assets = (label: string, items: TradeScore['assetsIn']): string =>
    `${label}: ${items.length === 0 ? '(none)' : items.map((asset) => `${sanitize(asset.label)} (value ${asset.dynastyValue})`).join(', ')}`;

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
    score.warnings.length > 0 ? `- warnings: ${score.warnings.map(sanitize).join('; ')}` : '',
    '',
    'Explain why the composite is what it is. Cite specific dynasty value figures (e.g. "dynasty value: 4200") in every value claim. Highlight the most decisive signal and surface at least one non-obvious factor.',
    'Respond in exactly this format:',
    responseFormat,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function waiverPrompt(pair: WaiverPair): string {
  const player = (entry: WaiverPair['add']): string =>
    `${sanitize(entry.name)} (${entry.position}, ${entry.age ?? '?'}y) — dynasty value ${entry.dynastyValue}`;

  return [
    'Waiver wire add/drop:',
    `- Add: ${player(pair.add)}`,
    pair.drop === null
      ? '- Drop: none required (roster under the limit)'
      : `- Drop: ${player(pair.drop)}`,
    '',
    'Pair score:',
    `- value delta: ${pair.score.valueDeltaScore.toFixed(1)} (raw ${pair.valueDelta} dynasty points)`,
    `- positional need: ${pair.score.positionalNeedScore.toFixed(1)}`,
    `- age curve: ${pair.score.ageCurve === 1 ? 'add is younger' : pair.score.ageCurve === -1 ? 'add is older' : 'neutral'}`,
    '',
    'Explain whether this waiver swap is net-positive in context. Cite specific dynasty value figures (e.g. "dynasty value: 1200") in every value claim. Factor in the user roster, the drop candidate role, and the competitive window. Highlight the most decisive signal and surface at least one non-obvious factor.',
    'Respond in exactly this format:',
    responseFormat,
  ].join('\n');
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
  // @spec DFF-SM-043 — any failure yields `claudeUnavailable` so the raw score is always usable.
  async function requestNarrative(systemText: string, userText: string): Promise<AdvisorResult> {
    if (!apiKey) {
      return { narrative: null, claudeUnavailable: true };
    }

    const body = {
      model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: systemText,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userText }],
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

  async function explainTrade(
    context: LeagueContext,
    score: TradeScore,
    offer?: SleeperTradeOfferRecord,
  ): Promise<AdvisorResult> {
    return requestNarrative(
      contextSummary(context, counterpartyRosterId(context, score, offer)),
      tradePrompt(score),
    );
  }

  // @spec DFF-SM-061
  // @spec DFF-SM-067 — same structured reasoning format as trade analysis.
  async function explainWaiver(context: LeagueContext, pair: WaiverPair): Promise<AdvisorResult> {
    return requestNarrative(contextSummary(context, null), waiverPrompt(pair));
  }

  return { explainTrade, explainWaiver };
}
