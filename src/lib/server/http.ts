import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError)
    return json({ error: error.message, code: error.code }, error.status);
  // Database errors can contain connection credentials. Never return or log their raw text.
  return json(
    {
      error: "Something went wrong. Please try again shortly.",
      code: "server_error",
    },
    500,
  );
}

export async function readJson(
  request: Request,
  maxBytes = 2_000_000,
): Promise<unknown> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new ApiError(415, "Send a JSON request.");
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes)
    throw new ApiError(413, "This calendar is too large.");
  if (!request.body) throw new ApiError(400, "A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "This calendar is too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "The request contains invalid JSON.");
  }
}

export function assertOrigin(request: Request, allowedOrigin: string) {
  if (request.headers.get("origin") !== allowedOrigin) {
    throw new ApiError(
      403,
      "This request did not come from Afterglow.",
      "invalid_origin",
    );
  }
}

export function assertAccount(request: Request, authenticatedUserId: string) {
  // A login in another tab changes shared cookies, but not this tab's calendar.
  // Never apply that calendar to a different account, even if revisions match.
  if (request.headers.get("x-afterglow-user") !== authenticatedUserId) {
    throw new ApiError(
      409,
      "Your signed-in account changed. Reload this page before making more changes.",
      "account_changed",
    );
  }
}
