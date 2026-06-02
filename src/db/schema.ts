// @spec DFF-DATA-001
// @spec DFF-DATA-002
// @spec DFF-DATA-010
// @spec DFF-DATA-020
// @spec DFF-DATA-021
// @spec DFF-DATA-022
// @spec DFF-DATA-030
// @spec DFF-DATA-033
// @spec DFF-DATA-040
// @spec DFF-DATA-050
// @spec DFF-DATA-060
// @spec DFF-DATA-070
// @spec DFF-DATA-080
// @spec DFF-DATA-081
// @spec DFF-DATA-090
// @spec DFF-HIST-001
// @spec DFF-HIST-010
// @spec DFF-HIST-011
// @spec DFF-HIST-012
// @spec DFF-HIST-020
// @spec DFF-HIST-021
// @spec DFF-HIST-022
// @spec DFF-HIST-030
import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const playerPositions = ['QB', 'RB', 'WR', 'TE'] as const;
export const draftStatuses = ['in_progress', 'completed'] as const;
export const scoringFormats = ['ppr', 'half_ppr', 'standard'] as const;
export const teamArchetypes = [
  'win_now',
  'punt',
  'rb_heavy',
  'qb_early',
  'bpa',
  'balanced',
] as const;
export const tradeStatuses = ['accepted', 'declined', 'force_declined'] as const;
export const etlSources = ['ktc', 'fantasycalc', 'dynastydaddy', 'rosteraudit'] as const;

const quotedList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    position: text('position').notNull(),
    nflTeam: text('nfl_team'),
    age: real('age'),
    isRookie: integer('is_rookie', { mode: 'boolean' }).notNull().default(false),
    dynastyValue: integer('dynasty_value').notNull(),
    valueKtc: integer('value_ktc'),
    valueFantasycalc: integer('value_fantasycalc'),
    valueDynastydaddy: integer('value_dynastydaddy'),
    valueRosteraudit: integer('value_rosteraudit'),
    adp: real('adp'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('players_name_position_unique').on(table.name, table.position),
    index('players_position_idx').on(table.position),
    check(
      'players_position_check',
      sql`${table.position} in (${sql.raw(quotedList(playerPositions))})`,
    ),
  ],
);

// @spec DFF-SPKV-043
export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
    status: text('status').notNull(),
    teamCount: integer('team_count').notNull().default(12),
    rounds: integer('rounds').notNull().default(20),
    scoringFormat: text('scoring_format').notNull().default('ppr'),
    userPickPosition: integer('user_pick_position').notNull(),
    futurePickYears: integer('future_pick_years').notNull().default(3),
    futurePickRounds: integer('future_pick_rounds').notNull(),
    rosterConfig: text('roster_config').notNull(),
    etlRunId: text('etl_run_id').references(() => etlRuns.id, { onDelete: 'set null' }),
    startupPickValues: text('startup_pick_values').notNull().default('[]'),
  },
  (table) => [
    index('drafts_etl_run_id_idx').on(table.etlRunId),
    check(
      'drafts_status_check',
      sql`${table.status} in (${sql.raw(quotedList(draftStatuses))})`,
    ),
    check(
      'drafts_scoring_format_check',
      sql`${table.scoringFormat} in (${sql.raw(quotedList(scoringFormats))})`,
    ),
  ],
);

export const etlRuns = sqliteTable('etl_runs', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  sourcesAttempted: text('sources_attempted').notNull(),
  sourcesSucceeded: text('sources_succeeded').notNull(),
});

export const playerValueSnapshots = sqliteTable(
  'player_value_snapshots',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => etlRuns.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    source: text('source').notNull(),
    rawValue: integer('raw_value').notNull(),
  },
  (table) => [
    uniqueIndex('player_value_snapshots_run_player_source_unique').on(
      table.runId,
      table.playerId,
      table.source,
    ),
    index('player_value_snapshots_run_id_idx').on(table.runId),
    index('player_value_snapshots_player_id_idx').on(table.playerId),
    check(
      'player_value_snapshots_source_check',
      sql`${table.source} in (${sql.raw(quotedList(etlSources))})`,
    ),
  ],
);

// @spec DFF-SPKV-002
// @spec DFF-SPKV-004
export const pickValueSnapshots = sqliteTable(
  'pick_value_snapshots',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => etlRuns.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    round: integer('round').notNull(),
    pickInRound: integer('pick_in_round').notNull().default(0),
    source: text('source').notNull(),
    rawValue: integer('raw_value').notNull(),
  },
  (table) => [
    uniqueIndex('pick_value_snapshots_run_year_round_pick_in_round_source_unique').on(
      table.runId,
      table.year,
      table.round,
      table.pickInRound,
      table.source,
    ),
    index('pick_value_snapshots_run_id_idx').on(table.runId),
    check(
      'pick_value_snapshots_source_check',
      sql`${table.source} in (${sql.raw(quotedList(etlSources))})`,
    ),
  ],
);

