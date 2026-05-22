DROP INDEX `pick_value_snapshots_run_year_round_source_unique`;--> statement-breakpoint
ALTER TABLE `pick_value_snapshots` ADD `pick_in_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pick_value_snapshots_run_year_round_pick_in_round_source_unique` ON `pick_value_snapshots` (`run_id`,`year`,`round`,`pick_in_round`,`source`);--> statement-breakpoint
DROP INDEX `pick_values_year_round_unique`;--> statement-breakpoint
ALTER TABLE `pick_values` ADD `pick_in_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pick_values_year_round_pick_in_round_unique` ON `pick_values` (`year`,`round`,`pick_in_round`);