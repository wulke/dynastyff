// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-040
import fs from 'node:fs';
import path from 'node:path';

import { playerPositions, teamArchetypes } from '../db/schema.js';

type TeamArchetype = (typeof teamArchetypes)[number];
type PlayerPosition = (typeof playerPositions)[number];
type ReadFile = (path: string, encoding: BufferEncoding) => string;

export type ArchetypeProfileConfig = {
  acceptanceThreshold: number;
  preferredPositionValueFloors: Record<PlayerPosition, number>;
  tradeAggressivenessProbability: number;
};

export type ArchetypeConfig = {
  randomness: number;
  archetypes: Record<TeamArchetype, ArchetypeProfileConfig>;
};

type LoadArchetypeConfigOptions = {
  configPath?: string;
  readFile?: ReadFile;
};

export const defaultArchetypesConfigPath = path.resolve(process.cwd(), 'config', 'archetypes.json');

// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-004
// @spec DFF-BOT-040
export function loadArchetypeConfigFile({
  configPath = defaultArchetypesConfigPath,
  readFile = fs.readFileSync,
}: LoadArchetypeConfigOptions = {}): ArchetypeConfig {
  const rawConfig = readFile(configPath, 'utf8');
  return parseArchetypeConfig(rawConfig, configPath);
}

// @spec DFF-BOT-001
// @spec DFF-BOT-004
export function createArchetypeConfigLoader(
  options: LoadArchetypeConfigOptions = {},
): () => ArchetypeConfig {
  let cachedConfig: ArchetypeConfig | undefined;

  return () => {
    cachedConfig ??= loadArchetypeConfigFile(options);
    return cachedConfig;
  };
}

export const loadStartupArchetypeConfig = createArchetypeConfigLoader();

// @spec DFF-BOT-001
// @spec DFF-BOT-002
export function getAcceptanceThresholdForArchetype(
  archetypeConfig: ArchetypeConfig,
  archetype: string | null | undefined,
): number {
  if (!archetype || !isTeamArchetype(archetype)) {
    return archetypeConfig.archetypes.balanced.acceptanceThreshold;
  }

  return archetypeConfig.archetypes[archetype].acceptanceThreshold;
}

// @spec DFF-BOT-001
// @spec DFF-BOT-002
// @spec DFF-BOT-003
// @spec DFF-BOT-004
// @spec DFF-BOT-040
function parseArchetypeConfig(rawConfig: string, configPath: string): ArchetypeConfig {
  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(
      `[draft] Failed to parse archetype config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsedConfig) || !isRecord(parsedConfig.archetypes)) {
    throw new Error(`[draft] Invalid archetype config at ${configPath}: missing archetypes object.`);
  }

  const archetypes = {} as ArchetypeConfig['archetypes'];

  for (const archetype of teamArchetypes) {
    const candidate = parsedConfig.archetypes[archetype];

    if (!isRecord(candidate)) {
      throw new Error(`[draft] Invalid archetype config at ${configPath}: missing ${archetype} profile.`);
    }

    archetypes[archetype] = {
      acceptanceThreshold: readNumber(candidate.acceptanceThreshold, configPath, `${archetype}.acceptanceThreshold`),
      preferredPositionValueFloors: readPositionFloors(
        candidate.preferredPositionValueFloors,
        configPath,
        `${archetype}.preferredPositionValueFloors`,
      ),
      tradeAggressivenessProbability: readNumber(
        candidate.tradeAggressivenessProbability,
        configPath,
        `${archetype}.tradeAggressivenessProbability`,
      ),
    };
  }

  return {
    randomness: readUnitIntervalNumber(parsedConfig.randomness, configPath, 'randomness'),
    archetypes,
  };
}

// @spec DFF-BOT-003
function readPositionFloors(
  value: unknown,
  configPath: string,
  fieldPath: string,
): Record<PlayerPosition, number> {
  if (!isRecord(value)) {
    throw new Error(`[draft] Invalid archetype config at ${configPath}: ${fieldPath} must be an object.`);
  }

  const floors = {} as Record<PlayerPosition, number>;

  for (const position of playerPositions) {
    floors[position] = readNumber(value[position], configPath, `${fieldPath}.${position}`);
  }

  return floors;
}

// @spec DFF-BOT-001
function readNumber(value: unknown, configPath: string, fieldPath: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`[draft] Invalid archetype config at ${configPath}: ${fieldPath} must be a number.`);
  }

  return value;
}

// @spec DFF-BOT-004
function readUnitIntervalNumber(value: unknown, configPath: string, fieldPath: string): number {
  const parsedValue = readNumber(value, configPath, fieldPath);

  if (parsedValue < 0 || parsedValue > 1) {
    throw new Error(`[draft] Invalid archetype config at ${configPath}: ${fieldPath} must be between 0.0 and 1.0.`);
  }

  return parsedValue;
}

// @spec DFF-BOT-001
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// @spec DFF-BOT-001
function hasOwn<TObject extends object, TKey extends PropertyKey>(
  value: TObject,
  key: TKey,
): key is Extract<TKey, keyof TObject> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// @spec DFF-BOT-001
function isTeamArchetype(value: string): value is TeamArchetype {
  return (teamArchetypes as readonly string[]).includes(value);
}
