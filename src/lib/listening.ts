import { dateKey } from "./calendar";
import type { Track } from "./types";

export interface ListeningPlay {
  track: Track;
  playedAt: string;
}

export interface SuggestionsResponse {
  status: "ready" | "connect" | "unavailable";
  tracks: { track: Track; plays: number }[];
  totalPlays: number;
  lastSyncedAt: string | null;
  message?: string;
}

/** Local Monday midnight through the following Monday, including DST changes. */
export function listeningWeek(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("Invalid calendar day.");
  const [year, month, date] = day.split("-").map(Number);
  const selected = new Date(year, month - 1, date, 12);
  if (dateKey(selected) !== day) throw new Error("Invalid calendar day.");
  const from = new Date(selected);
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  const end = new Date(to);
  end.setDate(end.getDate() - 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    startDay: dateKey(from),
    endDay: dateKey(end),
  };
}

function exactISO(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function listeningBounds(
  value: unknown,
): { from: string; to: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { from, to } = value as Record<string, unknown>;
  if (!exactISO(from) || !exactISO(to)) return null;
  const hours = (Date.parse(to) - Date.parse(from)) / 3_600_000;
  // Calendar supports 1900–2199. Allow a week crossing either edge and DST.
  if (from < "1899-12-20" || to > "2200-01-10" || hours < 166 || hours > 170)
    return null;
  return { from, to };
}

/** A repeated API page never counts as an additional listen. */
export function uniqueListeningPlays(plays: ListeningPlay[]): ListeningPlay[] {
  const unique = new Map<string, ListeningPlay>();
  for (const play of plays) {
    const time = Date.parse(play.playedAt);
    if (!Number.isFinite(time)) continue;
    const playedAt = new Date(time).toISOString();
    unique.set(`${play.track.id}:${playedAt}`, { ...play, playedAt });
  }
  return [...unique.values()];
}

export function rankWeeklyPlays(
  plays: ListeningPlay[],
  from: string,
  to: string,
) {
  const ranked = new Map<
    string,
    { track: Track; plays: number; latest: number }
  >();
  let totalPlays = 0;
  const start = Date.parse(from);
  const end = Date.parse(to);
  for (const play of uniqueListeningPlays(plays)) {
    const time = Date.parse(play.playedAt);
    if (time < start || time >= end) continue;
    totalPlays++;
    const current = ranked.get(play.track.id);
    if (current) {
      current.plays++;
      if (time > current.latest) {
        current.latest = time;
        current.track = play.track;
      }
    } else
      ranked.set(play.track.id, { track: play.track, plays: 1, latest: time });
  }
  return {
    tracks: [...ranked.values()]
      .sort(
        (a, b) =>
          b.plays - a.plays ||
          b.latest - a.latest ||
          a.track.id.localeCompare(b.track.id),
      )
      .slice(0, 6)
      .map(({ track, plays }) => ({ track, plays })),
    totalPlays,
  };
}
