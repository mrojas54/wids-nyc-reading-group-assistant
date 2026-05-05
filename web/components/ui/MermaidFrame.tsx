import * as React from "react";

export type MermaidFrameProps = {
  caption?: React.ReactNode;
  children: React.ReactNode;
};

export function MermaidFrame({ caption, children }: MermaidFrameProps) {
  return (
    <figure className="mermaid-figure">
      <div className="mermaid-frame">{children}</div>
      {caption && <figcaption className="mermaid-cap">{caption}</figcaption>}
    </figure>
  );
}
