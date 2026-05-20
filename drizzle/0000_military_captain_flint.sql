CREATE TABLE `draft_order` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`pick_number` integer NOT NULL,
	`round` integer NOT NULL,
	`pick_in_round` integer NOT NULL,
	`team_id` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_order_draft_pick_number_unique` ON `draft_order` (`draft_id`,`pick_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_order_draft_round_pick_in_round_unique` ON `draft_order` (`draft_id`,`round`,`pick_in_round`);--> statement-breakpoint
CREATE INDEX `draft_order_team_id_idx` ON `draft_order` (`team_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`team_count` integer DEFAULT 12 NOT NULL,
	`rounds` integer DEFAULT 20 NOT NULL,
	`scoring_format` text DEFAULT 'ppr' NOT NULL,
	`user_pick_position` integer NOT NULL,
	`future_pick_years` integer DEFAULT 3 NOT NULL,
	`future_pick_rounds` integer NOT NULL,
	`roster_config` text NOT NULL,
	`etl_run_id` text,
	FOREIGN KEY (`etl_run_id`) REFERENCES `etl_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "drafts_status_check" CHECK("drafts"."status" in ('in_progress', 'completed')),
	CONSTRAINT "drafts_scoring_format_check" CHECK("drafts"."scoring_format" in ('ppr', 'half_ppr', 'standard'))
);
--> statement-breakpoint
CREATE INDEX `drafts_etl_run_id_idx` ON `drafts` (`etl_run_id`);--> statement-breakpoint
CREATE TABLE `etl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`sources_attempted` text NOT NULL,
	`sources_succeeded` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pick_value_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`year` integer NOT NULL,
	`round` integer NOT NULL,
	`source` text NOT NULL,
	`raw_value` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `etl_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pick_value_snapshots_source_check" CHECK("pick_value_snapshots"."source" in ('ktc', 'fantasycalc', 'dynastydaddy', 'rosteraudit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pick_value_snapshots_run_year_round_source_unique` ON `pick_value_snapshots` (`run_id`,`year`,`round`,`source`);--> statement-breakpoint
CREATE INDEX `pick_value_snapshots_run_id_idx` ON `pick_value_snapshots` (`run_id`);--> statement-breakpoint
CREATE TABLE `pick_values` (
	`id` text PRIMARY KEY NOT NULL,
	`year` integer NOT NULL,
	`round` integer NOT NULL,
	`dynasty_value` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pick_values_year_round_unique` ON `pick_values` (`year`,`round`);--> statement-breakpoint
CREATE TABLE `picks` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`draft_order_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	`pick_number` integer NOT NULL,
	`round` integer NOT NULL,
	`picked_at` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_order_id`) REFERENCES `draft_order`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `picks_draft_order_id_unique` ON `picks` (`draft_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `picks_draft_player_unique` ON `picks` (`draft_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `picks_draft_id_idx` ON `picks` (`draft_id`);--> statement-breakpoint
CREATE INDEX `picks_team_id_idx` ON `picks` (`team_id`);--> statement-breakpoint
CREATE TABLE `player_value_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`player_id` text NOT NULL,
	`source` text NOT NULL,
	`raw_value` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `etl_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "player_value_snapshots_source_check" CHECK("player_value_snapshots"."source" in ('ktc', 'fantasycalc', 'dynastydaddy', 'rosteraudit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_value_snapshots_run_player_source_unique` ON `player_value_snapshots` (`run_id`,`player_id`,`source`);--> statement-breakpoint
CREATE INDEX `player_value_snapshots_run_id_idx` ON `player_value_snapshots` (`run_id`);--> statement-breakpoint
CREATE INDEX `player_value_snapshots_player_id_idx` ON `player_value_snapshots` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`nfl_team` text,
	`age` real,
	`is_rookie` integer DEFAULT false NOT NULL,
	`dynasty_value` integer NOT NULL,
	`value_ktc` integer,
	`value_fantasycalc` integer,
	`value_dynastydaddy` integer,
	`value_rosteraudit` integer,
	`adp` real,
	`updated_at` text NOT NULL,
	CONSTRAINT "players_position_check" CHECK("players"."position" in ('QB', 'RB', 'WR', 'TE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_name_position_unique` ON `players` (`name`,`position`);--> statement-breakpoint
CREATE INDEX `players_position_idx` ON `players` (`position`);--> statement-breakpoint
CREATE TABLE `roster_players` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_players_draft_player_unique` ON `roster_players` (`draft_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `roster_players_team_id_idx` ON `roster_players` (`team_id`);--> statement-breakpoint
CREATE TABLE `team_pick_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`team_id` text NOT NULL,
	`year` integer NOT NULL,
	`round` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_pick_assets_draft_year_round_team_unique` ON `team_pick_assets` (`draft_id`,`team_id`,`year`,`round`);--> statement-breakpoint
CREATE INDEX `team_pick_assets_team_id_idx` ON `team_pick_assets` (`team_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`name` text NOT NULL,
	`is_user` integer DEFAULT false NOT NULL,
	`pick_position` integer NOT NULL,
	`archetype` text,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "teams_archetype_check" CHECK("teams"."archetype" is null or "teams"."archetype" in ('win_now', 'punt', 'rb_heavy', 'qb_early', 'bpa', 'balanced'))
);
--> statement-breakpoint
CREATE INDEX `teams_draft_id_idx` ON `teams` (`draft_id`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`pick_number` integer NOT NULL,
	`round` integer NOT NULL,
	`initiating_team_id` text NOT NULL,
	`receiving_team_id` text NOT NULL,
	`assets_sent` text NOT NULL,
	`assets_received` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiating_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`receiving_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trades_status_check" CHECK("trades"."status" in ('accepted', 'declined', 'force_declined'))
);
--> statement-breakpoint
CREATE INDEX `trades_draft_id_idx` ON `trades` (`draft_id`);--> statement-breakpoint
CREATE TABLE `user_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`player_id` text NOT NULL,
	`rank` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_queue_draft_player_unique` ON `user_queue` (`draft_id`,`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_queue_draft_rank_unique` ON `user_queue` (`draft_id`,`rank`);