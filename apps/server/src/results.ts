import { sql, type SQL } from 'drizzle-orm';
import { partyBucket, type GameResults, type LeaderboardKind, type LeaderboardPlacement, type PartyBucket } from '@geolearn/shared/game/types';
import type { PuzzleId } from '@geolearn/shared/puzzles';
import type { DbHandle } from './db/client';
import { gamePlayers, games } from './db/schema';
import { nameKey } from './players';

export type LeaderboardPeriod = 'all' | 'week';

export interface LeaderboardEntry {
  rank: number;
  names: string;
  /** fastest: ms · precision: 0..1 · points: points · alltime: countries placed */
  value: number;
  /** fastest: precision · precision: ms · points: countries · alltime: puzzles completed */
  secondary: number;
  at: string;
}

export interface SavedParticipant {
  /** Player row id (null if the player could not be resolved). */
  playerId: string | null;
  name: string;
}

function periodClause(period: LeaderboardPeriod, column: SQL): SQL {
  return period === 'week' ? sql`${column} > now() - interval '7 days'` : sql`true`;
}

export class ResultsStore {
  constructor(private readonly handle: DbHandle) {}

  /** Stores a finished game and returns where it landed on the leaderboards. */
  async save(roomCode: string, results: GameResults, startedAt: number, participants: SavedParticipant[]): Promise<LeaderboardPlacement[]> {
    const party = partyBucket(results.playerCount);
    const sorted = [...results.players].sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)));
    const teamKey = sorted.map((p) => nameKey(p.name)).join('+');
    const teamNames = sorted.map((p) => p.name).join(' & ');
    const { db } = this.handle;

    const [game] = await db
      .insert(games)
      .values({
        roomCode,
        puzzleId: results.puzzleId,
        mode: results.mode,
        party,
        playerCount: results.playerCount,
        completed: results.completed,
        durationMs: Math.round(results.durationMs),
        totalPieces: results.totalPieces,
        placedPieces: results.placedPieces,
        precision: results.precision,
        teamKey,
        teamNames,
        startedAt: new Date(startedAt),
      })
      .returning({ id: games.id });

    const byName = new Map(participants.map((p) => [p.name, p.playerId]));
    await db.insert(gamePlayers).values(
      results.players.map((p) => ({
        gameId: game.id,
        playerId: byName.get(p.name) ?? null,
        name: p.name,
        team: p.team,
        placed: p.placed,
        points: p.points,
        attempts: p.attempts,
        misses: p.misses,
        precision: p.precision,
        bestStreak: p.bestStreak,
        rank: p.rank,
        won: results.winners.includes(p.id),
      })),
    );

    if (!results.completed) return [];
    return this.placements(results, party, teamKey, game.id);
  }

  private async placements(results: GameResults, party: PartyBucket, teamKey: string, gameId: string): Promise<LeaderboardPlacement[]> {
    const out: LeaderboardPlacement[] = [];
    const puzzle = results.puzzleId;
    if (results.mode === 'coop') {
      const [fast] = await this.handle.rows<{ rank: number; total: number; pb: boolean }>(sql`
        WITH best AS (
          SELECT team_key, MIN(duration_ms) AS best FROM games
          WHERE puzzle_id = ${puzzle} AND mode = 'coop' AND party = ${party} AND completed
          GROUP BY team_key
        ), prev AS (
          SELECT MIN(duration_ms) AS best FROM games
          WHERE puzzle_id = ${puzzle} AND mode = 'coop' AND party = ${party} AND completed
            AND team_key = ${teamKey} AND id <> ${gameId}
        )
        SELECT
          (SELECT COUNT(*) FROM best WHERE best < ${Math.round(results.durationMs)})::int + 1 AS rank,
          (SELECT COUNT(*) FROM best)::int AS total,
          COALESCE((SELECT best FROM prev) > ${Math.round(results.durationMs)}, true) AS pb`);
      out.push({ board: 'fastest', rank: fast.rank, total: fast.total, personalBest: fast.pb });

      const [prec] = await this.handle.rows<{ rank: number; total: number; pb: boolean }>(sql`
        WITH best AS (
          SELECT DISTINCT ON (team_key) team_key, precision, duration_ms FROM games
          WHERE puzzle_id = ${puzzle} AND mode = 'coop' AND party = ${party} AND completed
          ORDER BY team_key, precision DESC, duration_ms ASC
        ), prev AS (
          SELECT MAX(precision) AS best FROM games
          WHERE puzzle_id = ${puzzle} AND mode = 'coop' AND party = ${party} AND completed
            AND team_key = ${teamKey} AND id <> ${gameId}
        )
        SELECT
          (SELECT COUNT(*) FROM best WHERE precision > ${results.precision}
             OR (precision = ${results.precision} AND duration_ms < ${Math.round(results.durationMs)}))::int + 1 AS rank,
          (SELECT COUNT(*) FROM best)::int AS total,
          COALESCE((SELECT best FROM prev) < ${results.precision}, true) AS pb`);
      out.push({ board: 'precision', rank: prec.rank, total: prec.total, personalBest: prec.pb });
    } else {
      const top = [...results.players].sort((a, b) => b.points - a.points)[0];
      if (top) {
        const key = nameKey(top.name);
        const [pts] = await this.handle.rows<{ rank: number; total: number; pb: boolean }>(sql`
          WITH best AS (
            SELECT lower(gp.name) AS who, MAX(gp.points) AS best
            FROM game_players gp JOIN games g ON g.id = gp.game_id
            WHERE g.puzzle_id = ${puzzle} AND g.mode IN ('versus', 'teams') AND g.party = ${party} AND g.completed
            GROUP BY lower(gp.name)
          ), prev AS (
            SELECT MAX(gp.points) AS best FROM game_players gp JOIN games g ON g.id = gp.game_id
            WHERE g.puzzle_id = ${puzzle} AND g.mode IN ('versus', 'teams') AND g.party = ${party} AND g.completed
              AND lower(gp.name) = ${key} AND g.id <> ${gameId}
          )
          SELECT
            (SELECT COUNT(*) FROM best WHERE best > ${top.points})::int + 1 AS rank,
            (SELECT COUNT(*) FROM best)::int AS total,
            COALESCE((SELECT best FROM prev) < ${top.points}, true) AS pb`);
        out.push({ board: 'points', rank: pts.rank, total: pts.total, personalBest: pts.pb });
      }
    }
    return out;
  }

  async leaderboard(
    kind: LeaderboardKind | 'alltime',
    puzzle: PuzzleId,
    party: PartyBucket,
    period: LeaderboardPeriod,
    limit = 50,
  ): Promise<LeaderboardEntry[]> {
    const lim = Math.max(1, Math.min(100, limit));
    let rows: { names: string; value: number; secondary: number; at: Date | string }[];
    if (kind === 'fastest' || kind === 'precision') {
      const order = kind === 'fastest' ? sql`duration_ms ASC, finished_at ASC` : sql`precision DESC, duration_ms ASC`;
      rows = await this.handle.rows(sql`
        SELECT team_names AS names,
               ${kind === 'fastest' ? sql`duration_ms` : sql`precision`} AS value,
               ${kind === 'fastest' ? sql`precision` : sql`duration_ms`} AS secondary,
               finished_at AS at
        FROM (
          SELECT DISTINCT ON (team_key) team_key, team_names, duration_ms, precision, finished_at
          FROM games
          WHERE puzzle_id = ${puzzle} AND mode = 'coop' AND party = ${party} AND completed
            AND ${periodClause(period, sql`finished_at`)}
          ORDER BY team_key, ${order}
        ) best
        ORDER BY ${order}
        LIMIT ${lim}`);
    } else if (kind === 'points') {
      rows = await this.handle.rows(sql`
        SELECT names, value, secondary, at FROM (
          SELECT DISTINCT ON (lower(gp.name)) gp.name AS names, gp.points AS value, gp.placed AS secondary, g.finished_at AS at
          FROM game_players gp JOIN games g ON g.id = gp.game_id
          WHERE g.puzzle_id = ${puzzle} AND g.mode IN ('versus', 'teams') AND g.party = ${party} AND g.completed
            AND ${periodClause(period, sql`g.finished_at`)}
          ORDER BY lower(gp.name), gp.points DESC, g.finished_at ASC
        ) best
        ORDER BY value DESC, at ASC
        LIMIT ${lim}`);
    } else {
      rows = await this.handle.rows(sql`
        SELECT MAX(gp.name) AS names,
               SUM(gp.placed)::int AS value,
               (COUNT(*) FILTER (WHERE g.completed))::int AS secondary,
               MAX(g.finished_at) AS at
        FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE ${periodClause(period, sql`g.finished_at`)}
        GROUP BY lower(gp.name)
        ORDER BY value DESC, secondary DESC
        LIMIT ${lim}`);
    }
    return rows.map((r, i) => ({
      rank: i + 1,
      names: r.names,
      value: Number(r.value),
      secondary: Number(r.secondary),
      at: new Date(r.at).toISOString(),
    }));
  }

  async totals(): Promise<{ games: number; countries: number }> {
    const [row] = await this.handle.rows<{ games: number; countries: number }>(sql`
      SELECT (SELECT COUNT(*) FROM games)::int AS games,
             (SELECT COALESCE(SUM(placed), 0) FROM game_players)::int AS countries`);
    return { games: Number(row?.games ?? 0), countries: Number(row?.countries ?? 0) };
  }
}
