"use client";

import { useEffect, useRef, useState } from "react";

// Note: hex literals duplicated from globals.css because mermaid renders SVG
// strings outside the CSS cascade — var(--color-...) resolves to nothing here.
// If globals.css tokens change, update these too.
const THEME_VARIABLES = {
  primaryColor: "#dde9e1",        // sage-100
  primaryTextColor: "#244338",    // sage-800
  primaryBorderColor: "#467560",  // sage-600
  lineColor: "#a89c81",           // paper-400
  textColor: "#3f3a2e",           // paper-700
  fontFamily: "Geist, system-ui, sans-serif",
};

export function MermaidDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  // One-time initialization. mermaid.initialize mutates global state — only run once per mount.
  useEffect(() => {
    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: THEME_VARIABLES,
      });
    })();
  }, []);

  // Render whenever source changes.
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    (async () => {
      const mermaid = (await import("mermaid")).default;
      try {
        const id = `m-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setErr(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (err) {
    return (
      <pre
        className="text-sm my-4"
        style={{ color: "var(--color-magenta-700)" }}
      >
        Diagram error: {err}
      </pre>
    );
  }
  return <div ref={ref} className="my-4" />;
}
