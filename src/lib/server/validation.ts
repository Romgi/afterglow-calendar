import type { Memory, Track } from "../types";
import { ApiError } from "./http";

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const MAX_TRACK_MS = 24 * 60 * 60 * 1000;

function fail(message: string): never {
  throw new ApiError(400, message, "invalid_input");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Expected a valid object.");
  return value as Record<string, unknown>;
}
function string(
  value: unknown,
  name: string,
  max: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    fail(`${name} is invalid.`);
  return value;
}
function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(`${name} is invalid.`);
  return value;
}

export function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  if (value < "1900-01-01" || value > "2199-12-31") return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function isSpotifyArtwork(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      [
        "i.scdn.co",
        "image-cdn-ak.spotifycdn.com",
        "image-cdn-fa.spotifycdn.com",
      ].includes(url.hostname) &&
      url.pathname.startsWith("/image/") &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

export function validateTrack(value: unknown): Track {
  const t = object(value);
  const id = string(t.id, "Spotify track ID", 22);
  if (!SPOTIFY_ID.test(id) || t.uri !== `spotify:track:${id}`)
    fail("Choose a Spotify track.");
  const artwork = string(t.artwork, "Album artwork", 1000, true);
  if (!isSpotifyArtwork(artwork)) fail("Album artwork must come from Spotify.");
  const url = `https://open.spotify.com/track/${id}`;
  if (t.url !== url) fail("The Spotify track link is invalid.");
  return {
    id,
    uri: `spotify:track:${id}`,
    url,
    artwork,
    title: string(t.title, "Song title", 500),
    artist: string(t.artist, "Artist", 1000),
    album: string(t.album, "Album", 500, true),
    durationMs: integer(t.durationMs, "Song length", 1, MAX_TRACK_MS),
  };
}

export function validateMemories(value: unknown): {
  memories: Memory[];
  revision: number;
} {
  const body = object(value);
  const revision = integer(
    body.revision,
    "Calendar revision",
    0,
    2_147_483_646,
  );
  if (!Array.isArray(body.memories) || body.memories.length > 2000)
    fail("A calendar can contain up to 2,000 songs.");
  const ids = new Set<string>();
  const memories = body.memories
    .map((raw): Memory => {
      const m = object(raw);
      const id = string(m.id, "Memory ID", 100);
      if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id))
        fail("Memory IDs must be unique.");
      ids.add(id);
      if (!validDay(m.start) || !validDay(m.end) || m.end < m.start)
        fail("Choose a valid start and end date.");
      const track = validateTrack(m.track);
      const clipStartMs = integer(
        m.clipStartMs,
        "Clip start",
        0,
        track.durationMs - 1,
      );
      const clipEndMs = integer(
        m.clipEndMs,
        "Clip end",
        clipStartMs + 1,
        track.durationMs,
      );
      const color = string(m.color, "Album color", 7);
      if (!/^#[a-fA-F0-9]{6}$/.test(color)) fail("Choose a valid album color.");
      return {
        id,
        track,
        start: m.start,
        end: m.end,
        clipStartMs,
        clipEndMs,
        color,
        note: string(m.note, "Note", 2000, true),
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < memories.length; i++) {
    if (memories[i].start <= memories[i - 1].end)
      fail("Songs cannot overlap. Adjust the dates and try again.");
  }
  return { memories, revision };
}

export function validatePlay(value: unknown) {
  const body = object(value);
  const deviceId = string(body.deviceId, "Playback device", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(deviceId))
    fail("The playback device is invalid.");
  const uri = string(body.uri, "Song", 50);
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri))
    fail("Choose a Spotify track.");
  return {
    deviceId,
    uri,
    positionMs: integer(body.positionMs, "Playback position", 0, MAX_TRACK_MS),
  };
}
