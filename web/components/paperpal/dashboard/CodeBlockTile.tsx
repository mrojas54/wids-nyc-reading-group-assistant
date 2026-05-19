// Language pill + caption + the shared CodeBlock chrome. We keep one
// CodeSample per tile so each block can have its own caption.

import { CodeBlock } from "@/components/ui/CodeBlock";
import { Tile, TileHeader } from "../primitives";
import type { CodeSample } from "@/lib/paperpal/types";

export function CodeBlockTile({ sample }: { sample: CodeSample }) {
  return (
    <Tile id="section-code" className="pp-col-12 pp-code-tile">
      <TileHeader
        title="Reference implementation"
        right={<span className="pp-code-langpill">{sample.language}</span>}
      />
      {sample.caption && <p className="pp-code-caption">{sample.caption}</p>}
      <CodeBlock code={sample.code} language={sample.language} />
    </Tile>
  );
}
