import * as Sentry from "@sentry/nextjs";

/**
 * Log a server error and forward it to Sentry.
 *
 * Our API route handlers catch their own errors and return a 5xx rather than
 * rethrowing, so Next's `onRequestError` instrumentation never sees them — this
 * is how those swallowed errors reach Sentry. `Sentry.captureException` is a
 * no-op until Sentry is configured (see the env-gated init), so this is safe to
 * call unconditionally.
 */
export function reportError(
  message: string,
  error: unknown,
  extra?: Record<string, unknown>
) {
  console.error(`${message}:`, error);
  Sentry.captureException(error, { extra: { message, ...extra } });
}
