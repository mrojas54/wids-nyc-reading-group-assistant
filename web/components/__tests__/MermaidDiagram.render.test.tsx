// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import mermaid from "mermaid";
import { MermaidDiagram } from "../MermaidDiagram";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps authored flowcharts on Dagre with the WiDS base theme after initialization", async () => {
  // Exercise Mermaid's real config resolution: v12 otherwise selects ELK.
  // Only SVG layout is stubbed because jsdom has no getBBox/text measurement.
  mermaid.initialize({ startOnLoad: false });
  vi.spyOn(mermaid, "render").mockResolvedValue({
    svg: '<svg role="img" aria-label="Rendered diagram"></svg>',
    diagramType: "flowchart-v2",
  });

  render(<MermaidDiagram source={"flowchart TD\nA[Input] --> B[Output]"} />);
  await screen.findByRole("img", { name: "Rendered diagram" });

  expect(mermaid.mermaidAPI.getConfig()).toMatchObject({
    layout: "dagre",
    look: "classic",
    theme: "base",
    securityLevel: "strict",
    flowchart: { useMaxWidth: false },
  });
});
