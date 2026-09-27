import test from "node:test";
import assert from "node:assert/strict";
import {
  listeningBounds,
  listeningWeek,
  rankWeeklyPlays,
  uniqueListeningPlays,
} from "../src/lib/listening";
import { normalizeRecentPlays } from "../src/lib/server/listening-history";
import { grantedSpotifyScopes, spotifyError } from "../src/lib/server/spotify";
import type { Track } from "../src/lib/types";

function track(id: string): Track {
  const spotifyId = id.padStart(22, "0");
  return {
    id: spotifyId,
    uri: `spotify:track:${spotifyId}`,
    title: `Song ${id}`,
    artist: "Artist",
    album: "Album",
    durationMs: 180_000,
    artwork: "",
    url: `https://open.spotify.com/track/${spotifyId}`,
  };
}

test("local weeks use Monday through Sunday across year boundaries and DST", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Toronto";
  try {
    assert.deepEqual(listeningWeek("2027-01-01"), {
      from: "2026-12-28T05:00:00.000Z",
      to: "2027-01-04T05:00:00.000Z",
      startDay: "2026-12-28",
      endDay: "2027-01-03",
    });
    const spring = listeningWeek("2026-03-08");
    assert.equal(spring.from, "2026-03-02T05:00:00.000Z");
    assert.equal(spring.to, "2026-03-09T04:00:00.000Z");
    assert.equal(
      Date.parse(spring.to) - Date.parse(spring.from),
      167 * 3_600_000,
    );
    const autumn = listeningWeek("2026-11-01");
    assert.equal(
      Date.parse(autumn.to) - Date.parse(autumn.from),
      169 * 3_600_000,
    );
    assert.equal(listeningWeek("2026-03-09").startDay, "2026-03-09");
    assert.throws(() => listeningWeek("2026-02-30"));
    assert.throws(() => listeningWeek("garbage"));
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("bounds accept canonical UTC weeks and reject oversized, inverted, malformed or normalized invalid dates", () => {
  const from = "2026-09-21T04:00:00.000Z";
  const to = "2026-09-28T04:00:00.000Z";
  assert.deepEqual(listeningBounds({ from, to }), { from, to });
  assert.ok(
    listeningBounds({
      from: "2026-03-02T05:00:00.000Z",
      to: "2026-03-09T04:00:00.000Z",
    }),
  );
  for (const bad of [
    null,
    [],
    { from: to, to: from },
    { from, to: "2026-10-28T04:00:00.000Z" },
    { from: "2026-02-30T00:00:00.000Z", to: "2026-03-09T00:00:00.000Z" },
    { from: "2026-09-21", to },
    { from: "2026-09-21T00:00:00-04:00", to },
    { from: "1800-01-01T00:00:00.000Z", to: "1800-01-08T00:00:00.000Z" },
  ]) {
    assert.equal(listeningBounds(bad), null);
  }
});

test("repeated pages deduplicate song and timestamp while genuine repeat plays remain", () => {
  const a = { track: track("a"), playedAt: "2026-09-21T12:00:00.000Z" };
  const b = { track: track("a"), playedAt: "2026-09-21T12:03:00.000Z" };
  const c = { track: track("b"), playedAt: a.playedAt };
  assert.equal(
    uniqueListeningPlays([
      a,
      a,
      b,
      c,
      { ...a, playedAt: "2026-09-21T08:00:00-04:00" },
    ]).length,
    3,
  );
});

test("weekly ranking uses exclusive end, counts all songs and sorts ties by latest listen", () => {
  const from = "2026-09-21T04:00:00.000Z";
  const to = "2026-09-28T04:00:00.000Z";
  const plays = Array.from({ length: 8 }, (_, i) => ({
    track: track(String(i)),
    playedAt: `2026-09-22T12:0${i}:00.000Z`,
  }));
  plays.push({ track: track("0"), playedAt: from });
  plays.push({ track: track("excluded"), playedAt: to });
  plays.push({
    track: track("excluded"),
    playedAt: "2026-09-21T03:59:59.999Z",
  });
  plays.push(plays[0]);
  const ranked = rankWeeklyPlays(plays, from, to);
  assert.equal(ranked.totalPlays, 9);
  assert.equal(ranked.tracks.length, 6);
  assert.equal(ranked.tracks[0].track.id, track("0").id);
  assert.equal(ranked.tracks[0].plays, 2);
  assert.equal(ranked.tracks[1].track.id, track("7").id);
  assert.deepEqual(
    rankWeeklyPlays(
      plays,
      "2027-01-01T00:00:00.000Z",
      "2027-01-08T00:00:00.000Z",
    ),
    { tracks: [], totalPlays: 0 },
  );
});

test("Spotify play normalization omits malformed, local and future records", () => {
  const rawTrack = {
    id: track("a").id,
    name: "Song",
    duration_ms: 100_000,
    artists: [{ name: "Artist" }],
  };
  const good = { track: rawTrack, played_at: "2026-09-21T12:00:00Z" };
  const result = normalizeRecentPlays(
    [
      good,
      good,
      null,
      { ...good, track: null },
      { ...good, played_at: "invalid" },
      { ...good, track: { ...rawTrack, is_local: true } },
      { ...good, played_at: "2026-09-29T12:00:00Z" },
    ],
    Date.parse("2026-09-28T00:00:00Z"),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].playedAt, "2026-09-21T12:00:00.000Z");
});

test("OAuth refresh preserves granted scopes, never upgrades legacy credentials", () => {
  const previous = ["streaming", "user-read-recently-played"];
  assert.deepEqual(grantedSpotifyScopes(undefined, previous), previous);
  assert.deepEqual(grantedSpotifyScopes(undefined), []);
  assert.deepEqual(
    grantedSpotifyScopes("streaming streaming user-read-recently-played"),
    previous,
  );
  assert.deepEqual(grantedSpotifyScopes("streaming", previous), ["streaming"]);
  assert.deepEqual(grantedSpotifyScopes("", previous), []);
});

test("only actual insufficient-scope errors request reconnection", async () => {
  const missing = await spotifyError(
    Response.json(
      { error: { message: "Insufficient client scope" } },
      { status: 403 },
    ),
  );
  assert.equal(missing.code, "scope_required");
  const forbidden = await spotifyError(
    Response.json(
      { error: { message: "User not registered in developer dashboard" } },
      { status: 403 },
    ),
  );
  assert.equal(forbidden.code, "spotify_forbidden");
});
