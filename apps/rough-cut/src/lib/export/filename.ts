/** Strips characters unsafe for a filename, collapsing whitespace. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : "export";
}
