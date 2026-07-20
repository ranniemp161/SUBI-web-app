/** Strips characters unsafe for a filename, collapsing whitespace. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : "export";
}

/**
 * Drops a source file's own extension (e.g. "sample-video.mp4" -> "sample-video")
 * so an export's own extension can be appended without stacking both, e.g.
 * "sample-video.mp4.xml". Names with no extension pass through unchanged.
 */
export function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}
