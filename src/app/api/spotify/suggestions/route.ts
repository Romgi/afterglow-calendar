import { listeningBounds } from "@/lib/listening";
import { requireUser } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import {
  ApiError,
  assertAccount,
  assertOrigin,
  errorResponse,
  json,
  readJson,
} from "@/lib/server/http";
import { weeklySuggestions } from "@/lib/server/listening-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertOrigin(request, getConfig().origin);
    const user = await requireUser();
    assertAccount(request, user.id);
    const bounds = listeningBounds(await readJson(request, 1024));
    if (!bounds)
      throw new ApiError(400, "Choose a valid calendar week.", "invalid_input");
    return json(await weeklySuggestions(user.id, bounds.from, bounds.to));
  } catch (error) {
    return errorResponse(error);
  }
}
