import { requireUser } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";
import { database } from "@/lib/server/db";
import {
  assertAccount,
  assertOrigin,
  errorResponse,
  json,
  readJson,
} from "@/lib/server/http";
import { validateMemories } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    assertAccount(request, user.id);
    const sql = await database();
    const rows =
      await sql`SELECT memories, revision FROM afterglow_users WHERE id = ${user.id}`;
    return json({ memories: rows[0].memories, revision: rows[0].revision });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertOrigin(request, getConfig().origin);
    const user = await requireUser();
    assertAccount(request, user.id);
    const { memories, revision } = validateMemories(await readJson(request));
    const sql = await database();
    const updated = await sql`
      UPDATE afterglow_users SET memories = ${JSON.stringify(memories)}::jsonb, revision = revision + 1, updated_at = NOW()
      WHERE id = ${user.id} AND revision = ${revision} RETURNING revision
    `;
    if (!updated.length) {
      return json(
        {
          error:
            "Your calendar changed on another device. Reload it before saving again.",
          code: "revision_conflict",
        },
        409,
      );
    }
    return json({ revision: updated[0].revision });
  } catch (error) {
    return errorResponse(error);
  }
}
