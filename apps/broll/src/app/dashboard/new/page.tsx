import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getAuthorizedDbUser } from "@repo/server-shared/authz";
import { formatUsd, BROLL_CHARACTER_SET_MICROS } from "@repo/billing/pricing";
import { listPickableCharacters } from "@/lib/characters";
import { presignAssetReads } from "@/lib/storage";
import type { PickerCharacter } from "@/lib/character-picker";
import { NewProjectForm } from "./new-project-form";

/**
 * Project setup (spec `broll/0007` AC-122).
 *
 * A server component now, because the form needs the characters this creator
 * already owns and they have to be read and signed somewhere. Signing here
 * rather than fetching from the browser keeps the thumbnails on the first paint
 * and keeps every image request pointed straight at the blob host, with no
 * Function in the data path (spec `0004` AC-17).
 */
export default async function NewProjectPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const user = await getAuthorizedDbUser(clerkId);
  if (!user) redirect("/dashboard");

  // Only complete characters, counted from their rows (AC-125).
  const characters = await listPickableCharacters(user.id);

  // A store that is unreachable or unconfigured costs the thumbnails, not the
  // page: the rest of setup works, and the entries still name their character.
  const signed = await presignAssetReads(
    characters.map((character) => character.neutralPathname)
  ).catch(() => []);
  const urlFor = new Map(signed.map((entry) => [entry.pathname, entry.url]));

  const pickable: PickerCharacter[] = characters.map((character) => ({
    id: character.id,
    name: character.name,
    style: character.style,
    thumbnailUrl: urlFor.get(character.neutralPathname) ?? null,
  }));

  return (
    <NewProjectForm
      characters={pickable}
      // Formatted here because the price env override is server side only.
      setPrice={formatUsd(BROLL_CHARACTER_SET_MICROS)}
    />
  );
}
