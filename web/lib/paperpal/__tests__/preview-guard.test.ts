import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const createClient = vi.hoisted(() => vi.fn(() => { throw new Error("Preview must not access Supabase"); }));
vi.mock("@supabase/ssr", () => ({ createServerClient: createClient }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("preview harness boundary", () => {
  it.each(["production", "development", ""])("returns 404 in %s before looking up a session", async environment => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("VERCEL_URL", "fixture-deployment.vercel.app");
    const result = await proxy(new NextRequest("https://fixture-deployment.vercel.app/preview/paperpal", { headers: { host: "fixture-deployment.vercel.app" } }));
    expect(result.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["members.example.com", "wids-nyc-reading-group-assistant.vercel.app", "fixture-deployment.vercel.app.attacker.example"])("rejects production or unrelated host %s even for a promoted preview build", async host => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "fixture-deployment.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "fixture-git-storage.vercel.app");
    const result = await proxy(new NextRequest(`https://${host}/preview/paperpal`, { headers: { host } }));
    expect(result.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["fixture-deployment.vercel.app", "fixture-git-storage.vercel.app"])("serves only preview host %s with connections blocked", async host => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "fixture-deployment.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "fixture-git-storage.vercel.app");
    const result = await proxy(new NextRequest(`https://${host}/preview/paperpal`, { headers: { host } }));
    expect(result.status).toBe(200);
    expect(result.headers.get("Content-Security-Policy")).toContain("connect-src 'none'");
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(result.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(createClient).not.toHaveBeenCalled();
  });
});
