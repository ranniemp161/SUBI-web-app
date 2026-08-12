import { describe, expect, it } from "vitest";
import { SERVER_SENTRY_OPTIONS, SHARED_SENTRY_OPTIONS, scrubRequestBody, beforeSendScrub } from "./sentry-scrub";

describe("scrubRequestBody", () => {
  it("removes the request body, which is where the face photo would be", () => {
    // The exact shape that matters: a multipart POST to the generate route.
    const event = scrubRequestBody({
      request: {
        method: "POST",
        url: "https://broll.example/api/projects/abc/character",
        data: "------WebKitFormBoundary\r\nContent-Disposition: form-data; name=\"photo\"\r\n\r\n<jpeg bytes>",
      },
    });
    expect(event.request?.data).toBeUndefined();
    expect("data" in (event.request ?? {})).toBe(false);
  });

  it("keeps what makes an issue diagnosable", () => {
    const event = scrubRequestBody({
      request: { method: "POST", url: "https://broll.example/api/x", data: "secret" },
    });
    expect(event.request?.method).toBe("POST");
    expect(event.request?.url).toBe("https://broll.example/api/x");
  });

  it("drops cookies and the authorization header", () => {
    const event = scrubRequestBody({
      request: {
        url: "https://broll.example/api/x",
        cookies: { __session: "a-clerk-session" },
        headers: {
          Cookie: "__session=a-clerk-session",
          Authorization: "Bearer token",
          "User-Agent": "Chrome",
        },
      },
    });
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({ "User-Agent": "Chrome" });
  });

  it("drops content headers describing a body that is no longer attached", () => {
    const event = scrubRequestBody({
      request: {
        url: "https://broll.example/api/x",
        headers: { "Content-Type": "multipart/form-data", "Content-Length": "4200000" },
      },
    });
    expect(event.request?.headers).toEqual({});
  });

  it("strips the query string, because signed asset URLs carry a token there", () => {
    const event = scrubRequestBody({
      request: {
        url: "https://store.example/broll/p/neutral.png?token=abc123&expires=999",
        query_string: "token=abc123",
      },
    });
    expect(event.request?.url).toBe("https://store.example/broll/p/neutral.png");
    expect(event.request?.query_string).toBeUndefined();
  });

  it("leaves an event with no request alone", () => {
    const event = { message: "something broke" };
    expect(scrubRequestBody(event)).toEqual(event);
  });

  it("does not mutate the event it was given", () => {
    // Sentry may reuse the object; mutating it in place is a good way to make
    // an unrelated integration see a half scrubbed event.
    const original = {
      request: { url: "https://broll.example/x", data: "photo bytes" },
    };
    const copy = JSON.parse(JSON.stringify(original));
    scrubRequestBody(original);
    expect(original).toEqual(copy);
  });

  it("preserves everything outside the request", () => {
    const event = scrubRequestBody({
      message: "generate failed",
      tags: { route: "character" },
      request: { url: "https://broll.example/x", data: "photo" },
    });
    expect(event.message).toBe("generate failed");
    expect(event.tags).toEqual({ route: "character" });
  });
});

describe("SHARED_SENTRY_OPTIONS", () => {
  it("keeps PII off and request bodies uncollected", () => {
    // Both of these are load bearing, and both are easy to flip on later for a
    // reason that seems good if you do not know what rides in this app's bodies.
    expect(SHARED_SENTRY_OPTIONS.sendDefaultPii).toBe(false);
    expect(SERVER_SENTRY_OPTIONS.sendDefaultPii).toBe(false);
    // Node only option, which is why it lives on the server variant.
    expect(SERVER_SENTRY_OPTIONS.maxRequestBodySize).toBe("none");
  });

  it("scrubs as well as not collecting, so one switch flipping is not enough", () => {
    expect(SHARED_SENTRY_OPTIONS.beforeSend).toBe(beforeSendScrub);
    expect(SERVER_SENTRY_OPTIONS.beforeSend).toBe(beforeSendScrub);
    // The adapter must actually scrub, not merely be wired up.
    const scrubbed = beforeSendScrub({
      request: { url: "https://broll.example/x", data: "photo bytes" },
    } as never) as unknown as { request?: { data?: unknown } };
    expect(scrubbed.request?.data).toBeUndefined();
  });
});
