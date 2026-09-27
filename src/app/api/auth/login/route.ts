import { NextResponse } from "next/server";
import { cookieOptions, OAUTH_COOKIE } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { challenge, randomToken, seal } from "@/lib/server/crypto";
import { errorResponse } from "@/lib/server/http";
import { SPOTIFY_SCOPES } from "@/lib/server/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getConfig();
    const state = randomToken();
    const verifier = randomToken(48);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      state,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: "S256",
      code_challenge: challenge(verifier),
    }).toString();
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(
      OAUTH_COOKIE,
      seal({ state, verifier, expiresAt: Date.now() + 600_000 }, "oauth-state"),
      cookieOptions(600),
    );
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
