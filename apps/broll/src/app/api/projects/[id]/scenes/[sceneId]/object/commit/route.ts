import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { z } from "zod";
import { isObjectAssetPathnameForAttempt } from "@/lib/asset-path";
import { commitSceneObject, getObjectSceneContext } from "@/lib/scenes";

/**
 * `POST /api/projects/:id/scenes/:sceneId/object/commit` — record the
 * illustration the browser just uploaded (spec `broll/0008`).
 *
 * **The third check on one pathname, and it is not redundant.** The generate
 * route minted it, `/api/blob/upload` re-derived it before signing a PUT, and
 * this route re-derives it once more before it becomes a stored value on a row.
 * The property being defended is that a client supplied string never becomes a
 * stored key, and each of the three is the last line of defence if the other two
 * are changed by someone who does not know why they were there.
 *
 * Here the check is stricter than "is this well formed": the pathname must be
 * the *exact* one this scene's current attempt would produce, apart from its
 * random element. A well formed path for the wrong attempt is a stale upload
 * from a request that lost a race, and pointing the row at it would show the
 * creator an illustration they had already replaced.
 *
 * A commit that lands twice is harmless and answers ok both times: the second
 * writes the same pathname a second time.
 */
const commitSchema = z.object({
  pathname: z.string().min(1).max(512),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, sceneId } = await params;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Your account is not set up yet." }, { status: 403 });
    }

    const parsed = commitSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "That commit isn't valid." }, { status: 400 });
    }
    const { pathname } = parsed.data;

    const scene = await getObjectSceneContext(user.id, sceneId);
    if (!scene || scene.projectId !== id) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    // Well formed for this scene, **and** for the attempt this scene is actually
    // on — see the predicate's own note on why the second half matters.
    if (!isObjectAssetPathnameForAttempt(pathname, sceneId, scene.attempt + 1)) {
      return NextResponse.json({ error: "That isn't this scene's upload." }, { status: 422 });
    }

    const committed = await commitSceneObject(user.id, sceneId, pathname);
    if (!committed) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, pathname });
  } catch (error) {
    reportError("Failed to commit a b-roll object illustration", error, {
      projectId: id,
      sceneId,
    });
    return NextResponse.json({ error: "Couldn't save that illustration." }, { status: 500 });
  }
}
