import { timingSafeEqual } from "crypto";

/**
 * Shared access-code check, used both by the Clerk `user.created` webhook
 * (the real gate — deletes the account if invalid) and by write routes like
 * /api/projects and /api/transcribe/deepgram (a re-check, since signUp.create()
 * grants a session immediately, before the webhook has had a chance to run).
 */
export function hasValidAccessCode(
  unsafeMetadata: Record<string, unknown> | null | undefined
): boolean {
  const providedCode = unsafeMetadata?.accessCode;
  const validCode = process.env.ACCESS_CODE;

  if (!validCode || typeof providedCode !== "string") return false;

  const expected = Buffer.from(validCode.trim());
  const provided = Buffer.from(providedCode.trim());

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
