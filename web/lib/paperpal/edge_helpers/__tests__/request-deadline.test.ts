import { afterEach, expect, it, vi } from "vitest";
import { requestDeadline, withDeadline } from "../request-deadline";

afterEach(() => { vi.useRealTimers(); });

it("caps the provider budget and does not extend a shorter client budget", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const request = (value: string) => new Request("https://fixture.test", { headers: { "x-paperpal-timeout-ms": value } });
  expect(requestDeadline(request("999999"))).toBe(25_000);
  expect(requestDeadline(request("5000"))).toBe(5_000);
  expect(requestDeadline(request("-1"))).toBe(0);
  expect(requestDeadline(request("invalid"))).toBe(25_000);
});

it("aborts an unsettled provider and blocks a late transcript write", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const provider = new Promise<void>(r => { resolve = r; });
  const insert = vi.fn();
  let signal!: AbortSignal;
  const result = withDeadline(Date.now() + 25_000, new AbortController().signal, async active => {
    signal = active;
    await provider;
    active.throwIfAborted();
    insert();
  });
  const rejected = expect(result).rejects.toThrow("request_cancelled");
  await vi.advanceTimersByTimeAsync(25_000);
  await rejected;
  expect(signal.aborted).toBe(true);
  resolve();
  await Promise.resolve();
  expect(insert).not.toHaveBeenCalled();
});

it("does not start a provider after the gate has consumed the budget", async () => {
  const operation = vi.fn();
  await expect(withDeadline(Date.now() - 1, new AbortController().signal, operation)).rejects.toThrow("request_expired");
  expect(operation).not.toHaveBeenCalled();
});

it("propagates caller cancellation and clears its timer", async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  let signal!: AbortSignal;
  const result = withDeadline(Date.now() + 25_000, parent.signal, async active => {
    signal = active;
    return new Promise(() => {});
  });
  const rejected = expect(result).rejects.toThrow("request_cancelled");
  parent.abort();
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
