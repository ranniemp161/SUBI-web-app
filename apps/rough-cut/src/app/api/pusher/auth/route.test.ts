import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  clerkId: "clerk_1" as string | null,
  dbUser: { id: "db-user-1" } as { id: string } | null,
  rateAllowed: true,
  ownedProject: { id: "11111111-2222-3333-4444-555555555555" } as {
    id: string;
  } | null,
  authorized: [] as Array<{ socketId: string; channel: string }>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: state.clerkId })),
}));

vi.mock("@/lib/authz", () => ({
  getAuthorizedDbUser: vi.fn(async () => state.dbUser),
}));

vi.mock("@/lib/projects", () => ({
  getOwnedProject: vi.fn(async () => state.ownedProject),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({
    allowed: state.rateAllowed,
    remaining: state.rateAllowed ? 119 : 0,
    limit: 120,
  })),
}));

vi.mock("@/lib/pusher", () => ({
  projectChannel: (projectId: string) => `private-${projectId}`,
  pusherServer: {
    authorizeChannel: vi.fn((socketId: string, channel: string) => {
      state.authorized.push({ socketId, channel });
      return { auth: `signed:${socketId}:${channel}` };
    }),
  },
}));

import { POST } from "./route";
import { getOwnedProject } from "@/lib/projects";
import { rateLimit } from "@/lib/rate-limit";
import { pusherServer } from "@/lib/pusher";

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

function req({
  socketId = "123.456",
  channel = `private-${PROJECT_ID}`,
}: { socketId?: string | null; channel?: string | null } = {}) {
  const form = new URLSearchParams();
  if (socketId !== null) form.set("socket_id", socketId);
  if (channel !== null) form.set("channel_name", channel);
  return new Request("http://localhost/api/pusher/auth", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

beforeEach(() => {
  state.clerkId = "clerk_1";
  state.dbUser = { id: "db-user-1" };
  state.rateAllowed = true;
  state.ownedProject = { id: PROJECT_ID };
  state.authorized = [];
  vi.clearAllMocks();
});

describe("POST /api/pusher/auth", () => {
  it("countersigns a private channel the session's user owns", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      auth: `signed:123.456:private-${PROJECT_ID}`,
    });
    expect(getOwnedProject).toHaveBeenCalledWith(PROJECT_ID, "clerk_1");
  });

  it("401 with no session", async () => {
    state.clerkId = null;
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });

  it("403 when the user has no provisioned users row", async () => {
    state.dbUser = null;
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });

  it("429 once the per-user limit is exceeded", async () => {
    state.rateAllowed = false;
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("pusher-auth:clerk_1", 120, 300);
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });

  it("404 for a project the user does not own — indistinguishable from a missing one", async () => {
    state.ownedProject = null;
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });

  it.each([
    ["bare project id (no private- prefix)", PROJECT_ID],
    ["presence channel", `presence-${PROJECT_ID}`],
    ["non-uuid suffix", "private-not-a-uuid"],
    ["trailing junk after the uuid", `private-${PROJECT_ID}x`],
  ])("400 on a malformed channel_name: %s", async (_label, channel) => {
    const res = await POST(req({ channel }));
    expect(res.status).toBe(400);
    expect(getOwnedProject).not.toHaveBeenCalled();
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });

  it("400 on a malformed socket_id", async () => {
    const res = await POST(req({ socketId: "not-a-socket" }));
    expect(res.status).toBe(400);
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });

  it("400 when the form fields are missing entirely", async () => {
    const res = await POST(req({ socketId: null, channel: null }));
    expect(res.status).toBe(400);
    expect(pusherServer.authorizeChannel).not.toHaveBeenCalled();
  });
});
