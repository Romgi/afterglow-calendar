import { requireUser } from "@/lib/server/auth";
import { ApiError, errorResponse, json } from "@/lib/server/http";
import { mapTrack, spotifyFetch } from "@/lib/server/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (query.length > 200)
      throw new ApiError(400, "Keep your search under 200 characters.");
    if (!query) return json({ tracks: [] });
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: "10",
    });
    const response = await spotifyFetch(user.id, `/search?${params}`);
    const data = await response.json();
    const items = Array.isArray(data.tracks?.items) ? data.tracks.items : [];
    return json({ tracks: items.map(mapTrack).filter(Boolean) });
  } catch (error) {
    return errorResponse(error);
  }
}
