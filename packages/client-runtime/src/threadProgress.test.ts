import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { progressPercentLabel, sameThreadProgress, threadProgress } from "./threadProgress.ts";
import { v2ThreadShell } from "./state/orchestrationV2TestFixtures.ts";

const childId = ThreadId.make("thread:child");
const runId = RunId.make("run:latest");
const childRunId = RunId.make("run:child");
const childTodo = { runId: childRunId, completed: 1, total: 4, current: "Fix", steps: [] };
const childShell = {
  ...v2ThreadShell,
  id: childId,
  latestRunId: childRunId,
  todoProgress: childTodo,
};
const todo = {
  runId,
  completed: 1,
  total: 3,
  current: "Fix the bug",
  steps: [
    { text: "Read the code", status: "completed" },
    { text: "Fix the bug", status: "running" },
    { text: "Test", status: "pending" },
  ],
} as const;
const childWork = {
  runId,
  finished: 1,
  total: 2,
  children: [
    { threadId: childId, title: "Child", finished: false },
    { threadId: null, title: "Native", finished: true },
  ],
};
const timelineTasks = [
  { id: "goal", parent: null, title: "Goal", status: "in_progress", weight: 1 },
  { id: "a", parent: "goal", title: "A", status: "completed", weight: 1 },
  { id: "b", parent: "goal", title: "B", status: "blocked", weight: 1, note: "waiting" },
] as const;
const shell = (fields: object) => ({
  ...v2ThreadShell,
  latestRunId: runId,
  todoProgress: null,
  childWork: null,
  timelineTasks: null,
  ...fields,
});
const titles = (progress: ReturnType<typeof threadProgress>) =>
  progress?.rows.map((row) => `${"  ".repeat(row.depth)}${row.task.title}:${row.status}`);

describe("threadProgress", () => {
  it("shows a single source as the tree itself", () => {
    const progress = threadProgress(shell({ todoProgress: todo }), new Map());
    expect(titles(progress)).toEqual([
      "Read the code:completed",
      "Fix the bug:in_progress",
      "Test:pending",
    ]);
    expect(progress?.current?.title).toBe("Fix the bug");
    expect(progress?.shares.completed).toBeCloseTo(1 / 3);
    expect(progress && progressPercentLabel(progress)).toBe("33%");
  });

  it("puts each source under its own equally weighted group", () => {
    const progress = threadProgress(
      shell({ todoProgress: todo, childWork, timelineTasks }),
      new Map([[childId, childShell]]),
    );
    expect(titles(progress)).toEqual([
      "Task tree:blocked",
      "  Goal:blocked",
      "    A:completed",
      "    B:blocked",
      "Todo:in_progress",
      "  Read the code:completed",
      "  Fix the bug:in_progress",
      "  Test:pending",
      "Agents:in_progress",
      "  Child:in_progress",
      "  Native:completed",
    ]);
    // Tree 1/2, todo 1/3, agents (1/4 + 1) / 2.
    expect(progress?.shares.completed).toBeCloseTo((1 / 2 + 1 / 3 + 5 / 8) / 3);
    expect(progress?.blocked.map((task) => task.title)).toEqual(["B"]);
    expect(progress?.current?.title).toBe("Fix the bug");
  });

  it("counts steps past the shell's trimmed list", () => {
    const progress = threadProgress(
      shell({ todoProgress: { ...todo, completed: 4, total: 8 } }),
      new Map(),
    );
    expect(titles(progress)?.at(-1)).toBe("5 more:in_progress");
    expect(progress?.rows.at(-1)?.task.done).toEqual([3, 5]);
    expect(progress?.shares.completed).toBeCloseTo(4 / 8);
  });

  it("reads 100% only once every task is done", () => {
    const steps = todo.steps.map((step) => ({ ...step, status: "completed" as const }));
    const done = threadProgress(
      shell({ todoProgress: { ...todo, completed: 3, steps } }),
      new Map(),
    );
    expect(done && progressPercentLabel(done)).toBe("100%");
    const open = threadProgress(
      shell({ timelineTasks: [{ ...timelineTasks[0], done: [99, 100] }] }),
      new Map(),
    );
    expect(open && progressPercentLabel(open)).toBe("99%");
  });

  it("drops a todo list from an earlier run and is null with nothing to show", () => {
    expect(
      threadProgress(shell({ todoProgress: { ...todo, runId: childRunId } }), new Map()),
    ).toBeNull();
    expect(threadProgress(null, new Map())).toBeNull();
  });

  it("treats progress as unchanged while only unrelated fields stream", () => {
    const parent = shell({ childWork });
    const before = threadProgress(parent, new Map([[childId, childShell]]));
    const streamed = threadProgress(parent, new Map([[childId, { ...childShell, itemCount: 9 }]]));
    expect(sameThreadProgress(before, streamed)).toBe(true);
    const advanced = threadProgress(
      parent,
      new Map([[childId, { ...childShell, todoProgress: { ...childTodo, completed: 2 } }]]),
    );
    expect(sameThreadProgress(before, advanced)).toBe(false);
  });
});
