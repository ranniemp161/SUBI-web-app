import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { listProjectObjectAssets } from "@/lib/scenes";
import { presignAssetReads, isStorageConfigured } from "@/lib/storage";

/**
 * `GET /api/projects/:id/objects/urls` — signed GET urls for every stored object
 * illustration in this project (spec `broll/0008`).
 *
 * The sibling of `character/urls`, and the same rule: the browser fetches images
 * **directly from the blob host** with these, so no image byte crosses a
 * Function on a path the browser can take itself (spec `broll/0004` AC-17).
 *
 * **One call for the whole project**, not one per scene. The Neon HTTP driver
 * gives every statement its own round trip, so a twenty scene plan asking
 * per-scene would be twenty requests to populate one screen — the grouped shape
 * this app already has a convention about.
 *
 * A project with no illustrations answers an empty list rather than a 404, and
 * so does one that is not yours. Those two being indistinguishable is what keeps
 * a project id from being confirmed to a stranger.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const user = await getAuthorizedDbUser(clerkId);
    if (!user) {
      return NextResponse.json({ error: "Your account is not set up yet." }, { status: 403 });
    }

    const assets = await listProjectObjectAssets(user.id, id);
    if (assets.length === 0) return NextResponse.json({ assets: [] });

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "Storage isn't configured on this server." },
        { status: 503 }
      );
    }

    const signed = await presignAssetReads(assets.map((asset) => asset.pathname));
    const urlFor = new Map(signed.map((entry) => [entry.pathname, entry]));

    return NextResponse.json({
      assets: assets.map((asset) => ({
        sceneId: asset.sceneId,
        url: urlFor.get(asset.pathname)?.url ?? null,
        expiresAt: urlFor.get(asset.pathname)?.expiresAt ?? null,
      })),
    });
  } catch (error) {
    reportError("Failed to sign object asset urls", error, { projectId: id });
    return NextResponse.json(
      { error: "Could not load this project's illustrations." },
      { status: 500 }
    );
  }
}
