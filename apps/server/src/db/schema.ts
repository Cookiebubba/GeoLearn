import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Everyone plays by username; a device token proves a name belongs to you. */
export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Lower-cased, whitespace-normalised name; unique. */
  nameKey: text('name_key').notNull().unique(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One finished (or abandoned) puzzle game. */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomCode: text('room_code').notNull(),
    puzzleId: text('puzzle_id').notNull(),
    /** coop | versus | teams */
    mode: text('mode').notNull(),
    /** solo | duo | quad — bucket of the number of players who took part. */
    party: text('party').notNull(),
    playerCount: integer('player_count').notNull(),
    completed: boolean('completed').notNull(),
    durationMs: integer('duration_ms').notNull(),
    totalPieces: integer('total_pieces').notNull(),
    placedPieces: integer('placed_pieces').notNull(),
    precision: real('precision').notNull(),
    /** Sorted name keys joined with "+": identifies a team across games. */
    teamKey: text('team_key').notNull(),
    teamNames: text('team_names').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('games_board_idx').on(t.puzzleId, t.mode, t.party, t.completed),
    index('games_finished_idx').on(t.finishedAt),
  ],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id').references(() => players.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    team: integer('team').notNull(),
    placed: integer('placed').notNull(),
    points: integer('points').notNull(),
    attempts: integer('attempts').notNull(),
    misses: integer('misses').notNull(),
    precision: real('precision').notNull(),
    bestStreak: integer('best_streak').notNull(),
    rank: integer('rank').notNull(),
    won: boolean('won').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.name] }), index('game_players_player_idx').on(t.playerId)],
);
