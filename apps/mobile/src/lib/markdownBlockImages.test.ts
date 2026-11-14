import { describe, expect, it } from "vite-plus/test";
import { parseMarkdown } from "react-native-enriched-markdown/src/web/parseMarkdown";
import { collectBlocks } from "react-native-enriched-markdown/src/web/blockSlots";

import { markdownForNativeRendering, markdownWithBlockImages } from "./markdownDocument";
import { ENRICHED_INLINE_FILE_LINK_REGEX } from "./enrichedLinkPresentation";

async function nativeImageBlocks(markdown: string) {
  const blocks = collectBlocks(await parseMarkdown(markdown)).blocks;
  return blocks.flatMap((block) => (block.kind === "image" ? [block.url] : []));
}

describe("images written inside a line of text", () => {
  it("become their own blocks so the chat shows a full preview", async () => {
    const markdown =
      "**A**: plastic ![a](/tmp/a.png)\n\n**B**: club ![b](/tmp/b.png) gear\n\n![c](/tmp/c.png) ![d](/tmp/d.png)";
    const output = markdownWithBlockImages(markdown);
    expect(output).toBe(
      "**A**: plastic\n\n![a](/tmp/a.png)\n\n**B**: club\n\n![b](/tmp/b.png)\n\ngear\n\n![c](/tmp/c.png)\n\n![d](/tmp/d.png)",
    );
    expect(await nativeImageBlocks(output)).toEqual([
      "/tmp/a.png",
      "/tmp/b.png",
      "/tmp/c.png",
      "/tmp/d.png",
    ]);
  });

  it("keep their list item and blockquote containers", () => {
    expect(markdownWithBlockImages("- one ![a](a.png)\n- two")).toBe(
      "- one\n\n  ![a](a.png)\n- two",
    );
    expect(markdownWithBlockImages("> quote ![a](a.png)\n> more")).toBe(
      "> quote\n>\n> ![a](a.png)\n>\n> more",
    );
  });

  it("escape text that would start a block once it begins a line", () => {
    expect(markdownWithBlockImages("see ![a](a.png) **bold** after")).toBe(
      "see\n\n![a](a.png)\n\n**bold** after",
    );
    expect(markdownWithBlockImages("see ![a](a.png) - done")).toBe(
      "see\n\n![a](a.png)\n\n\\- done",
    );
    expect(markdownWithBlockImages("see ![a](a.png) 1. done")).toBe(
      "see\n\n![a](a.png)\n\n1\\. done",
    );
  });

  it("leave linked badges, table cells, code and standalone images alone", () => {
    for (const markdown of [
      "Build [![ci](https://example.com/ci.svg)](https://example.com) passing",
      "| a | b |\n| - | - |\n| x ![a](a.png) | y |",
      "`text ![a](a.png)`",
      "![a](a.png)",
      "plain text",
    ])
      expect(markdownWithBlockImages(markdown)).toBe(markdown);
  });

  it("apply to the chat's native rendering", () => {
    expect(markdownForNativeRendering("A ![a](a.png)", ENRICHED_INLINE_FILE_LINK_REGEX)).toBe(
      "A\n\n![a](a.png)",
    );
  });
});
