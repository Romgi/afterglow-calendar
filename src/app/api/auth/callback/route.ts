import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, OAUTH_COOKIE, startSession } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { safeEqual, unseal } from "@/lib/server/crypto";
import { ApiError, errorResponse } from "@/lib/server/http";
import { exchangeToken, saveSpotifyAccount } from "@/lib/server/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OAuthState = { state: string; verifier: string; expiresAt: number };

export async function GET(request: Request) {
  let config: ReturnType<typeof getConfig>;
  try {
    config = getConfig();
  } catch (error) {
    return errorResponse(error);
  }
  const finish = (error?: string) => {
    const destination = new URL("/", config.origin);
    if (error) destination.searchParams.set("auth_error", error);
    const response = NextResponse.redirect(destination, 303);
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(OAUTH_COOKIE, "", cookieOptions(0));
    return response;
  };
  try {
    const params = new URL(request.url).searchParams;
    const cookie = (await cookies()).get(OAUTH_COOKIE)?.value;
    const saved = cookie ? unseal<OAuthState>(cookie, "oauth-state") : null;
    const returnedState = params.get("state");
    if (
      !saved ||
      typeof saved.state !== "string" ||
      typeof saved.verifier !== "string" ||
      typeof saved.expiresAt !== "number" ||
      saved.expiresAt < Date.now() ||
      !returnedState ||
      !safeEqual(saved.state, returnedState)
    ) {
      return finish("session_expired");
    }
    if (params.has("error")) return finish("access_denied");
    const code = params.get("code");
    if (!code || code.length > 4096) return finish("connection_failed");
    const tokens = await exchangeToken(
      new URLSearchParams({
        client_id: config.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: saved.verifier,
      }),
    );
    const userId = await saveSpotifyAccount(tokens);
    const response = finish();
    await startSession(userId, response);
    return response;
  } catch (error) {
    return finish(
      error instanceof ApiError && error.code === "spotify_forbidden"
        ? "spotify_forbidden"
        : "connection_failed",
    );
  }
}
