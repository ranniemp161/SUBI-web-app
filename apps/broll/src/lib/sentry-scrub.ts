import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Strips request bodies out of every Sentry event this app sends.
 *
 * **This is the one privacy promise b-roll makes.** AC-22 says the reference
 * photo exists in no blob, no database column and no log line. Today that holds
 * partly by accident, because Sentry was never initialised here at all. Turning
 * it on without this would break the promise silently: a `POST` to the character
 * generate route carries a multipart body containing a photograph of someone's
 * face, and a Sentry event attaching request data would put that face on a third
 * party server. Nothing would fail. Nothing would look wrong.
 *
 * So the body is removed in **two** independent ways: `sendDefaultPii` is left
 * off in every config, and this scrubber deletes the fields anyway. The second
 * is not redundant. It survives an SDK default changing, an integration
 * attaching request data on its own, and someone later switching PII on for a
 * good reason without knowing what rides in this app's request bodies.
 *
 * Pure and exported so it can be tested. An untested privacy guard is a
 * comment.
 */

/** The parts of a Sentry event this needs to see. Kept structural so the test needs no SDK. */
export interface ScrubbableEvent {
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, string> | undefined;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Headers dropped along with the body.
 *
 * `cookie` and `authorization` carry the session, and `content-length` plus
 * `content-type` describe a body that is no longer attached, which is at best
 * misleading in the issue view.
 */
const DROPPED_HEADERS = new Set(["cookie", "authorization", "content-length", "content-type"]);

/**
 * Removes the request body and anything else carrying user content.
 *
 * The URL, method and status stay: they are what makes an issue diagnosable,
 * and none of them can contain a photograph. Query strings are stripped from
 * the URL because b-roll mints signed asset URLs whose query carries a token.
 */
export function scrubRequestBody<T extends ScrubbableEvent>(event: T): T {
  if (!event.request) return event;

  const request = { ...event.request };

  delete request.data;
  delete request.cookies;

  if (typeof request.url === "string") {
    const queryStart = request.url.indexOf("?");
    if (queryStart !== -1) request.url = request.url.slice(0, queryStart);
  }
  // `query_string` is a separate field the SDK may set on its own.
  delete request.query_string;

  if (request.headers) {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (!DROPPED_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    request.headers = headers;
  }

  return { ...event, request };
}

/**
 * `beforeSend` in the shape the SDK expects.
 *
 * The scrubber itself stays structural and SDK free so the tests need no Sentry
 * import; this is the thin adapter onto the real event type.
 */
export function beforeSendScrub(event: ErrorEvent): ErrorEvent {
  return scrubRequestBody(event as unknown as ScrubbableEvent) as unknown as ErrorEvent;
}

/**
 * The options every Sentry init in this app shares.
 *
 * Exported as one object so the server, edge and client configs cannot drift
 * into three different privacy postures.
 */
export const SHARED_SENTRY_OPTIONS = {
  /**
   * Off explicitly, not by default. With it on, the SDK attaches request bodies
   * and headers, which for this app means a face photo.
   */
  sendDefaultPii: false,
  beforeSend: beforeSendScrub,
} as const;

/**
 * Server only additions.
 *
 * `maxRequestBodySize` is a Node option and does not exist on the browser or
 * edge configs, which is fine: request bodies are collected server side. It is
 * belt and braces with the scrubber, stopping the body being collected at all
 * rather than only stopping it being sent.
 */
export const SERVER_SENTRY_OPTIONS = {
  ...SHARED_SENTRY_OPTIONS,
  maxRequestBodySize: "none",
} as const;
