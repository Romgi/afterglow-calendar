import { ApiError } from "./http";

export function getConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (
    !databaseUrl ||
    !sessionSecret ||
    sessionSecret.length < 32 ||
    !clientId ||
    !appUrl
  ) {
    throw new ApiError(
      503,
      "Spotify and account sync are still being connected. Please try again later.",
      "not_configured",
    );
  }
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new ApiError(
      503,
      "The app URL needs to be configured.",
      "not_configured",
    );
  }
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new ApiError(
      503,
      "The app URL needs to use HTTPS.",
      "not_configured",
    );
  }
  return {
    databaseUrl,
    sessionSecret,
    clientId,
    origin: url.origin,
    redirectUri: `${url.origin}/api/auth/callback`,
    secure: url.protocol === "https:",
  };
}

export function isConfigured() {
  try {
    getConfig();
    return true;
  } catch {
    return false;
  }
}
