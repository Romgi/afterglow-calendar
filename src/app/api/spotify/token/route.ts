import { requireUser } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";
import { accessToken } from "@/lib/server/spotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return json({ accessToken: await accessToken(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
