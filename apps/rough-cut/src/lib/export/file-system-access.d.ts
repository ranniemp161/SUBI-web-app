/**
 * `showSaveFilePicker` isn't in TypeScript's lib.dom.d.ts yet, even though
 * `FileSystemFileHandle`/`FileSystemWritableFileStream` already are. Narrow
 * ambient declaration covering only what the export pipeline uses.
 */
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}
