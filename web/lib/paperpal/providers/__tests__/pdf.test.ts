// arrayBufferToBase64 chunking tests — the chunking exists explicitly
// to avoid "Maximum call stack size exceeded" when spreading a multi-MB
// Uint8Array. The PR1 dispatch test only exercises an 8-byte buffer,
// nowhere near the 32 KB chunk boundary; these tests fill the gap.
import { describe, it, expect } from "vitest";
import { arrayBufferToBase64 } from "../pdf";

function makeBuffer(size: number, fill: (i: number) => number): ArrayBuffer {
  const arr = new Uint8Array(size);
  for (let i = 0; i < size; i++) arr[i] = fill(i) & 0xff;
  return arr.buffer;
}

function roundTrip(buf: ArrayBuffer): Uint8Array {
  const b64 = arrayBufferToBase64(buf);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

describe("arrayBufferToBase64", () => {
  it("round-trips an 8-byte buffer (sanity)", () => {
    const buf = makeBuffer(8, (i) => i);
    const out = roundTrip(buf);
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("round-trips a buffer exactly at the 32 KB chunk boundary", () => {
    const size = 0x8000;
    const buf = makeBuffer(size, (i) => i * 7);
    const out = roundTrip(buf);
    expect(out.length).toBe(size);
    for (let i = 0; i < size; i++) {
      expect(out[i]).toBe((i * 7) & 0xff);
    }
  });

  it("round-trips a buffer that straddles one chunk boundary (32 KB + 1)", () => {
    const size = 0x8000 + 1;
    const buf = makeBuffer(size, (i) => i * 13);
    const out = roundTrip(buf);
    expect(out.length).toBe(size);
    expect(out[size - 1]).toBe(((size - 1) * 13) & 0xff);
  });

  it("round-trips a multi-chunk buffer (256 KB) without losing bytes", () => {
    // 8 chunks worth — well above the spread-arg limit that the
    // chunking is meant to dodge.
    const size = 0x8000 * 8;
    const buf = makeBuffer(size, (i) => i);
    const out = roundTrip(buf);
    expect(out.length).toBe(size);
    // Spot-check first/last and a random middle byte.
    expect(out[0]).toBe(0);
    expect(out[12345]).toBe(12345 & 0xff);
    expect(out[size - 1]).toBe((size - 1) & 0xff);
  });

  it("returns an empty string for a zero-length buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });
});
