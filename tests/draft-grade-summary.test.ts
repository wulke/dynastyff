// @spec DFF-GRADE-001
// @spec DFF-GRADE-010
// @spec DFF-GRADE-013
// @spec DFF-GRADE-020
// @spec DFF-GRADE-030
// @spec DFF-GRADE-040
// @spec DFF-GRADE-050
// @spec DFF-GRADE-051
// @spec DFF-GRADE-052
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDraftGradeSummaries,
  getUserTeamGradeSummary,
  type DraftGradeSummaryInput,
} from '../src/draft/grade-summary.js';

// @spec DFF-GRADE-001
// @spec DFF-GRADE-010
// @spec DFF-GRADE-020
// @spec DFF-GRADE-030
// @spec DFF-GRADE-040
function createCompletedDraftInput(): DraftGradeSummaryInput {
  return {
    status: 'completed',
    rosterConfig: {
      QB: 1,
      RB: 1,
      WR: 1,
      TE: 1,
      FLEX: 0,
      SF: 0,
      bench: 0,
    },
    teams: [
      { id: 'team-user', name: 'You', isUser: true },
      { id: 'team-bot', name: 'Bot', isUser: false },
    ],
    draftOrder: [
      { pickNumber: 1, teamId: 'team-user' },
      { pickNumber: 2, teamId: 'team-bot' },
      { pickNumber: 3, teamId: 'team-bot' },
      { pickNumber: 4, teamId: 'team-user' },
      { pickNumber: 5, teamId: 'team-user' },
      { pickNumber: 6, teamId: 'team-bot' },
      { pickNumber: 7, teamId: 'team-bot' },
      { pickNumber: 8, teamId: 'team-user' },
    ],
    picks: [
      { pickNumber: 1, teamId: 'team-user', playerId: 'player-qb' },
      { pickNumber: 2, teamId: 'team-bot', playerId: 'player-wr-1' },
      { pickNumber: 3, teamId: 'team-bot', playerId: 'player-wr-2' },
      { pickNumber: 4, teamId: 'team-user', playerId: 'player-rb' },
      { pickNumber: 5, teamId: 'team-user', playerId: 'player-wr' },
      { pickNumber: 6, teamId: 'team-bot', playerId: 'player-wr-3' },
      { pickNumber: 7, teamId: 'team-bot', playerId: 'player-wr-4' },
      { pickNumber: 8, teamId: 'team-user', playerId: 'player-te' },
    ],
    rosterPlayers: [
      { teamId: 'team-user', playerId: 'player-qb' },
      { teamId: 'team-user', playerId: 'player-rb' },
      { teamId: 'team-user', playerId: 'player-wr' },
      { teamId: 'team-user', playerId: 'player-te' },
      { teamId: 'team-bot', playerId: 'player-wr-1' },
      { teamId: 'team-bot', playerId: 'player-wr-2' },
      { teamId: 'team-bot', playerId: 'player-wr-3' },
      { teamId: 'team-bot', playerId: 'player-wr-4' },
    ],
    playerCatalog: {
      'player-qb': { id: 'player-qb', name: 'Elite QB', position: 'QB', dynastyValue: 8000, adp: 2 },
      'player-rb': { id: 'player-rb', name: 'Anchor RB', position: 'RB', dynastyValue: 7600, adp: 6 },
      'player-wr': { id: 'player-wr', name: 'WR1', position: 'WR', dynastyValue: 7400, adp: 5 },
      'player-te': { id: 'player-te', name: 'Difference TE', position: 'TE', dynastyValue: 7200, adp: 8 },
      'player-wr-1': { id: 'player-wr-1', name: 'WR A', position: 'WR', dynastyValue: 7000, adp: 1 },
      'player-wr-2': { id: 'player-wr-2', name: 'WR B', position: 'WR', dynastyValue: 6800, adp: 3 },
      'player-wr-3': { id: 'player-wr-3', name: 'WR C', position: 'WR', dynastyValue: 6600, adp: 4 },
      'player-wr-4': { id: 'player-wr-4', name: 'WR D', position: 'WR', dynastyValue: 6400, adp: 7 },
    },
  };
}

// @spec DFF-GRADE-050
test('calculateDraftGradeSummaries returns null for incomplete drafts', () => {
  const draft = createCompletedDraftInput();
  draft.status = 'in_progress';

  assert.equal(calculateDraftGradeSummaries(draft), null);
});

// @spec DFF-GRADE-010
// @spec DFF-GRADE-020
// @spec DFF-GRADE-030
// @spec DFF-GRADE-040
// @spec DFF-GRADE-051
test('calculateDraftGradeSummaries rewards the balanced team and applies failing balance/construction outcomes to an all-one-position team', () => {
  const summary = calculateDraftGradeSummaries(createCompletedDraftInput());

  assert.ok(summary);
  assert.equal(summary.teamSummaries.length, 2);

  const userSummary = summary.teamSummaries.find((team) => team.teamId === 'team-user');
  const botSummary = summary.teamSummaries.find((team) => team.teamId === 'team-bot');

  assert.ok(userSummary);
  assert.ok(botSummary);
  assert.equal(summary.teamSummaries[0]?.teamId, 'team-user');
  assert.ok(userSummary.overallScore > botSummary.overallScore);
  assert.ok(userSummary.dimensions.valueOverExpectedAdp.score > 50);
  assert.ok(userSummary.dimensions.rosterConstruction.score >= 80);
  assert.equal(botSummary.dimensions.positionalBalance.score, 0);
  assert.ok(botSummary.dimensions.rosterConstruction.score < 40);
  assert.equal(botSummary.warnings.includes('degenerate_roster'), true);
});

// @spec DFF-GRADE-013
// @spec DFF-GRADE-052
test('calculateDraftGradeSummaries assigns a neutral ADP score and warning when a team has no usable ADP values', () => {
  const draft = createCompletedDraftInput();

  for (const playerId of ['player-qb', 'player-rb', 'player-wr', 'player-te']) {
    draft.playerCatalog[playerId] = {
      ...draft.playerCatalog[playerId]!,
      adp: null,
      dynastyValue: 0,
    };
  }

  const userSummary = getUserTeamGradeSummary(draft);

  assert.ok(userSummary);
  assert.equal(userSummary.dimensions.valueOverExpectedAdp.score, 50);
  assert.equal(userSummary.dimensions.valueOverExpectedAdp.warnings.includes('missing_adp'), true);
});
