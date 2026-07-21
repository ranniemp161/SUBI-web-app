"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPatch } from "rfc6902";
import type { EDL, SensitivityLevel } from "@/lib/edl";

/** Quiet period after the last edit before a save fires. */
export const AUTOSAVE_DELAY_MS = 800;
/**
 * Hard ceiling on how long an edit may sit unsaved. The debounce timer resets
 * on every edit, so continuous editing — dragging a boundary, cutting word
 * after word — can starve the save indefinitely. This deadline starts at the
 * first edit of a dirty streak and forces a flush regardless of the debounce.
 */
export const AUTOSAVE_MAX_WAIT_MS = 5_000;

/**
 * Backoff schedule for a failed save. Bounded on purpose: past this the
 * failure is reported to the user rather than retried silently forever, and
 * the next edit starts a fresh budget.
 */
export const AUTOSAVE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/** A non-ok PATCH response, carrying the status so backoff can judge it. */
class SaveFailure extends Error {
  constructor(readonly status: number) {
    super(`Failed to save (${status})`);
    this.name = "SaveFailure";
  }
}

/**
 * Whether another attempt could plausibly succeed. `null` is a network-level
 * failure (offline, DNS, connection reset) — the most retryable case there is.
 * A 4xx other than 429 is a permanent verdict on this exact request body.
 */
function isRetryable(status: number | null): boolean {
  if (status === null) return true;
  // 409 is the version guard: the retry re-diffs against the state the
  // rejection handed back, so it's exactly the case another attempt fixes.
  return status >= 500 || status === 429 || status === 409;
}

export type SaveState = "saved" | "saving";

interface AutosaveOptions {
  projectId: string;
  /** The live EDL. Null before the project loads. */
  edl: EDL | null;
  sensitivity: SensitivityLevel;
  /**
   * The server's EDL, adopted once as the diff baseline. After that the
   * baseline is advanced by each successful save — never re-seeded from a
   * later refetch, whose EDL can be older than the local one.
   */
  serverEdl: EDL | null;
  /**
   * The `updatedAt` that `serverEdl` was read at — the base version for the
   * first save. Advanced by each save's response thereafter.
   */
  serverUpdatedAt: string | null;
  /**
   * False until the project has loaded AND the user has actually edited. A
   * freshly auto-generated EDL must not persist itself: the load path is
   * `data.edl ?? buildInitialEDL(...)`, so a saved bad auto-build could never
   * be rebuilt.
   *
   * A getter rather than a boolean because the "has edited" flag is a ref (it
   * must not be read during render), and it always flips in the same render
   * that changes `edl` — which is what re-runs the scheduling effect.
   */
  isEnabled: () => boolean;
  onSaveStateChange: (state: SaveState) => void;
  /** Called when a save fails. The caller owns user-facing messaging. */
  onError: (error: unknown) => void;
}

/**
 * Debounced auto-save of EDL changes to Postgres.
 *
 * Sends an RFC-6902 patch against the last known server state (a full EDL only
 * on the very first save, when there's no baseline to diff against), so a
 * 100k-segment timeline costs a few hundred bytes per edit rather than
 * megabytes.
 *
 * At most one save is ever in flight: a patch is only valid against the exact
 * baseline it was computed from, so overlapping requests would apply the second
 * patch to a server state the first had already advanced. A save requested
 * while one is in flight is coalesced into a single follow-up save that runs
 * once the first settles.
 */
