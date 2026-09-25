CREATE TABLE "game_players" (
	"game_id" uuid NOT NULL,
	"player_id" uuid,
	"name" text NOT NULL,
	"team" integer NOT NULL,
	"placed" integer NOT NULL,
	"points" integer NOT NULL,
	"attempts" integer NOT NULL,
	"misses" integer NOT NULL,
	"precision" real NOT NULL,
	"best_streak" integer NOT NULL,
	"rank" integer NOT NULL,
	"won" boolean NOT NULL,
	CONSTRAINT "game_players_game_id_name_pk" PRIMARY KEY("game_id","name")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"puzzle_id" text NOT NULL,
	"mode" text NOT NULL,
	"party" text NOT NULL,
	"player_count" integer NOT NULL,
	"completed" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"total_pieces" integer NOT NULL,
	"placed_pieces" integer NOT NULL,
	"precision" real NOT NULL,
	"team_key" text NOT NULL,
	"team_names" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_players_player_idx" ON "game_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "games_board_idx" ON "games" USING btree ("puzzle_id","mode","party","completed");--> statement-breakpoint
CREATE INDEX "games_finished_idx" ON "games" USING btree ("finished_at");