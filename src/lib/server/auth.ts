import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Session } from "../types";
import { getConfig } from "./config";
import { database } from "./db";
import { hash, randomToken } from "./crypto";
import { ApiError } from "./http";

export const SESSION_COOKIE = "afterglow_session";
export const OAUTH_COOKIE = "afterglow_oauth";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: getConfig().secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function currentUser(): Promise<Session["user"]> {
  getConfig();
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
  const sql = await database();
  const rows = await sql`
    SELECT u.id, u.display_name, u.image
    FROM afterglow_sessions s JOIN afterglow_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash(cookie)} AND s.expires_at > NOW() AND u.token_cipher IS NOT NULL
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id as string,
        name: row.display_name as string,
        ...(row.image ? { image: row.image as string } : {}),
      }
    : null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user)
    throw new ApiError(
      401,
      "Connect Spotify to continue. Your saved calendar will be here.",
      "reauth_required",
    );
  return user;
}

export async function startSession(userId: string, response: NextResponse) {
  const sql = await database();
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const oldToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (oldToken)
    await sql`DELETE FROM afterglow_sessions WHERE token_hash = ${hash(oldToken)}`;
  await sql`DELETE FROM afterglow_sessions WHERE expires_at <= NOW()`;
  await sql`INSERT INTO afterglow_sessions (token_hash, user_id, expires_at) VALUES (${hash(token)}, ${userId}, ${expires})`;
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_SECONDS));
}

export async function endSession(response: NextResponse) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const sql = await database();
    await sql`DELETE FROM afterglow_sessions WHERE token_hash = ${hash(token)}`;
  }
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}
