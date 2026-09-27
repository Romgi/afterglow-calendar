import type { Track } from "../types";
import { getConfig } from "./config";
import { randomToken, seal, unseal } from "./crypto";
import { database } from "./db";
import { ApiError } from "./http";
import { isSpotifyArtwork } from "./validation";

export const SPOTIFY_SCOPES =
  "streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state";
type Tokens = { accessToken: string; refreshToken: string };
type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export async function exchangeToken(
  params: URLSearchParams,
): Promise<TokenResponse> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (body?.error === "invalid_grant")
      throw new ApiError(
        401,
        "Your Spotify connection expired. Connect again to continue.",
        "reauth_required",
      );
    if (response.status === 429)
      throw new ApiError(
        429,
        "Spotify needs a short break. Please try again in a moment.",
        "rate_limited",
      );
    throw new ApiError(
      502,
      "Spotify could not connect. Please try again.",
      "spotify_unavailable",
    );
  }
  const data = await response.json();
  if (
    typeof data.access_token !== "string" ||
    typeof data.expires_in !== "number" ||
    data.expires_in <= 0
  ) {
    throw new ApiError(
      502,
      "Spotify sent an incomplete response. Please connect again.",
      "spotify_unavailable",
    );
  }
  return data;
}

export async function saveSpotifyAccount(tokens: TokenResponse) {
  if (!tokens.refresh_token)
    throw new ApiError(
      502,
      "Spotify did not finish connecting. Please try again.",
    );
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw await spotifyError(response);
  const profile = await response.json();
  if (typeof profile.id !== "string" || !profile.id || profile.id.length > 200)
    throw new ApiError(502, "Spotify could not load your account.");
  const name =
    typeof profile.display_name === "string" && profile.display_name
      ? profile.display_name.slice(0, 200)
      : "Your calendar";
  const rawImage = profile.images?.[0]?.url;
  const image =
    typeof rawImage === "string" && isSpotifyArtwork(rawImage)
      ? rawImage
      : null;
  const encrypted = seal(
    { accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
    "spotify-tokens",
  );
  const expires = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const sql = await database();
  await sql`
    INSERT INTO afterglow_users (id, display_name, image, token_cipher, access_expires_at)
    VALUES (${profile.id}, ${name}, ${image}, ${encrypted}, ${expires})
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, image = EXCLUDED.image,
      token_cipher = EXCLUDED.token_cipher, access_expires_at = EXCLUDED.access_expires_at,
      refresh_lock_id = NULL, refresh_lock_until = NULL, updated_at = NOW()
  `;
  return profile.id as string;
}

export async function accessToken(
  userId: string,
  forceRefresh = false,
): Promise<string> {
  const sql = await database();
  const leaseId = randomToken(16);
  let rejectedAccessToken: string | null = null;
  // A database lease prevents two serverless instances from rotating the same refresh token.
  for (let attempt = 0; attempt < 30; attempt++) {
    const rows =
      await sql`SELECT token_cipher, access_expires_at FROM afterglow_users WHERE id = ${userId}`;
    const row = rows[0];
    const tokens = row?.token_cipher
      ? unseal<Tokens>(row.token_cipher as string, "spotify-tokens")
      : null;
    if (!tokens?.accessToken || !tokens?.refreshToken)
      throw new ApiError(
        401,
        "Connect Spotify again to continue.",
        "reauth_required",
      );
    const expires = new Date(row.access_expires_at as string).getTime();
    if (forceRefresh && rejectedAccessToken === null) {
      rejectedAccessToken = tokens.accessToken;
    }
    if (
      tokens.accessToken !== rejectedAccessToken &&
      expires > Date.now() + 60_000
    )
      return tokens.accessToken;
    const locked = await sql`
      UPDATE afterglow_users SET refresh_lock_id = ${leaseId}, refresh_lock_until = NOW() + INTERVAL '20 seconds'
      WHERE id = ${userId} AND (refresh_lock_until IS NULL OR refresh_lock_until < NOW())
        AND token_cipher = ${row.token_cipher}
      RETURNING id
    `;
    if (!locked.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Keep rejecting this token until the lease holder has actually replaced
      // it. Its nominal expiry can still be in the future after a Spotify 401.
      continue;
    }
    try {
      const refreshed = await exchangeToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: getConfig().clientId,
        }),
      );
      const cipher = seal(
        {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token || tokens.refreshToken,
        },
        "spotify-tokens",
      );
      const nextExpiry = new Date(
        Date.now() + refreshed.expires_in * 1000,
      ).toISOString();
      await sql`UPDATE afterglow_users SET token_cipher = ${cipher}, access_expires_at = ${nextExpiry}, updated_at = NOW() WHERE id = ${userId} AND refresh_lock_id = ${leaseId}`;
      return refreshed.access_token;
    } catch (error) {
      if (error instanceof ApiError && error.code === "reauth_required") {
        await sql`UPDATE afterglow_users SET token_cipher = NULL WHERE id = ${userId} AND refresh_lock_id = ${leaseId}`;
      }
      throw error;
    } finally {
      await sql`UPDATE afterglow_users SET refresh_lock_id = NULL, refresh_lock_until = NULL WHERE id = ${userId} AND refresh_lock_id = ${leaseId}`;
    }
  }
  throw new ApiError(
    503,
    "Spotify is reconnecting. Please try again in a moment.",
    "spotify_unavailable",
  );
}

export async function spotifyError(response: Response) {
  if (response.status === 401)
    return new ApiError(
      401,
      "Connect Spotify again to continue.",
      "reauth_required",
    );
  if (response.status === 403)
    return new ApiError(
      403,
      "Spotify could not allow this action. Check Premium and the app's Spotify user access list.",
      "spotify_forbidden",
    );
  if (response.status === 404)
    return new ApiError(
      404,
      "The Spotify player is still connecting. Please try playing again.",
      "device_unavailable",
    );
  if (response.status === 429)
    return new ApiError(
      429,
      "Spotify needs a short break. Please try again in a moment.",
      "rate_limited",
    );
  return new ApiError(
    502,
    "Spotify is unavailable right now. Please try again.",
    "spotify_unavailable",
  );
}

export async function spotifyFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
) {
  const send = (token: string) =>
    fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  let response = await send(await accessToken(userId));
  if (response.status === 401)
    response = await send(await accessToken(userId, true));
  if (!response.ok) throw await spotifyError(response);
  return response;
}

type SpotifyTrack = {
  id?: string;
  name?: string;
  duration_ms?: number;
  is_local?: boolean;
  artists?: { name?: string }[];
  album?: { name?: string; images?: { url?: string }[] };
};

export function mapTrack(t: SpotifyTrack): Track | null {
  if (
    !t.id ||
    !/^[A-Za-z0-9]{22}$/.test(t.id) ||
    !t.name ||
    t.is_local ||
    !t.duration_ms
  )
    return null;
  const artwork =
    t.album?.images?.find((image) => !!image.url && isSpotifyArtwork(image.url))
      ?.url || "";
  return {
    id: t.id,
    uri: `spotify:track:${t.id}`,
    title: t.name,
    artist:
      t.artists
        ?.map((a) => a.name)
        .filter(Boolean)
        .join(", ") || "Unknown artist",
    album: t.album?.name || "",
    artwork,
    durationMs: t.duration_ms,
    url: `https://open.spotify.com/track/${t.id}`,
  };
}
