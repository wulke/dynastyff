// @spec DFF-SM-040
// @spec DFF-SM-041
// @spec DFF-SM-042
// @spec DFF-SM-043
// @spec DFF-SM-044
// @spec DFF-SM-072
import test from 'node:test';
import assert from 'node:assert/strict';

import { assembleLeagueContext } from '../src/season/context.js';
import { createSeasonAdvisor, type AdvisorFetch } from '../src/season/seasonAdvisor.js';
import { scoreTrade } from '../src/season/tradeScorer.js';
import { createSeasonFixture, seasonLeagueId } from './season-fixture.js';

type CapturedRequest = { url: string; init?: RequestInit };

function stubAdvisorFetch(
  handler: () => { status?: number; body?: unknown; throw?: boolean },
): AdvisorFetch & { requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const result = handler();

    if (result.throw) {
      throw new Error('network down');
    }

    return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as AdvisorFetch & { requests: CapturedRequest[] };

  fetchImpl.requests = requests;
  return fetchImpl;
}

function fixtureScore() {
  const fixture = createSeasonFixture();

  try {
    const context = assembleLeagueContext(fixture.db, seasonLeagueId);
    const offer = context.pendingOffers[0];
    return { fixture, context, score: scoreTrade(context, offer) };
  } catch (error) {
    fixture.cleanup();
    throw error;
  }
}

// @spec DFF-SM-040
// @spec DFF-SM-041
// @spec DFF-SM-042
// @spec DFF-SM-044
// @spec DFF-SM-072
test('explainTrade sends the cached context prefix and formatted signal prompt to Claude', async () => {
  const { fixture, context, score } = fixtureScore();
  const fetchImpl = stubAdvisorFetch(() => ({
    body: {
      content: [
        {
          type: 'text',
          text: '**Verdict:** Win\n\n**Primary signal:** value delta\n\n**Key factors:**\n- dynasty value: 3800\n\n**Non-obvious consideration:** bye weeks\n\n**Recommendation:** accept',
        },
      ],
    },
  }));
  const advisor = createSeasonAdvisor({ apiKey: 'test-key', fetchImpl });

  try {
    const result = await advisor.explainTrade(context, score);

    assert.equal(result.claudeUnavailable, false);
    assert.match(result.narrative ?? '', /Verdict/);

    assert.equal(fetchImpl.requests.length, 1);
    const request = fetchImpl.requests[0];
    const headers = request.init?.headers as Record<string, string>;

    assert.equal(headers['x-api-key'], 'test-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');

    const body = JSON.parse(String(request.init?.body)) as {
      model: string;
      system: { text: string; cache_control?: { type: string } }[];
      messages: { content: string }[];
    };

    // @spec DFF-SM-044 — the static league context is a cacheable prefix.
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.system[0].cache_control?.type, 'ephemeral');

    // @spec DFF-SM-072 — user roster, counterparty roster, and medians only.
    assert.match(body.system[0].text, /User roster/);
    assert.match(body.system[0].text, /Counterparty roster/);
    assert.match(body.system[0].text, /League median positional value/);

    // @spec DFF-SM-041
    assert.match(body.messages[0].content, /Primary signal/);
    assert.match(body.messages[0].content, /Non-obvious consideration/);
    // @spec DFF-SM-042
    assert.match(body.messages[0].content, /dynasty value/);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-043
test('explainTrade reports claudeUnavailable without an API key and never calls out', async () => {
  const { fixture, context, score } = fixtureScore();
  const fetchImpl = stubAdvisorFetch(() => ({ body: {} }));
  const advisor = createSeasonAdvisor({ apiKey: undefined, fetchImpl });

  try {
    const result = await advisor.explainTrade(context, score);

    assert.equal(result.claudeUnavailable, true);
    assert.equal(result.narrative, null);
    assert.equal(fetchImpl.requests.length, 0);
  } finally {
    fixture.cleanup();
  }
});

// @spec DFF-SM-043
test('explainTrade degrades gracefully on HTTP failures, malformed bodies, and network errors', async () => {
  const { fixture, context, score } = fixtureScore();
  const cases: Array<() => { status?: number; body?: unknown; throw?: boolean }> = [
    () => ({ status: 500, body: { error: 'boom' } }),
    () => ({ status: 200, body: { content: [] } }),
    () => ({ status: 200, body: { content: [{ type: 'tool_use', id: 'x' }] } }),
    () => ({ throw: true }),
  ];

  try {
    for (const handler of cases) {
      const fetchImpl = stubAdvisorFetch(handler);
      const advisor = createSeasonAdvisor({ apiKey: 'test-key', fetchImpl });
      const result = await advisor.explainTrade(context, score);

      assert.equal(result.claudeUnavailable, true);
      assert.equal(result.narrative, null);
    }
  } finally {
    fixture.cleanup();
  }
});
