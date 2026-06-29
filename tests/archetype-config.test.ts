// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-004
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
// @spec DFF-BOT-004
// @spec DFF-BOT-040
test('loadArchetypeConfigFile reads the documented default archetype parameters from config/archetypes.json', () => {
  const config = loadArchetypeConfigFile();

  assert.equal(defaultArchetypesConfigPath, path.resolve(process.cwd(), 'config', 'archetypes.json'));
  assert.deepEqual(config, {
    randomness: 0.3,
    archetypes: {
      win_now: {
        acceptanceThreshold: 0.85,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 3500, RB: 3500, WR: 3500, TE: 3500 },
        tradeAggressivenessProbability: 0.25,
        valueWeight: 0.6,
      },
      punt: {
        acceptanceThreshold: 1.15,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.35,
        valueWeight: 0.9,
      },
      rb_heavy: {
        acceptanceThreshold: 0.95,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 2000, RB: 3500, WR: 2000, TE: 2000 },
        tradeAggressivenessProbability: 0.2,
        valueWeight: 0.7,
      },
      qb_early: {
        acceptanceThreshold: 0.95,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 4000, RB: 2000, WR: 2000, TE: 2000 },
        tradeAggressivenessProbability: 0.2,
        valueWeight: 0.5,
      },
      bpa: {
        acceptanceThreshold: 1.05,
        needModifier: 0.05,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.1,
        valueWeight: 1,
      },
      balanced: {
        acceptanceThreshold: 1,
        needModifier: 0.25,
        preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
        tradeAggressivenessProbability: 0.15,
        valueWeight: 0.8,
      },
    },
  });
});

// @spec DFF-BOT-001
// @spec DFF-BOT-004
test('createArchetypeConfigLoader memoizes the startup config read', () => {
  let readCount = 0;
  const loader = createArchetypeConfigLoader({
    configPath: '/virtual/config/archetypes.json',
    readFile: () => {
      readCount += 1;

      return JSON.stringify({
        randomness: 0.3,
        archetypes: {
          win_now: {
            acceptanceThreshold: 0.85,
            needModifier: 0.25,
            preferredPositionValueFloors: { QB: 3500, RB: 3500, WR: 3500, TE: 3500 },
            tradeAggressivenessProbability: 0.25,
            valueWeight: 0.6,
          },
          punt: {
            acceptanceThreshold: 1.15,
            needModifier: 0.25,
            preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
            tradeAggressivenessProbability: 0.35,
            valueWeight: 0.9,
          },
          rb_heavy: {
            acceptanceThreshold: 0.95,
            needModifier: 0.25,
            preferredPositionValueFloors: { QB: 2000, RB: 3500, WR: 2000, TE: 2000 },
            tradeAggressivenessProbability: 0.2,
            valueWeight: 0.7,
          },
          qb_early: {
            acceptanceThreshold: 0.95,
            needModifier: 0.25,
            preferredPositionValueFloors: { QB: 4000, RB: 2000, WR: 2000, TE: 2000 },
            tradeAggressivenessProbability: 0.2,
            valueWeight: 0.5,
          },
          bpa: {
            acceptanceThreshold: 1.05,
            needModifier: 0.05,
            preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
            tradeAggressivenessProbability: 0.1,
            valueWeight: 1,
          },
          balanced: {
            acceptanceThreshold: 1,
            needModifier: 0.25,
            preferredPositionValueFloors: { QB: 2500, RB: 2500, WR: 2500, TE: 2500 },
            tradeAggressivenessProbability: 0.15,
            valueWeight: 0.8,
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
