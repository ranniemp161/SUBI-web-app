import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { reportError } from "@repo/server-shared/observability";
import { getBrollProject } from "@/lib/projects";
import { listCharacterAssets } from "@/lib/assets";
import { presignAssetReads, isStorageConfigured } from "@/lib/storage";

/**
 * `GET /api/projects/:id/character/urls` — signed GET urls for this project's
 * stored character variants (spec `broll/0004` AC-17).
 *
 * The browser fetches the images **directly from the blob host** with these.
 * Vercel's documented alternative for a private blob is delivery through a
 * Function, which would put image bytes back in the data path on every review
 * gate and Scene Studio load; this route hands out a signature instead and never
 * touches a pixel.
 *
 * The project page presigns its own urls server side for the first paint, so
 * this route exists for the refreshes after it: a regeneration replaces one
 * pathname, and a url signed for the old one no longer names anything.
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
      return NextResponse.json(
        { error: "Your account is not set up yet." },
        { status: 403 }
      );
    }

    const project = await getBrollProject(user.id, id);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: "Storage isn't configured on this server." },
        { status: 503 }
      );
    }

    const assets = await listCharacterAssets(user.id, id);
    const signed = await presignAssetReads(assets.map((asset) => asset.pathname));
    const urlFor = new Map(signed.map((entry) => [entry.pathname, entry]));

    return NextResponse.json({
      assets: assets.map((asset) => ({
        emotion: asset.emotion,
        width: asset.width,
        height: asset.height,
        attempt: asset.attempt,
        url: urlFor.get(asset.pathname)?.url ?? null,
        expiresAt: urlFor.get(asset.pathname)?.expiresAt ?? null,
      })),
    });
  } catch (error) {
    reportError("Failed to sign character asset urls", error, { projectId: id });
    return NextResponse.json({ error: "Could not load the character set." }, { status: 500 });
  }
}
