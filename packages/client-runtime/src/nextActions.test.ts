import { describe, expect, it } from "vite-plus/test";

import { splitNextActions } from "./nextActions.js";

const block = (json: string) => "Done.\n\n```next\n" + json + "\n```\n";

describe("splitNextActions", () => {
  it("takes a trailing next block off the message and reads its actions", () => {
    expect(
      splitNextActions(
        block(
          '[{"label":"Open a PR","prompt":"Open a PR for this branch","reason":"Tests pass"},{"label":"Stop","prompt":"Stop here"}]',
        ),
      ),
    ).toEqual({
      markdown: "Done.",
      actions: [
        { label: "Open a PR", prompt: "Open a PR for this branch", reason: "Tests pass" },
        { label: "Stop", prompt: "Stop here" },
      ],
    });
  });

  it.each([
    ["no block", "Done.\n\n```ts\nconst a = 1;\n```"],
    ["a block followed by more text", "```next\n[]\n```\n\nMore text"],
    ["invalid JSON", block("[{label: 1}]")],
  ])("leaves the message alone for %s", (_name, text) => {
    expect(splitNextActions(text)).toEqual({ markdown: text, actions: [] });
  });

  it("hides a block that is still streaming", () => {
    expect(splitNextActions('Done.\n\n```next\n[{"label":"Op')).toEqual({
      markdown: "Done.",
      actions: [],
    });
  });

  it("keeps at most three well-formed actions", () => {
    const actions = [
      { label: "A", prompt: "a" },
      { label: "", prompt: "empty label" },
      { label: "B", prompt: "  " },
      { label: "C", prompt: "c", reason: 4 },
      { label: "D", prompt: "d" },
      { label: "E", prompt: "e" },
    ];
    expect(splitNextActions(block(JSON.stringify(actions))).actions).toEqual([
      { label: "A", prompt: "a" },
      { label: "C", prompt: "c" },
      { label: "D", prompt: "d" },
    ]);
  });
});
