import {
  rankWeeklyPlays,
  uniqueListeningPlays,
  type ListeningPlay,
  type SuggestionsResponse,
} from "../listening";
import { database } from "./db";
import { ApiError } from "./http";
import {
  LISTENING_SCOPE,
  mapTrack,
  requireSpotifyScope,
  spotifyFetch,
} from "./spotify";
import { validateTrack } from "./validation";

export function normalizeRecentPlays(
  items: unknown,
  now = Date.now(),
): ListeningPlay[] {
  if (!Array.isArray(items)) return [];
  const plays: ListeningPlay[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.played_at !== "string")
      continue;
    const time = Date.parse(item.played_at);
    if (!Number.isFinite(time) || time < 0 || time > now) continue;
    try {
      const mapped = mapTrack(item.track);
      if (mapped)
        plays.push({
          track: validateTrack(mapped),
          playedAt: new Date(time).toISOString(),
        });
    } catch {
      // Missing, local, or unavailable tracks cannot be added to this calendar.
    }
  }
  return uniqueListeningPlays(plays);
}

function connectionNeeded(code?: string) {
  return code === "scope_required" || code === "reauth_required";
}

async function syncRecentPlays(userId: string) {
  await requireSpotifyScope(userId, LISTENING_SCOPE);
  const sql = await database();
  // Atomic, per-account throttle also prevents parallel serverless syncs.
  const claimed = await sql`
    INSERT INTO afterglow_listening_sync (user_id, attempted_at) VALUES (${userId}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET attempted_at = NOW(), error_code = NULL
    WHERE afterglow_listening_sync.attempted_at < NOW() - INTERVAL '2 minutes'
    RETURNING user_id
  `;
  if (!claimed.length) {
    // A picker opened beside the background sync must not report an empty
    // history merely because the other request is still importing its first page.
    for (const delay of [
      100, 250, 500, 1000, 2000, 4000, 6000, 8000, 8000, 8000,
    ]) {
      const state =
        await sql`SELECT synced_at, attempted_at, error_code FROM afterglow_listening_sync WHERE user_id = ${userId}`;
      if (
        state[0]?.error_code ||
        (state[0]?.synced_at &&
          new Date(state[0].synced_at as string) >=
            new Date(state[0].attempted_at as string))
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new ApiError(
      503,
      "Your listening history is still syncing.",
      "history_syncing",
    );
  }
  try {
    const previous =
      await sql`SELECT MAX(played_at) AS latest FROM afterglow_listening_plays WHERE user_id = ${userId}`;
    const latest = previous[0]?.latest
      ? new Date(previous[0].latest as string).getTime()
      : 0;
    let before: number | undefined;
    // Spotify exposes recent history, not a complete archive. Keep each request bounded.
    for (let page = 0; page < 3; page++) {
      const query = new URLSearchParams({ limit: "50" });
      if (before !== undefined) query.set("before", String(before));
      const response = await spotifyFetch(
        userId,
        `/me/player/recently-played?${query}`,
        {},
        LISTENING_SCOPE,
      );
      const data = await response.json();
      if (!Array.isArray(data.items))
        throw new ApiError(
          502,
          "Spotify could not load your recent listening.",
          "spotify_unavailable",
        );
      const plays = normalizeRecentPlays(data.items);
      if (plays.length) {
        await sql`
          INSERT INTO afterglow_listening_plays (user_id, track_id, played_at, track)
          SELECT ${userId}, item->'track'->>'id', (item->>'playedAt')::timestamptz, item->'track'
          FROM jsonb_array_elements(${JSON.stringify(plays)}::jsonb) AS item
          ON CONFLICT (user_id, track_id, played_at) DO NOTHING
        `;
      }
      const timestamps = data.items
        .map((item: { played_at?: string }) =>
          Date.parse(item?.played_at || ""),
        )
        .filter(Number.isFinite);
      const oldest = Math.min(...timestamps);
      if (
        data.items.length < 50 ||
        !Number.isFinite(oldest) ||
        oldest <= latest ||
        (before !== undefined && oldest >= before)
      )
        break;
      before = oldest;
    }
    await sql`UPDATE afterglow_listening_sync SET synced_at = NOW(), error_code = NULL WHERE user_id = ${userId}`;
  } catch (error) {
    const code =
      error instanceof ApiError
        ? error.code || "spotify_unavailable"
        : "spotify_unavailable";
    await sql`UPDATE afterglow_listening_sync SET error_code = ${code} WHERE user_id = ${userId}`;
    throw error;
  }
}

export async function weeklySuggestions(
  userId: string,
  from: string,
  to: string,
): Promise<SuggestionsResponse> {
  let failure: string | undefined;
  try {
    // Always collect today's available history, even when browsing an older week.
    await syncRecentPlays(userId);
  } catch (error) {
    failure =
      error instanceof ApiError
        ? error.code || "spotify_unavailable"
        : "spotify_unavailable";
  }
  const sql = await database();
  const [rows, sync] = await Promise.all([
    sql`SELECT track, played_at FROM afterglow_listening_plays WHERE user_id = ${userId} AND played_at >= ${from}::timestamptz AND played_at < ${to}::timestamptz AND played_at <= NOW()`,
    sql`SELECT synced_at, error_code FROM afterglow_listening_sync WHERE user_id = ${userId}`,
  ]);
  const code = failure || (sync[0]?.error_code as string | undefined);
  const status = code
    ? connectionNeeded(code)
      ? "connect"
      : "unavailable"
    : "ready";
  return {
    status,
    ...rankWeeklyPlays(
      rows.map((row) => ({
        track: row.track,
        playedAt: new Date(row.played_at as string).toISOString(),
      })),
      from,
      to,
    ),
    lastSyncedAt: sync[0]?.synced_at
      ? new Date(sync[0].synced_at as string).toISOString()
      : null,
    ...(status === "connect"
      ? {
          message:
            "Reconnect Spotify to include your listening history. Your saved calendar stays here.",
        }
      : {}),
    ...(status === "unavailable"
      ? {
          message:
            code === "history_syncing"
              ? "Your recent listening is still syncing. Try again in a moment."
              : "Spotify history is unavailable right now. Any saved listens are still shown; try again shortly.",
        }
      : {}),
  };
}
