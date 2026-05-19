// Shared PDF download + base64 encoding for the Gemini and Claude
// providers. Lives here (not in gemini.ts) because the Claude path also
// needs it: passing a short-lived signed URL as Anthropic's `source.type:
// "url"` document risks the URL expiring before Anthropic's fetcher
// reaches it, especially when the API is queued. Base64 means the URL
// is consumed once, by us, immediately after minting.

export async function fetchPdfAsBase64(pdfUrl: string): Promise<string> {
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`pdf fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

// Exported for tests; the chunking exists to avoid "Maximum call stack
// size exceeded" when spreading a multi-MB Uint8Array into
// String.fromCharCode. Chunk size 0x8000 is what MDN's binary-string
// example uses and is comfortably under the V8 spread-arg limit.
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(sub) as number[]);
  }
  return btoa(binary);
}
