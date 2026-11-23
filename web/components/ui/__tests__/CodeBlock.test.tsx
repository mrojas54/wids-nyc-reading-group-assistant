import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock } from "../CodeBlock";

it("highlights Python rows and links to Colab", () => {
  const html = renderToStaticMarkup(
    <CodeBlock code={"import torch\nx = torch.zeros(3)\n\n"} notebookHref="https://colab.example/n" />,
  );
  expect(html).toContain('<span class="cb-lang">python</span>');
  expect(html).toContain('href="https://colab.example/n"');
  // Trailing blank lines are dropped: two rows.
  expect(html.match(/class="cb-row"/g)).toHaveLength(2);
  expect(html).toContain(
    '<span class="cb-row"><span class="cb-ln">1</span><span class="cb-kw">import</span> torch</span>',
  );
  expect(html).toContain('<span class="cb-prop">zeros</span>');
  expect(html).toContain('<span class="cb-num">3</span>');
});

it("shows other languages as plain text", () => {
  const html = renderToStaticMarkup(<CodeBlock code="const x = 1;" language="typescript" />);
  expect(html).toContain('<span class="cb-ln">1</span>const x = 1;</span>');
  expect(html).not.toContain("cb-link");
});
