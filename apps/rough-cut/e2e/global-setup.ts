/**
 * Fails the run immediately if the target is not actually serving the app.
 *
 * Vercel preview deployments sit behind Deployment Protection, which answers
 * *every* path with a 302 to vercel.com/sso-api. A browser follows that to a
 * login page that returns 200, so any test asserting only "status < 400" will
 * happily pass against Vercel's login screen while testing nothing at all.
 *
 * This guard turns that silent false-pass into one loud, actionable failure.
 */

const PROTECTION_HOSTS = ["vercel.com/sso", "vercel.com/login"];

export default async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  const headers: Record<string, string> = bypassSecret
    ? {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      }
    : {};

  let response: Response;
  try {
    response = await fetch(baseURL, { headers, redirect: "manual" });
  } catch (cause) {
    throw new Error(
      `Could not reach ${baseURL}. Is the target up?\n${String(cause)}`
    );
  }

  const location = response.headers.get("location") ?? "";
  const isProtectionRedirect = PROTECTION_HOSTS.some((host) =>
    location.includes(host)
  );

  if (isProtectionRedirect) {
    throw new Error(
      [
        `${baseURL} is behind Vercel Deployment Protection.`,
        `It redirected to: ${location.slice(0, 120)}…`,
        "",
        bypassSecret
          ? "VERCEL_AUTOMATION_BYPASS_SECRET is set but was not accepted — it is"
            + " probably stale. Regenerate it in the Vercel project:"
          : "VERCEL_AUTOMATION_BYPASS_SECRET is NOT set. Add it as a repository"
            + " secret, taking the value from the Vercel project:",
        "  Settings -> Deployment Protection -> Protection Bypass for Automation",
        "",
        "Refusing to run: every request would hit Vercel's login page, and the",
        "suite would report green while asserting nothing about the app.",
      ].join("\n")
    );
  }
}
