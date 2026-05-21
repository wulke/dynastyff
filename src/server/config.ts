// @spec DFF-ENGINE-003
import { scoringFormats } from '../db/schema.js';

type RawDraftRequestBody = {
  configName?: unknown;
  teamCount?: unknown;
  rounds?: unknown;
  scoringFormat?: unknown;
  rosterSlots?: unknown;
  pickPosition?: unknown;
  futurePickYears?: unknown;
};

type RawPickSubmissionRequestBody = {
  playerId?: unknown;
};

type DraftRequestRosterSlots = {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SF: number;
  BN: number;
};

export type CreateDraftConfig = {
  teamCount: number;
  rounds: number;
  scoringFormat: (typeof scoringFormats)[number];
  userPickPosition: number;
  futurePickYears: number;
  futurePickRounds: number;
  rosterConfig: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    SF: number;
    bench: number;
  };
};

export class DraftConfigValidationError extends Error {}
export class PickSubmissionValidationError extends Error {}

export function parseCreateDraftConfig(input: unknown): CreateDraftConfig {
  if (!isRecord(input)) {
    throw new DraftConfigValidationError('Invalid draft config: request body must be a JSON object.');
  }

  const body = input as RawDraftRequestBody;

  if (body.configName !== undefined && typeof body.configName !== 'string') {
    throw new DraftConfigValidationError('Invalid draft config: configName must be a string.');
  }

  const teamCount = requireIntegerInRange(body.teamCount, 'teamCount', 8, 16);
  const rounds = requireIntegerInRange(body.rounds, 'rounds', 10, 30);
  const scoringFormat = requireScoringFormat(body.scoringFormat);
  const rosterSlots = requireRosterSlots(body.rosterSlots);
  const pickPosition = requireIntegerInRange(body.pickPosition, 'pickPosition', 1, teamCount);
  const futurePickYears = requireIntegerInRange(body.futurePickYears, 'futurePickYears', 1, 5);

  return {
    teamCount,
    rounds,
    scoringFormat,
    userPickPosition: pickPosition,
    futurePickYears,
    futurePickRounds: rounds,
    rosterConfig: {
      QB: rosterSlots.QB,
      RB: rosterSlots.RB,
      WR: rosterSlots.WR,
      TE: rosterSlots.TE,
      FLEX: rosterSlots.FLEX,
      SF: rosterSlots.SF,
      bench: rosterSlots.BN,
    },
  };
}

// @spec DFF-ENGINE-020
// @spec DFF-ENGINE-021
export function parsePickSubmission(input: unknown): { playerId: string } {
  if (!isRecord(input)) {
    throw new PickSubmissionValidationError(
      'Invalid pick submission: request body must be a JSON object.',
    );
  }

  const body = input as RawPickSubmissionRequestBody;

  if (typeof body.playerId !== 'string' || body.playerId.trim() === '') {
    throw new PickSubmissionValidationError('Invalid pick submission: playerId is required.');
  }

  return {
    playerId: body.playerId,
  };
}

function requireScoringFormat(value: unknown): (typeof scoringFormats)[number] {
  if (value === undefined) {
    throw new DraftConfigValidationError('Invalid draft config: scoringFormat is required.');
  }

  if (typeof value !== 'string' || !scoringFormats.includes(value as (typeof scoringFormats)[number])) {
    throw new DraftConfigValidationError(
      `Invalid draft config: scoringFormat must be one of ${scoringFormats.join(', ')}.`,
    );
  }

  return value as (typeof scoringFormats)[number];
}

function requireRosterSlots(value: unknown): DraftRequestRosterSlots {
  if (!isRecord(value)) {
    throw new DraftConfigValidationError('Invalid draft config: rosterSlots is required.');
  }

  return {
    QB: requireNonNegativeInteger(value.QB, 'rosterSlots.QB'),
    RB: requireNonNegativeInteger(value.RB, 'rosterSlots.RB'),
    WR: requireNonNegativeInteger(value.WR, 'rosterSlots.WR'),
    TE: requireNonNegativeInteger(value.TE, 'rosterSlots.TE'),
    FLEX: requireNonNegativeInteger(value.FLEX, 'rosterSlots.FLEX'),
    SF: requireNonNegativeInteger(value.SF, 'rosterSlots.SF'),
    BN: requireNonNegativeInteger(value.BN, 'rosterSlots.BN'),
  };
}

function requireIntegerInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): number {
  if (value === undefined) {
    throw new DraftConfigValidationError(`Invalid draft config: ${fieldName} is required.`);
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new DraftConfigValidationError(
      `Invalid draft config: ${fieldName} must be an integer between ${min} and ${max}.`,
    );
  }

  return value;
}

function requireNonNegativeInteger(value: unknown, fieldName: string): number {
  if (value === undefined) {
    throw new DraftConfigValidationError(`Invalid draft config: ${fieldName} is required.`);
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DraftConfigValidationError(
      `Invalid draft config: ${fieldName} must be a non-negative integer.`,
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
