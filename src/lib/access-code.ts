/**
 * Shared access-code check, used both by the Clerk `user.created` webhook
 * (the real gate — deletes the account if invalid) and by write routes like
 * /api/projects and /api/transcribe/init (a re-check, since signUp.create()
 * grants a session immediately, before the webhook has had a chance to run).
 */
export function hasValidAccessCode(
  unsafeMetadata: Record<string, unknown> | null | undefined
): boolean {
  const providedCode = unsafeMetadata?.accessCode;
  const validCode = process.env.ACCESS_CODE;

  return (
    !!validCode &&
    typeof providedCode === "string" &&
    providedCode.trim() === validCode.trim()
  );
}
