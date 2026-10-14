import { afterEach, expect, it, vi } from "vitest";
import { geminiHint, geminiSocratic } from "../gemini";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses the supported Flash model for hints and tutor turns", async () => {
  vi.stubEnv("GEMINI_API_KEY", "fixture-key");
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("gemini-2.5-flash")) return Response.json({error:{message:"model retired"}}, {status:404});
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({hint:"Consider the bound.",nextQuestion:"What does the bound cover?",confidence:"high"})}]}}]});
  });
  vi.stubGlobal("fetch", fetchMock);
  const hint = await geminiHint({paperTitle:"T",questionText:"Q?",userAnswer:"A"},{provider:"gemini"});
  const tutor = await geminiSocratic({paperTitle:"T",promptTopic:"Bounds",openingQuestion:"What is bounded?",userResponse:"The error",turnNumber:1,history:[],scriptedProbes:[]},{provider:"gemini"});
  expect(hint.hint).toBe("Consider the bound.");
  expect(tutor.nextQuestion).toBe("What does the bound cover?");
  expect(hint.meta.model).toBe("gemini-3.8-flash");
  expect(tutor.meta.model).toBe("gemini-3.8-flash");
});
