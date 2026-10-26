import { handleCreateBuzz } from "@/lib/buzz-server/handlers";
import { buzzServerDeps } from "@/lib/buzz-server/next";

/**
 * POST /api/buzz — post a buzz. The text (title, body, poll options) is moderated here, server-side, before the
 * database stores it through `buzz_v2_create` (service role only). Website: cookie session; app: `Authorization: Bearer`.
 * Body: `CreateBuzzRequest`. 201 → the buzz as its author sees it + `moderation` (AuthorNotice). Errors:
 * `{ error: { code, message, details? } }` — see lib/buzz-server/handlers.ts. Client: `createBuzzPost` (packages/shared).
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleCreateBuzz(request, buzzServerDeps());
}