export function useEdlAutosave({
  projectId,
  edl,
  sensitivity,
  serverEdl,
  serverUpdatedAt,
  isEnabled,
  onSaveStateChange,
  onError,
}: AutosaveOptions) {
  /** Last EDL known to be on the server — what patches are computed against. */
  const baselineRef = useRef<EDL | null>(null);
  /** The row version `baselineRef` was read at, sent as the write's guard. */
  const baseUpdatedAtRef = useRef<string | null>(null);
  /** Latest local EDL, i.e. what the next save should make the server match. */
  const targetRef = useRef<EDL | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Absolute time the current dirty streak must be flushed by; null when clean. */
  const deadlineRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  /** An edit arrived mid-save; flush again once the in-flight save settles. */
  const pendingRef = useRef(false);
  /** How many times the current save has already been retried. */
  const retryAttemptRef = useRef(0);

  // Callers pass inline closures; hold them in refs so the scheduling effect
  // below doesn't re-run (and reset the debounce) on every parent render.
  const onSaveStateChangeRef = useRef(onSaveStateChange);
  onSaveStateChangeRef.current = onSaveStateChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;

  useEffect(() => {
    if (serverEdl && !baselineRef.current) baselineRef.current = serverEdl;
  }, [serverEdl]);

  // Unlike the EDL baseline, the version is adopted whenever the page loads a
  // newer one and we haven't saved past it — a fresh project has no EDL to
  // adopt but still has a version its first save must be guarded on.
  useEffect(() => {
    if (serverUpdatedAt && !baseUpdatedAtRef.current) {
      baseUpdatedAtRef.current = serverUpdatedAt;
    }
  }, [serverUpdatedAt]);

  /**
   * Send whatever is pending now.
   *
   * `keepalive` is for the page-is-going-away paths: it lets the request
   * outlive the document (a plain fetch is cancelled the moment the tab
   * closes), at the cost of a 64KB body cap — which is why saves are patches.
   * A keepalive flush is fire-and-forget: there is no live page left to
   * retry, update, or show a toast.
   */
  const flush = useCallback((keepalive = false) => {
    const target = targetRef.current;
    if (!target) return;

    // A patch is only valid against the baseline it was diffed from, so never
    // overlap saves — coalesce into one follow-up instead.
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    const baseline = baselineRef.current;
    const patch = baseline ? createPatch(baseline, target) : null;

    // Nothing actually changed (e.g. an edit that was undone within the
    // debounce window) — don't spend a request on it.
    if (patch && patch.length === 0) {
      deadlineRef.current = null;
      onSaveStateChangeRef.current("saved");
      return;
    }

    deadlineRef.current = null;

    // First save for a fresh project (no prior EDL) — send the whole thing.
    const body = {
      ...(patch ? { edlPatch: patch } : { edl: target }),
      // Omitted only when we've never seen a version (the project hasn't
      // finished loading), in which case the server writes unguarded.
      ...(baseUpdatedAtRef.current
        ? { baseUpdatedAt: baseUpdatedAtRef.current }
        : {}),
    };
    const request = () =>
      fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive,
      });

    if (keepalive) {
      // Nothing downstream can observe the result — the page is unloading.
      request().catch(() => {});
      return;
    }

    inFlightRef.current = true;
    onSaveStateChangeRef.current("saving");

    request()
      .then(async (res) => {
        // The row moved under us. The 409 carries the current server state, so
        // re-baseline onto it and let the retry below re-diff — the local EDL
        // is what the user is looking at, so it wins on content; the point of
        // the guard is to never apply a patch to a base it wasn't built from.
        if (res.status === 409) {
          const body = await res.json().catch(() => null);
          if (body?.updatedAt) {
            baselineRef.current = body.edl ?? null;
            baseUpdatedAtRef.current = body.updatedAt;
          }
          throw new SaveFailure(409);
        }
        if (!res.ok) throw new SaveFailure(res.status);

        const body = await res.json().catch(() => null);
        baselineRef.current = target;
        if (body?.updatedAt) baseUpdatedAtRef.current = body.updatedAt;
        retryAttemptRef.current = 0;
        onSaveStateChangeRef.current("saved");
      })
      .catch((error: unknown) => {
        const status = error instanceof SaveFailure ? error.status : null;
        const attempt = retryAttemptRef.current;

        // Waiting for the next edit is not a retry strategy: a user whose last
        // action fails and who then walks away loses that edit outright. Retry
        // on our own, but only for failures another attempt could fix — a 400
        // (invalid patch) or 404 will fail identically forever.
        if (isRetryable(status) && attempt < AUTOSAVE_RETRY_DELAYS_MS.length) {
          retryAttemptRef.current = attempt + 1;
          // Status stays "Saving…" — it genuinely hasn't saved, and we're
          // still working on it.
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(
            () => flush(),
            AUTOSAVE_RETRY_DELAYS_MS[attempt]
          );
          return;
        }

        // Out of attempts (or unretryable). Leave the status on "Saving…" and
        // hand the caller the error to surface — the local edit is still
        // there, and the next edit starts a fresh attempt.
        retryAttemptRef.current = 0;
        onErrorRef.current(error);
      })
      .finally(() => {
        inFlightRef.current = false;
        const retryScheduled = retryAttemptRef.current > 0;
        if (pendingRef.current) {
          pendingRef.current = false;
          // A scheduled retry will pick up the newer target itself (flush
          // always reads the latest) — don't race it with a second request.
          if (!retryScheduled) flush();
        }
      });
  }, [projectId]);

  useEffect(() => {
    if (!edl || !isEnabledRef.current()) return;

    targetRef.current = { ...edl, sensitivity };
    // A fresh edit gets a fresh retry budget (and cancels any pending retry
    // below — this save supersedes it).
    retryAttemptRef.current = 0;

    const now = Date.now();
    // The first edit of a dirty streak starts the ceiling; later edits in the
    // same streak push the debounce but can't push this out.
    deadlineRef.current ??= now + AUTOSAVE_MAX_WAIT_MS;
    const wait = Math.max(
      0,
      Math.min(AUTOSAVE_DELAY_MS, deadlineRef.current - now)
    );

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, wait);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [edl, sensitivity, flush]);

  // Closing the tab, navigating away, or backgrounding the page within the
  // debounce window would otherwise drop the last edit silently. Flush it
  // instead — no prompt, no confirm dialog, nothing the user has to answer.
  //
  // `pagehide` fires on close/navigate and (unlike `beforeunload`) is
  // bfcache-compatible; `visibilitychange` covers the mobile case where a tab
  // is backgrounded and later discarded without ever firing pagehide.
  useEffect(() => {
    const onPageHide = () => flush(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush(true);
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // A client-side route change unmounts the editor without any page
      // lifecycle event at all, so this cleanup is the only flush point.
      // Keepalive here too: the request must survive the teardown.
      flush(true);
    };
  }, [flush]);
}
