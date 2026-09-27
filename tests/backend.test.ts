import assert from "node:assert/strict";
import { test } from "node:test";
import type { Memory } from "../src/lib/types";
import { assertOrigin, readJson } from "../src/lib/server/http";
import { challenge, seal, unseal } from "../src/lib/server/crypto";
import {
  isSpotifyArtwork,
  validateMemories,
  validatePlay,
  validDay,
} from "../src/lib/server/validation";

const trackId = "4iV5W9uYEdYUVa79Axb7Rh";
function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "memory_1",
    start: "2026-09-01",
    end: "2026-09-07",
    clipStartMs: 15000,
    clipEndMs: 45000,
    color: "#B06943",
    note: "A week by the coast",
    track: {
      id: trackId,
      uri: `spotify:track:${trackId}`,
      title: "A song",
      artist: "An artist",
      album: "An album",
      artwork: "https://i.scdn.co/image/abc",
      durationMs: 180000,
      url: `https://open.spotify.com/track/${trackId}`,
    },
    ...overrides,
  };
}

test("calendar validation accepts leap day and rejects normalized invalid dates", () => {
  assert.equal(validDay("2024-02-29"), true);
  for (const value of [
    "2025-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-1-01",
    "2026-09-01T00:00:00Z",
    "1899-12-31",
  ]) {
    assert.equal(validDay(value), false, value);
  }
});

test("calendar validation allows adjacent inclusive ranges and sorts them", () => {
  const first = memory();
  const second = memory({
    id: "memory_2",
    start: "2026-09-08",
    end: "2026-09-08",
  });
  const result = validateMemories({ revision: 2, memories: [second, first] });
  assert.equal(result.revision, 2);
  assert.deepEqual(
    result.memories.map((m) => m.id),
    ["memory_1", "memory_2"],
  );
});

test("overlapping, duplicate, inverted and malformed dates cannot overwrite a calendar", () => {
  assert.throws(
    () =>
      validateMemories({
        revision: 0,
        memories: [memory(), memory({ id: "another", start: "2026-09-07" })],
      }),
    /overlap/,
  );
  assert.throws(
    () => validateMemories({ revision: 0, memories: [memory(), memory()] }),
    /unique/,
  );
  for (const overrides of [{ end: "2026-08-30" }, { start: "2026-02-30" }]) {
    assert.throws(
      () => validateMemories({ revision: 0, memories: [memory(overrides)] }),
      /valid start/,
    );
  }
});

test("clip limits must stay within the track with positive duration", () => {
  for (const overrides of [
    { clipStartMs: -1 },
    { clipStartMs: 45000 },
    { clipEndMs: 180001 },
    { clipStartMs: 1.5 },
    { clipStartMs: NaN },
  ]) {
    assert.throws(
      () => validateMemories({ revision: 0, memories: [memory(overrides)] }),
      /Clip/,
    );
  }
});

test("remote artwork and song links are restricted to Spotify", () => {
  for (const url of [
    "https://i.scdn.co/image/a",
    "https://image-cdn-ak.spotifycdn.com/image/a",
  ])
    assert.equal(isSpotifyArtwork(url), true);
  for (const url of [
    "https://evil.test/image/a",
    "https://i.scdn.co.evil.test/image/a",
    "https://i.scdn.co@evil.test/image/a",
    "http://i.scdn.co/image/a",
    "https://i.scdn.co:444/image/a",
    "javascript:alert(1)",
  ])
    assert.equal(isSpotifyArtwork(url), false, url);
  const badTrack = { ...memory().track, url: "https://evil.test" };
  assert.throws(
    () =>
      validateMemories({
        revision: 0,
        memories: [memory({ track: badTrack })],
      }),
    /Spotify track link/,
  );
});

test("calendar revisions and payload limits reject unsafe values", () => {
  for (const revision of [-1, 0.5, "0", null, 2_147_483_647])
    assert.throws(
      () => validateMemories({ revision, memories: [] }),
      /revision/,
    );
  assert.throws(
    () =>
      validateMemories({ revision: 0, memories: Array(2001).fill(memory()) }),
    /2,000/,
  );
  assert.throws(
    () =>
      validateMemories({
        revision: 0,
        memories: [memory({ note: "x".repeat(2001) })],
      }),
    /Note/,
  );
});

test("CSRF check rejects missing and mismatched origins", () => {
  assert.doesNotThrow(() =>
    assertOrigin(
      new Request("https://example.test/api", {
        headers: { Origin: "https://example.test" },
      }),
      "https://example.test",
    ),
  );
  for (const origin of [undefined, "https://evil.test", "null"]) {
    assert.throws(
      () =>
        assertOrigin(
          new Request("https://example.test/api", {
            headers: origin ? { Origin: origin } : {},
          }),
          "https://example.test",
        ),
      /did not come/,
    );
  }
});

test("bounded body reader rejects chunked oversized and invalid JSON requests", async () => {
  const make = (body: string) =>
    new Request("https://example.test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
  assert.deepEqual(await readJson(make('{"a":1}'), 20), { a: 1 });
  await assert.rejects(readJson(make('"'.repeat(100)), 20), /too large/);
  await assert.rejects(readJson(make("invalid")), /invalid JSON/);
});

test("playback validates device ID, URI, and nonnegative integer position", () => {
  assert.deepEqual(
    validatePlay({
      deviceId: "device_abc",
      uri: `spotify:track:${trackId}`,
      positionMs: 12000,
    }),
    {
      deviceId: "device_abc",
      uri: `spotify:track:${trackId}`,
      positionMs: 12000,
    },
  );
  for (const override of [
    { uri: "spotify:album:abc" },
    { deviceId: "device&other=true" },
    { positionMs: -1 },
  ]) {
    assert.throws(() =>
      validatePlay({
        deviceId: "device",
        uri: `spotify:track:${trackId}`,
        positionMs: 0,
        ...override,
      }),
    );
  }
});

test("PKCE matches RFC vector and encrypted payloads reject tampering/purpose confusion", () => {
  process.env.DATABASE_URL = "postgresql://example";
  process.env.SESSION_SECRET = "a".repeat(48);
  process.env.SPOTIFY_CLIENT_ID = "example";
  process.env.APP_URL = "https://example.test";
  assert.equal(
    challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const encrypted = seal({ token: "not-visible" }, "spotify-tokens");
  assert.equal(encrypted.includes("not-visible"), false);
  assert.deepEqual(unseal(encrypted, "spotify-tokens"), {
    token: "not-visible",
  });
  assert.equal(unseal(encrypted, "oauth-state"), null);
  const tampered = Buffer.from(encrypted, "base64url");
  tampered[tampered.length - 1] ^= 1;
  assert.equal(unseal(tampered.toString("base64url"), "spotify-tokens"), null);
});
