import { currentUser } from "@/lib/server/auth";
import { isConfigured } from "@/lib/server/config";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isConfigured()) return json({ configured: false, user: null });
  try {
    return json({ configured: true, user: await currentUser() });
  } catch (error) {
    return errorResponse(error);
  }
}
