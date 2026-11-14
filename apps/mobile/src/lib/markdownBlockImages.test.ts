import { describe, expect, it } from "vite-plus/test";
import { parseMarkdown } from "react-native-enriched-markdown/src/web/parseMarkdown";
import { collectBlocks } from "react-native-enriched-markdown/src/web/blockSlots";

import {
  markdownForNativeRendering,
  markdownWithBlockImages,
  parseMarkdownDocument,
  type MarkdownNode,
} from "./markdownDocument";
import { ENRICHED_INLINE_FILE_LINK_REGEX } from "./enrichedLinkPresentation";

async function nativeImageBlocks(markdown: string) {
  const blocks = collectBlocks(await parseMarkdown(markdown)).blocks;
  return blocks.flatMap((block) => (block.kind === "image" ? [block.url] : []));
}

// Everything but images, as a structural outline, so moving images cannot hide other changes.
function outlineWithoutImages(markdown: string): string {
  const outline = (node: MarkdownNode): string => {
    if (node.type === "image" || node.type === "imageReference") return "";
    if (node.type === "paragraph" && node.children.every(isImageOrBlank)) return "";
    // Adjacent text nodes merge once an image between them is gone.
    if (node.type === "text") return node.value.replace(/\u200b/g, "");
    const value = "value" in node ? node.value : "";
    const children = "children" in node ? node.children.map(outline).join("") : "";
    return `${node.type}(${value}${children})`;
  };
  return outline(parseMarkdownDocument(markdown)).replace(/\s+/g, " ");
}

function isImageOrBlank(node: MarkdownNode): boolean {
  return (
    node.type === "image" ||
    node.type === "imageReference" ||
    (node.type === "text" && node.value.replace(/\u200b/g, "").trim() === "")
  );
}

describe("images written inside a line of text", () => {
  it("move below their paragraph so the chat shows a full preview", async () => {
    const markdown =
      "**A**: plastic ![a](/tmp/a.png)\n\n**B**: club ![b](/tmp/b.png) gear\n\n![c](/tmp/c.png) ![d](/tmp/d.png)";
    const output = markdownWithBlockImages(markdown);
    expect(output).toBe(
      "**A**: plastic &#8203;\n\n![a](/tmp/a.png)\n\n**B**: club &#8203; gear\n\n![b](/tmp/b.png)\n\n![c](/tmp/c.png)\n\n![d](/tmp/d.png)",
    );
    expect(await nativeImageBlocks(output)).toEqual([
      "/tmp/a.png",
      "/tmp/b.png",
      "/tmp/c.png",
      "/tmp/d.png",
    ]);
  });

  it("stay inside their list item, task item or blockquote", () => {
    expect(markdownWithBlockImages("- one ![a](a.png)\n- two")).toBe(
      "- one &#8203;\n\n  ![a](a.png)\n- two",
    );
    expect(markdownWithBlockImages("- [ ] one ![a](a.png)")).toBe(
      "- [ ] one &#8203;\n\n  ![a](a.png)",
    );
    expect(markdownWithBlockImages("> quote ![a](a.png) after\n> more")).toBe(
      "> quote &#8203; after\n> more\n>\n> ![a](a.png)",
    );
  });

  it.each([
    "[x]: https://example.com ![a](a.png)",
    "text\n--- ![a](a.png)",
    "see ![a](a.png) >quote",
    "see ![a](a.png) - done",
    "see ![a](a.png) 1. done",
    "see ![a](a.png) [x]: https://example.com",
    "see ![a](a.png) <https://example.com> ***bold*** ```code```",
    "see ![a](a.png) ```one\ntwo```",
    "> quote ![a](a.png) **bold** [link](https://example.com)\n> more",
    "- > item ![a](a.png) after\n  > more",
    "one\\\n![a](a.png) two",
  ])("keep the rest of the Markdown as it was: %s", (markdown) => {
    const output = markdownWithBlockImages(markdown);
    expect(output).not.toBe(markdown);
    expect(outlineWithoutImages(output)).toBe(outlineWithoutImages(markdown));
  });

  it("leave linked badges, table cells, code, math and standalone images alone", () => {
    for (const markdown of [
      "Build [![ci](https://example.com/ci.svg)](https://example.com) passing",
      "| a | b |\n| - | - |\n| x ![a](a.png) | y |",
      "`text ![a](a.png)`",
      "$x ![a](a.png) y$",
      "![a](a.png)",
      "plain text",
    ])
      expect(markdownWithBlockImages(markdown)).toBe(markdown);
  });

  it("still move images next to a dollar sign that is not math", () => {
    expect(markdownWithBlockImages("Price $5 ![a](a.png)")).toBe("Price $5 &#8203;\n\n![a](a.png)");
  });

  it("apply to the chat's native rendering", () => {
    expect(markdownForNativeRendering("A ![a](a.png)", ENRICHED_INLINE_FILE_LINK_REGEX)).toBe(
      "A &#8203;\n\n![a](a.png)",
    );
  });
});
