import { describe, expect, it } from "vitest";
import { z } from "zod";
import { knownErrorResponse } from "../route-errors";
import {
  ForbiddenError,
  ModelLoadError,
  S2AuthError,
  S2RequestError,
  TimeoutError,
  UnauthorizedError,
} from "../types";

describe("knownErrorResponse", () => {
  it.each([
    [new UnauthorizedError(), 401, "unauthorized"],
    [new ForbiddenError(), 403, "forbidden"],
    [new S2AuthError("s2 401"), 502, "s2_auth"],
    [new S2RequestError("s2 400"), 502, "s2_request"],
  ])("maps %s", (err, status, code) => {
    expect(knownErrorResponse(err)).toEqual({ code, status, body: { error: code } });
  });

  it("includes the zod issues for a bad request", () => {
    const err = z.object({ a: z.number() }).safeParse({}).error;
    const known = knownErrorResponse(err);
    expect(known).toMatchObject({ code: "invalid_request", status: 400 });
    expect(known?.body.issues).toEqual(err?.issues);
  });

  it("includes the detail for a model load failure", () => {
    expect(knownErrorResponse(new ModelLoadError("blob 403"))).toEqual({
      code: "wasm_model_load_failed",
      status: 502,
      body: { error: "wasm_model_load_failed", detail: "blob 403" },
    });
  });

  it.each([new TimeoutError(), new Error("boom"), "string"])("leaves %s to the route", (err) => {
    expect(knownErrorResponse(err)).toBeNull();
  });
});
