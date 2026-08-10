// @spec DFF-UI-194
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSleeperLeagueSettings } from '../src/server/sleeper-config-import.js';

// @spec DFF-UI-194
test('maps Sleeper scoring, TE premium, supported roster slots, and team count while ignoring draft_rounds', () => {
  const prefill = mapSleeperLeagueSettings({
    num_teams: 10,
    draft_rounds: 3,
    scoring_settings: {
      rec: 0.5,
      bonus_rec_te: 0.5,
    },
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'IR', 'K'],
  });

  assert.deepEqual(prefill, {
    teamCount: 10,
    scoringFormat: 'half_ppr',
    tePremiumTier: 'tep',
    rosterConfig: {
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      FLEX: 1,
      SF: 1,
      bench: 3,
    },
  });
  assert.equal('rounds' in prefill, false);
});
