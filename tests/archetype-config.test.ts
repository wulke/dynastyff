// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-040
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  createArchetypeConfigLoader,
  defaultArchetypesConfigPath,
  loadArchetypeConfigFile,
} from '../src/draft/archetype-config.js';

// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-040
test('loadArchetypeConfigFile reads the documented default archetype parameters from config/archetypes.json', () => {
  const config = loadArchetypeConfigFile();

  assert.equal(defaultArchetypesConfigPath, path.resolve(process.cwd(), 'config', 'archetypes.json'));
  assert.deepEqual(config, {
    archetypes: {
      win_now: {
        acceptanceThreshold: 0.85,
        preferredPositionValueFloors: { QB: 3500, RB: 3500, WR: 3500, TE: 3500 },
        tradeAggressivenessProbability: 0.25,
      },
      punt: {
        acceptanceThreshold: 1.15,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.35,
      },
      rb_heavy: {
        acceptanceThreshold: 0.95,
        preferredPositionValueFloors: { QB: 2000, RB: 3500, WR: 2000, TE: 2000 },
        tradeAggressivenessProbability: 0.2,
      },
      qb_early: {
        acceptanceThreshold: 0.95,
        preferredPositionValueFloors: { QB: 4000, RB: 2000, WR: 2000, TE: 2000 },
        tradeAggressivenessProbability: 0.2,
      },
      bpa: {
        acceptanceThreshold: 1.05,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.1,
      },
      balanced: {
        acceptanceThreshold: 1,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.15,
      },
    },
  });
});

// @spec DFF-BOT-001
test('createArchetypeConfigLoader memoizes the startup config read', () => {
  let readCount = 0;
  const loader = createArchetypeConfigLoader({
    configPath: '/virtual/config/archetypes.json',
    readFile: () => {
      readCount += 1;

      return JSON.stringify({
        archetypes: {
          win_now: {
            acceptanceThreshold: 0.85,
            preferredPositionValueFloors: { QB: 3500, RB: 3500, WR: 3500, TE: 3500 },
            tradeAggressivenessProbability: 0.25,
          },
          punt: {
            acceptanceThreshold: 1.15,
            preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
            tradeAggressivenessProbability: 0.35,
          },
          rb_heavy: {
            acceptanceThreshold: 0.95,
            preferredPositionValueFloors: { QB: 2000, RB: 3500, WR: 2000, TE: 2000 },
            tradeAggressivenessProbability: 0.2,
          },
          qb_early: {
            acceptanceThreshold: 0.95,
            preferredPositionValueFloors: { QB: 4000, RB: 2000, WR: 2000, TE: 2000 },
            tradeAggressivenessProbability: 0.2,
          },
          bpa: {
            acceptanceThreshold: 1.05,
            preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
            tradeAggressivenessProbability: 0.1,
          },
          balanced: {
            acceptanceThreshold: 1,
            preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
            tradeAggressivenessProbability: 0.15,
          },
        },
      });
    },
  });

  const firstLoad = loader();
  const secondLoad = loader();

  assert.equal(readCount, 1);
  assert.equal(firstLoad, secondLoad);
});
