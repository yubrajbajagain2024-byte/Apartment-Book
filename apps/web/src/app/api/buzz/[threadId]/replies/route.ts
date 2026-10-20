import { handleCreateBuzzReply } from "@/lib/buzz-server/handlers";
import { buzzServerDeps } from "@/lib/buzz-server/next";

/**
 * POST /api/buzz/:threadId/replies — reply in a thread. Moderated here, stored through `buzz_v2_reply` (service role
 * only). Body: `CreateBuzzReplyRequest` (`parentId` omitted = reply to the root). 201 → the reply as its author sees it +
 * `moderation`. A missing / unreachable thread is `not_found`, a locked one `locked`. Client: `createBuzzReply`.
 */
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }): Promise<Response> {
  const { threadId } = await context.params;
  return handleCreateBuzzReply(request, threadId, buzzServerDeps());
}