export const teams = sqliteTable(
  'teams',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isUser: integer('is_user', { mode: 'boolean' }).notNull().default(false),
    pickPosition: integer('pick_position').notNull(),
    archetype: text('archetype'),
  },
  (table) => [
    index('teams_draft_id_idx').on(table.draftId),
    check(
      'teams_archetype_check',
      sql`${table.archetype} is null or ${table.archetype} in (${sql.raw(quotedList(teamArchetypes))})`,
    ),
  ],
);

export const draftOrder = sqliteTable(
  'draft_order',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    pickNumber: integer('pick_number').notNull(),
    round: integer('round').notNull(),
    pickInRound: integer('pick_in_round').notNull(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('draft_order_draft_pick_number_unique').on(table.draftId, table.pickNumber),
    uniqueIndex('draft_order_draft_round_pick_in_round_unique').on(
      table.draftId,
      table.round,
      table.pickInRound,
    ),
    index('draft_order_team_id_idx').on(table.teamId),
  ],
);

export const picks = sqliteTable(
  'picks',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    draftOrderId: text('draft_order_id')
      .notNull()
      .references(() => draftOrder.id, { onDelete: 'restrict' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    pickNumber: integer('pick_number').notNull(),
    round: integer('round').notNull(),
    pickedAt: text('picked_at').notNull(),
  },
  (table) => [
    uniqueIndex('picks_draft_order_id_unique').on(table.draftOrderId),
    uniqueIndex('picks_draft_player_unique').on(table.draftId, table.playerId),
    index('picks_draft_id_idx').on(table.draftId),
    index('picks_team_id_idx').on(table.teamId),
  ],
);

export const rosterPlayers = sqliteTable(
  'roster_players',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
  },
  (table) => [
    uniqueIndex('roster_players_draft_player_unique').on(table.draftId, table.playerId),
    index('roster_players_team_id_idx').on(table.teamId),
  ],
);

export const teamPickAssets = sqliteTable(
  'team_pick_assets',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    year: integer('year').notNull(),
    round: integer('round').notNull(),
  },
  (table) => [
    index('team_pick_assets_team_id_idx').on(table.teamId),
  ],
);

// @spec DFF-SPKV-001
// @spec DFF-SPKV-002
// @spec DFF-SPKV-003
export const pickValues = sqliteTable(
  'pick_values',
  {
    id: text('id').primaryKey(),
    year: integer('year').notNull(),
    round: integer('round').notNull(),
    pickInRound: integer('pick_in_round').notNull().default(0),
    dynastyValue: integer('dynasty_value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('pick_values_year_round_pick_in_round_unique').on(
      table.year,
      table.round,
      table.pickInRound,
    ),
  ],
);

export const trades = sqliteTable(
  'trades',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    pickNumber: integer('pick_number').notNull(),
    round: integer('round').notNull(),
    initiatingTeamId: text('initiating_team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    receivingTeamId: text('receiving_team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    assetsSent: text('assets_sent').notNull(),
    assetsReceived: text('assets_received').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('trades_draft_id_idx').on(table.draftId),
    check(
      'trades_status_check',
      sql`${table.status} in (${sql.raw(quotedList(tradeStatuses))})`,
    ),
  ],
);

export const userQueue = sqliteTable(
  'user_queue',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    rank: integer('rank').notNull(),
  },
  (table) => [
    uniqueIndex('user_queue_draft_player_unique').on(table.draftId, table.playerId),
    uniqueIndex('user_queue_draft_rank_unique').on(table.draftId, table.rank),
  ],
);

export const draftsRelations = relations(drafts, ({ one, many }) => ({
  teams: many(teams),
  draftOrder: many(draftOrder),
  picks: many(picks),
  rosterPlayers: many(rosterPlayers),
  teamPickAssets: many(teamPickAssets),
  trades: many(trades),
  userQueue: many(userQueue),
  etlRun: one(etlRuns, {
    fields: [drafts.etlRunId],
    references: [etlRuns.id],
  }),
}));

export const etlRunsRelations = relations(etlRuns, ({ many }) => ({
  drafts: many(drafts),
  playerValueSnapshots: many(playerValueSnapshots),
  pickValueSnapshots: many(pickValueSnapshots),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  draft: one(drafts, {
    fields: [teams.draftId],
    references: [drafts.id],
  }),
  draftOrder: many(draftOrder),
  picks: many(picks),
  rosterPlayers: many(rosterPlayers),
  teamPickAssets: many(teamPickAssets),
}));

export const playerValueSnapshotsRelations = relations(playerValueSnapshots, ({ one }) => ({
  run: one(etlRuns, {
    fields: [playerValueSnapshots.runId],
    references: [etlRuns.id],
  }),
  player: one(players, {
    fields: [playerValueSnapshots.playerId],
    references: [players.id],
  }),
}));

export const pickValueSnapshotsRelations = relations(pickValueSnapshots, ({ one }) => ({
  run: one(etlRuns, {
    fields: [pickValueSnapshots.runId],
    references: [etlRuns.id],
  }),
}));
