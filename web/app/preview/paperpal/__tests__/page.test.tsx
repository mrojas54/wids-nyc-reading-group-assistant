import { afterEach, expect, it, vi } from "vitest";
import PreviewPage from "../page";

const request = vi.hoisted(() => ({ host: "fixture-deployment.vercel.app" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: request.host }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("../PreviewHarness", () => ({ PreviewHarness: () => null }));
afterEach(() => { vi.unstubAllEnvs(); request.host = "fixture-deployment.vercel.app"; });

it("rejects the page independently of proxy in production", async () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_URL", request.host);
  await expect(PreviewPage({ searchParams: Promise.resolve({ mode: "tutor", run: "123" }) })).rejects.toThrow("404");
});

it("rejects production aliases independently of proxy", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_URL", "fixture-deployment.vercel.app");
  request.host = "members.example.com";
  await expect(PreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
});

it("renders a validated fixture and the exact deployment commit", async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_URL", request.host);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "exact-preview-commit");
  const page = await PreviewPage({ searchParams: Promise.resolve({ run: "123", mode: "tutor" }) });
  expect(page.props).toEqual({ run: "123", mode: "tutor", commit: "exact-preview-commit" });
  const fallback = await PreviewPage({ searchParams: Promise.resolve({ run: "../../40", mode: "live" }) });
  expect(fallback.props).toMatchObject({ run: "1", mode: "quiz" });
});
