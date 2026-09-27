import { endSession } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { assertOrigin, errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertOrigin(request, getConfig().origin);
    const response = json({ ok: true });
    await endSession(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
