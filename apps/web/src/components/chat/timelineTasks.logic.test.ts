import { describe, expect, it } from "vite-plus/test";

import {
  applyTimelineOps,
  formatTimelinePercent,
  latestTimelineSummary,
  summarizeTimeline,
  timelineRowWindow,
} from "./timelineTasks.logic";

const PLAN = [
  { op: "add", id: "photo", title: "写真の並べ替え" },
  { op: "add", id: "spec", parent: "photo", title: "仕様の確定", weight: 1 },
  { op: "add", id: "api", parent: "photo", title: "API 層", weight: 3 },
  { op: "add", id: "mutation", parent: "api", title: "位置変更 mutation" },
  { op: "add", id: "unit", parent: "api", title: "単体テスト" },
  { op: "add", id: "ui", parent: "photo", title: "UI: ドラッグ操作", weight: 2, done: [0, 5] },
  { op: "add", id: "e2e", parent: "photo", title: "E2E", weight: 2 },
];

const PROGRESS = [
  { op: "update", id: "spec", status: "completed" },
  { op: "update", id: "mutation", status: "completed" },
  { op: "update", id: "unit", status: "completed" },
  { op: "update", id: "ui", done: [2, 5], note: "並べ替え後の保存まで" },
  { op: "update", id: "e2e", status: "blocked", note: "エミュレータ未起動で止まっている" },
];

const tree = () => applyTimelineOps(applyTimelineOps([], PLAN), PROGRESS);

describe("applyTimelineOps", () => {
  it("adds tasks under their parents with weights", () => {
    const tasks = applyTimelineOps([], PLAN);
    expect(tasks.map((task) => [task.id, task.parent, task.weight])).toEqual([
      ["photo", null, 1],
      ["spec", "photo", 1],
      ["api", "photo", 3],
      ["mutation", "api", 1],
      ["unit", "api", 1],
      ["ui", "photo", 2],
      ["e2e", "photo", 2],
    ]);
  });

  it("sets status from done, and a group's status from its subtasks", () => {
    const tasks = tree();
    const byId = new Map(tasks.map((task) => [task.id, task]));
    expect(byId.get("ui")).toMatchObject({ status: "in_progress", done: [2, 5] });
    expect(byId.get("api")?.status).toBe("completed");
    expect(byId.get("photo")?.status).toBe("in_progress");
    expect(byId.get("e2e")).toMatchObject({
      status: "blocked",
      note: "エミュレータ未起動で止まっている",
    });
  });

  it("skips what the mod refuses and keeps the rest of the call", () => {
    const tasks = applyTimelineOps(applyTimelineOps([], PLAN), [
      { op: "add", id: "spec", title: "duplicate" },
      { op: "add", id: "orphan", parent: "missing" },
      { op: "update", id: "missing", status: "completed" },
      { op: "update", id: "ui", done: [6, 5] },
      { op: "update", id: "spec", weight: 0 },
      { op: "update", id: "api", status: "completed", title: "API" },
      "not an op",
      { op: "update", id: "spec", status: "completed" },
    ]);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    expect(byId.has("orphan")).toBe(false);
    expect(byId.get("spec")).toMatchObject({ title: "仕様の確定", weight: 1, status: "completed" });
    expect(byId.get("ui")?.done).toEqual([0, 5]);
    // A group keeps the status its subtasks make; only the title change lands.
    expect(byId.get("api")).toMatchObject({ title: "API", status: "pending" });
  });

  it("refuses an operation with a malformed field, as the mod does", () => {
    const tasks = applyTimelineOps(applyTimelineOps([], PLAN), [
      { op: "add", id: "n", parent: null },
      { op: "add", id: "w", weight: "3" },
      { op: "add", id: "d", done: [1] },
      { op: "add", id: "s", status: "done" },
      { op: "update", id: "spec", title: 3, status: "completed" },
    ]);
    expect(tasks.map((task) => task.id)).toEqual(PLAN.map((op) => op.id));
    expect(tasks.find((task) => task.id === "spec")?.status).toBe("pending");
  });

  it("drops a task's own units once it gets subtasks", () => {
    const tasks = applyTimelineOps(applyTimelineOps([], PLAN), [
      { op: "add", id: "drag", parent: "ui", title: "drag" },
      { op: "remove", id: "drag" },
    ]);
    expect(tasks.find((task) => task.id === "ui")?.done).toBeUndefined();
  });

  it("removes a task with its subtasks", () => {
    const tasks = applyTimelineOps(applyTimelineOps([], PLAN), [{ op: "remove", id: "api" }]);
    expect(tasks.map((task) => task.id)).toEqual(["photo", "spec", "ui", "e2e"]);
  });

  it("fills every unit when a task is completed", () => {
    const tasks = applyTimelineOps(applyTimelineOps([], PLAN), [
      { op: "update", id: "ui", status: "completed" },
    ]);
    expect(tasks.find((task) => task.id === "ui")?.done).toEqual([5, 5]);
  });
});

