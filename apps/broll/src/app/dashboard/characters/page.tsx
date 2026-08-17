import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { db } from "@repo/db";
import { brollCharacters } from "@repo/db/schema";
import { eq, desc } from "drizzle-orm";
import { reportError } from "@repo/server-shared/observability";
import {
  listAssetsByCharacter,
  regenerationsUsedByCharacter,
} from "@/lib/assets";
import { listProjectsByCharacter } from "@/lib/characters";
import { presignAssetReads } from "@/lib/storage";
import { styleLabel } from "@/lib/character-picker";
import { MAX_REGENERATIONS } from "@/lib/character-prompt";
import type { CharacterEmotion } from "@/lib/emotions";
import { Badge, Card } from "@/components/ui";
import { CharacterActions } from "./character-actions";
import Link from "next/link";

export const metadata = {
  title: "Characters — B-Roll Generator",
};

function emotionLabel(e: string): string {
  return e.charAt(0).toUpperCase() + e.slice(1);
}

export default async function CharactersPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) redirect("/dashboard");

  const characters = await db
    .select({
      id: brollCharacters.id,
      name: brollCharacters.name,
      style: brollCharacters.style,
      createdAt: brollCharacters.createdAt,
    })
    .from(brollCharacters)
    .where(eq(brollCharacters.userId, user.id))
    .orderBy(desc(brollCharacters.createdAt));

  // Three grouped statements for the whole page, not three per character.
  const [assetsByCharacter, regenerationsByCharacter, projectsByCharacter] =
    await Promise.all([
      listAssetsByCharacter(user.id),
      regenerationsUsedByCharacter(user.id),
      listProjectsByCharacter(user.id),
    ]);

  // **Signing failure is reported and shown, never swallowed.** Falling back to
  // an empty list here renders exactly like a character that has no images, on
  // the one screen whose job is showing a creator the six faces they paid for.
  // A store hiccup, an expired token or the wrong store would all read as "your
  // character is gone", which is the worst thing this page can say and the least
  // true. One pass for every pathname on the page, so one failure is one report.
  const pathnames = characters.flatMap((char) =>
    (assetsByCharacter.get(char.id) ?? []).map((asset) => asset.pathname)
  );

  let signedUrls = new Map<string, string>();
  let thumbnailsUnavailable = false;
  try {
    const signed = await presignAssetReads(pathnames);
    signedUrls = new Map(signed.map((s) => [s.pathname, s.url]));
  } catch (error) {
    thumbnailsUnavailable = true;
    reportError("Failed to sign character thumbnail reads", error, {
      userId: user.id,
      pathnameCount: pathnames.length,
    });
  }

  const characterDetails = characters.map((char) => {
    const assets = assetsByCharacter.get(char.id) ?? [];
    return {
      ...char,
      assets: assets.map((asset) => ({
        ...asset,
        url: signedUrls.get(asset.pathname) ?? null,
      })),
      regenerationsLeft: Math.max(
        0,
        MAX_REGENERATIONS - (regenerationsByCharacter.get(char.id) ?? 0)
      ),
      projects: projectsByCharacter.get(char.id) ?? [],
    };
  });

  return (
    <div className="max-w-[1400px] w-full mx-auto px-6 sm:px-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Character Library
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            All character sets generated from your photos. Reusable across any project for free.
          </p>
        </div>

        <Link
          href="/dashboard/new"
          className="px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md"
          style={{
            background: "var(--broll-accent)",
            color: "var(--broll-accent-foreground)",
          }}
        >
          + New project
        </Link>
      </div>

      {thumbnailsUnavailable && (
        <div className="mt-6 rounded-xl px-4 py-3 border border-amber-400/30 bg-amber-400/[0.06]">
          <p className="text-xs text-amber-200/90 leading-relaxed">
            <strong className="font-bold">Previews are unavailable right now.</strong>{" "}
            Your characters are safe and still stored. Only the images on this
            page could not be loaded, and the error has been reported.
          </p>
        </div>
      )}

      {characterDetails.length === 0 ? (
        <Card variant="glow" className="mt-10 p-12 text-center max-w-xl mx-auto">
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center bg-[var(--broll-accent)]/10 text-[var(--broll-accent)]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "var(--font-space-grotesk)" }}>
            No characters yet
          </h2>
          <p className="text-xs text-zinc-400 leading-relaxed mb-6">
            When you create a project and upload a photo, a full 6-emotion character set
            is generated. You will see all your saved characters here.
          </p>
          <Link
            href="/dashboard/new"
            className="inline-block px-5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-lg"
            style={{
              background: "var(--broll-accent)",
              color: "var(--broll-accent-foreground)",
            }}
          >
            Create your first project
          </Link>
        </Card>
      ) : (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {characterDetails.map((char) => {
            return (
              <Card
                key={char.id}
                className="p-6 flex flex-col justify-between"
              >
                <div>
                  {/* Top Bar: Name, Style, Created Date */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h2 className="font-bold text-lg text-white">
                        {char.name}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" size="sm">
                          {styleLabel(char.style)}
                        </Badge>
                        <span className="text-[11px] text-zinc-500">
                          Created {new Date(char.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Redraw Allowance */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#16171c] border border-white/10">
                      <div className="w-2 h-2 rounded-full bg-[var(--broll-accent)]" />
                      <span className="text-[11px] font-bold text-white broll-tabular">
                        {char.regenerationsLeft} of {MAX_REGENERATIONS} redraws left
                      </span>
                    </div>
                  </div>

                  {/* 6 Emotion Variants Thumbnails */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 my-4">
                    {(
                      [
                        "excited",
                        "happy",
                        "neutral",
                        "skeptical",
                        "surprised",
                        "thoughtful",
                      ] as CharacterEmotion[]
                    ).map((emotion) => {
                      const asset = char.assets.find((a) => a.emotion === emotion);
                      return (
                        <div
                          key={emotion}
                          className="rounded-xl p-2 bg-[#16171c] border border-white/5 flex flex-col items-center gap-1.5"
                        >
                          <div className="w-full aspect-[3/4] rounded-lg bg-black/60 flex items-center justify-center overflow-hidden">
                            {asset?.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={asset.url}
                                alt={`${emotionLabel(emotion)} character variant`}
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : asset ? (
                              // The image exists and could not be signed. Never
                              // "Empty": this variant is stored and paid for.
                              <span className="text-[9px] text-amber-400/90 text-center px-1 leading-tight">
                                Could not load
                              </span>
                            ) : (
                              <span className="text-[9px] text-zinc-600">Empty</span>
                            )}
                          </div>
                          <span className="text-[10px] font-medium text-zinc-400 truncate w-full text-center">
                            {emotionLabel(emotion)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Projects Using This Character */}
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-2">
                      Used in {char.projects.length} project{char.projects.length === 1 ? "" : "s"}
                    </span>
                    {char.projects.length === 0 ? (
                      <p className="text-xs text-zinc-500 italic">
                        Not currently attached to any project.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {char.projects.map((proj) => (
                          <Link
                            key={proj.id}
                            href={`/dashboard/${proj.id}`}
                            className="px-2.5 py-1 rounded-md text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition-colors"
                          >
                            {proj.name} →
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer: the library actions, then the way out to a project */}
                <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap items-center justify-between gap-3">
                  <CharacterActions
                    characterId={char.id}
                    name={char.name}
                    inUseCount={char.projects.length}
                  />
                  <Link
                    href="/dashboard/new"
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-200 bg-[#16171c] hover:bg-white/10 border border-white/10 transition-colors"
                  >
                    Start project with this character →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
