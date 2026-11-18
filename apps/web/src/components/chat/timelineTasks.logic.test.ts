import { describe, expect, it } from "vite-plus/test";

import {
  latestTimelineSummary,
  parseTimelineTree,
  summarizeTimeline,
  timelineToolOutputText,
} from "./timelineTasks.logic";

const TREE = [
  "- [>] photo: 写真の並べ替え (w=1)",
  "  - [x] spec: 仕様の確定 (w=1)",
  "  - [x] api: API 層 (w=3)",
  "    - [x] mutation: 位置変更 mutation (w=1)",
  "    - [x] unit: 単体テスト (w=1)",
  "  - [>] ui: UI: ドラッグ操作 (w=2, 2/5 done) — 並べ替え後の保存まで",
  "  - [!] e2e: E2E (w=2) — エミュレータ未起動で止まっている",
  "Progress: 57.14%",
].join("\n");

describe("parseTimelineTree", () => {
  it("reads ids, parents, statuses, weights, units and notes", () => {
    const tasks = parseTimelineTree(TREE);
    expect(tasks).toHaveLength(7);
    expect(tasks[0]).toEqual({
      id: "photo",
      parent: null,
      title: "写真の並べ替え",
      status: "in_progress",
      weight: 1,
    });
    expect(tasks[3]).toMatchObject({ id: "mutation", parent: "api", status: "completed" });
    expect(tasks[5]).toEqual({
      id: "ui",
      parent: "photo",
      title: "UI: ドラッグ操作",
      status: "in_progress",
      weight: 2,
      done: [2, 5],
      note: "並べ替え後の保存まで",
    });
    expect(tasks[6]).toMatchObject({
      id: "e2e",
      status: "blocked",
      note: "エミュレータ未起動で止まっている",
    });
  });

  it("returns nothing for an empty tree or other text", () => {
    expect(parseTimelineTree("(no tasks)\nProgress: 0.00%")).toEqual([]);
    expect(parseTimelineTree("Error: ops must be an array of task operations.")).toEqual([]);
  });

  it("keeps a sibling under the nearest shallower task", () => {
    const tasks = parseTimelineTree(
      ["- [ ] a: A (w=1)", "  - [ ] b: B (w=1)", "    - [ ] c: C (w=1)", "  - [ ] d: D (w=1)"].join(
        "\n",
      ),
    );
    expect(tasks.map((task) => [task.id, task.parent])).toEqual([
      ["a", null],
      ["b", "a"],
      ["c", "b"],
      ["d", "a"],
    ]);
  });
});

describe("summarizeTimeline", () => {
  it("weights siblings and splits the bar by leaf status", () => {
    // Under photo (weights 1+3+2+2 = 8): spec 1 + api 3 done = 4/8, ui 2/5 of 2 = 0.8/8.
    const summary = summarizeTimeline(parseTimelineTree(TREE));
    expect(summary.shares.completed).toBeCloseTo(4.8 / 8);
    expect(summary.shares.in_progress).toBeCloseTo(1.2 / 8);
    expect(summary.shares.blocked).toBeCloseTo(2 / 8);
    expect(summary.shares.pending).toBeCloseTo(0);
    expect(summary.leaves).toEqual({ completed: 3, total: 5 });
    expect(summary.current).toEqual({ id: "ui", title: "UI: ドラッグ操作", done: [2, 5] });
    expect(summary.blocked.map((task) => task.id)).toEqual(["e2e"]);
    expect(summary.status).toBe("in_progress");
  });

  it("matches the plugin's example: weight 3 done beside weight 1 not started is 75%", () => {
    const summary = summarizeTimeline(
      parseTimelineTree(
        ["- [>] demo: demo (w=1)", "  - [x] a: a (w=3)", "  - [ ] b: b (w=1)"].join("\n"),
      ),
    );
    expect(summary.shares.completed).toBeCloseTo(0.75);
    expect(summary.status).toBe("in_progress");
    expect(summary.current).toBeNull();
  });

  it("stays below 100% until every task is completed", () => {
    const almost = summarizeTimeline(
      parseTimelineTree(
        ["- [>] r: r (w=1)", "  - [x] a: a (w=1000000)", "  - [ ] b: b (w=1)"].join("\n"),
      ),
    );
    expect(almost.shares.completed).toBeLessThan(1);
    const all = summarizeTimeline(
      parseTimelineTree(["- [x] r: r (w=1)", "  - [x] a: a (w=1)"].join("\n")),
    );
    expect(all.shares.completed).toBe(1);
    expect(all.status).toBe("completed");
  });

  it("gives each row its depth and its own completed share", () => {
    const rows = summarizeTimeline(parseTimelineTree(TREE)).rows;
    expect(rows.map((row) => [row.task.id, row.depth])).toEqual([
      ["photo", 0],
      ["spec", 1],
      ["api", 1],
      ["mutation", 2],
      ["unit", 2],
      ["ui", 1],
      ["e2e", 1],
    ]);
    expect(rows.find((row) => row.task.id === "ui")?.completed).toBeCloseTo(0.4);
    expect(rows.find((row) => row.task.id === "api")?.status).toBe("completed");
  });
});

describe("timelineToolOutputText", () => {
  it.each([
    { output: "tree", expected: "tree" },
    { output: { content: "tree" }, expected: "tree" },
    {
      output: {
        content: [
          { type: "text", text: "tr" },
          { type: "text", text: "ee" },
        ],
      },
      expected: "tree",
    },
    { output: [{ type: "text", text: "tree" }], expected: "tree" },
    { output: { content: [{ type: "image" }] }, expected: null },
    { output: undefined, expected: null },
  ])("reads $output", ({ output, expected }) => {
    expect(timelineToolOutputText(output)).toBe(expected);
  });
});

describe("latestTimelineSummary", () => {
  const call = (toolName: string, output: unknown, status = "completed") => ({
    type: "dynamic_tool" as const,
    toolName,
    status,
    output,
  });

  it("reads the newest completed timeline call with a tree", () => {
    const summary = latestTimelineSummary([
      call("mcp__timeline__timeline_tasks", { content: "- [ ] old: old (w=1)" }),
      call("mcp__timeline__timeline_read", { content: "- [>] new: new (w=1, 1/2 done)" }),
      call("mcp__timeline__timeline_tasks", { content: "Error: ops must be an array." }),
      call("mcp__timeline__timeline_tasks", undefined, "running"),
      call("mcp__other__tool", { content: "- [x] other: other (w=1)" }),
      { type: "assistant_message" as const },
    ]);
    expect(summary?.rows.map((row) => row.task.id)).toEqual(["new"]);
  });

  it("is null without a timeline call", () => {
    expect(latestTimelineSummary([call("mcp__other__tool", { content: "x" })])).toBeNull();
  });
});