describe("summarizeTimeline", () => {
  it("weights siblings and splits the bar by leaf status", () => {
    // Under photo (weights 1+3+2+2 = 8): spec 1 + api 3 done = 4/8, ui 2/5 of 2 = 0.8/8.
    const summary = summarizeTimeline(tree());
    expect(summary.shares.completed).toBeCloseTo(4.8 / 8);
    expect(summary.shares.in_progress).toBeCloseTo(1.2 / 8);
    expect(summary.shares.blocked).toBeCloseTo(2 / 8);
    expect(summary.shares.pending).toBeCloseTo(0);
    expect(summary.leaves).toEqual({ completed: 3, total: 5 });
    expect(summary.current).toEqual({ id: "ui", title: "UI: ドラッグ操作", done: [2, 5] });
    expect(summary.blocked.map((task) => task.id)).toEqual(["e2e"]);
    expect(summary.status).toBe("in_progress");
  });

  it("matches the mod's example: weight 3 done beside weight 1 not started is 75%", () => {
    const summary = summarizeTimeline(
      applyTimelineOps(
        [],
        [
          { op: "add", id: "demo", title: "demo" },
          { op: "add", id: "a", parent: "demo", weight: 3 },
          { op: "add", id: "b", parent: "demo", weight: 1 },
          { op: "update", id: "a", status: "completed" },
        ],
      ),
    );
    expect(summary.shares.completed).toBeCloseTo(0.75);
    expect(summary.status).toBe("in_progress");
    expect(summary.current).toBeNull();
  });

  it("stays below 100% until every task is completed", () => {
    const almost = summarizeTimeline(
      applyTimelineOps(
        [],
        [
          { op: "add", id: "r" },
          { op: "add", id: "a", parent: "r", weight: 1_000_000, status: "completed" },
          { op: "add", id: "b", parent: "r" },
        ],
      ),
    );
    expect(almost.shares.completed).toBeLessThan(1);
    const all = summarizeTimeline(
      applyTimelineOps(
        [],
        [
          { op: "add", id: "r" },
          { op: "add", id: "a", parent: "r", status: "completed" },
        ],
      ),
    );
    expect(all.shares.completed).toBe(1);
    expect(all.status).toBe("completed");
  });

  it("gives each row its depth and its own completed share", () => {
    const rows = summarizeTimeline(tree()).rows;
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

describe("latestTimelineSummary", () => {
  const call = (
    ops: unknown,
    status = "completed",
    toolName = "mcp__timeline__timeline_tasks",
  ) => ({
    type: "dynamic_tool" as const,
    toolName,
    status,
    input: { ops },
  });

  it("replays the finished timeline_tasks calls in order", () => {
    const summary = latestTimelineSummary([
      call(PLAN),
      { type: "assistant_message" as const },
      call(PROGRESS),
      call([{ op: "update", id: "e2e", status: "completed" }], "failed"),
      call([{ op: "remove", id: "photo" }], "completed", "mcp__other__tool"),
      {
        type: "dynamic_tool" as const,
        toolName: "mcp__timeline__timeline_tasks",
        status: "completed",
        input: "x",
      },
    ]);
    expect(summary?.blocked.map((task) => task.id)).toEqual(["e2e"]);
    expect(summary?.leaves).toEqual({ completed: 3, total: 5 });
  });

  it("replays in ordinal order, since older history is appended at the end", () => {
    const summary = latestTimelineSummary([
      { ...call(PROGRESS), ordinal: 2 },
      { ...call(PLAN), ordinal: 1 },
    ]);
    expect(summary?.leaves).toEqual({ completed: 3, total: 5 });
  });

  it("is null without a timeline tree", () => {
    expect(latestTimelineSummary([call([], "completed", "mcp__other__tool")])).toBeNull();
    expect(latestTimelineSummary([call([{ op: "update", id: "x" }])])).toBeNull();
  });
});

describe("formatTimelinePercent", () => {
  it.each([
    { share: 0, expected: "0.0%" },
    { share: 0.625, expected: "62.5%" },
    { share: 0.9999, expected: "99.9%" },
    { share: 1, expected: "100%" },
  ])("shows $share as $expected", ({ share, expected }) => {
    expect(formatTimelinePercent(share)).toBe(expected);
  });
});

describe("timelineRowWindow", () => {
  const rows = (statuses: string) =>
    [...statuses].map((mark) => ({ status: mark === "x" ? "completed" : "pending" }) as const);

  it("shows everything that fits", () => {
    expect(timelineRowWindow(rows("xxp"), 30)).toEqual({ start: 0, end: 3 });
  });

  it("starts just before the first open row when the tree is long", () => {
    expect(timelineRowWindow(rows("xxxxxxxxxxp" + "p".repeat(40)), 30)).toEqual({
      start: 8,
      end: 38,
    });
  });

  it("keeps the last rows when every row is completed", () => {
    expect(timelineRowWindow(rows("x".repeat(40)), 30)).toEqual({ start: 10, end: 40 });
  });
});
