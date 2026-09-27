import { requireUser } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { assertOrigin, errorResponse, json, readJson } from "@/lib/server/http";
import { spotifyFetch } from "@/lib/server/spotify";
import { validatePlay } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertOrigin(request, getConfig().origin);
    const user = await requireUser();
    const { deviceId, uri, positionMs } = validatePlay(
      await readJson(request, 2048),
    );
    await spotifyFetch(
      user.id,
      `/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
      },
    );
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
