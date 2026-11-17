import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { childWorkProgress, sameChildWorkProgress } from "./childWorkProgress.ts";
import { v2ThreadShell } from "./state/orchestrationV2TestFixtures.ts";

const childId = ThreadId.make("thread:child");
const runId = RunId.make("run:child");
const todo = { runId, completed: 1, total: 2, current: "Fix", steps: [] };
const parent = {
  childWork: {
    runId: null,
    finished: 1,
    total: 3,
    children: [
      { threadId: childId, title: "Child", finished: false },
      { threadId: null, title: "Native", finished: true },
    ],
  },
};
const childShell = { ...v2ThreadShell, id: childId, latestRunId: runId, todoProgress: todo };

describe("childWorkProgress", () => {
  it("keeps the parent's counts and adds the todo list of each child shell it holds", () => {
    expect(childWorkProgress(parent, new Map([[childId, childShell]]))).toEqual({
      finished: 1,
      total: 3,
      children: [
        { threadId: childId, title: "Child", finished: false, todo },
        { threadId: null, title: "Native", finished: true, todo: null },
      ],
    });
    // An idle child the shells omit still counts; only its todo list is missing.
    expect(childWorkProgress(parent, new Map())).toMatchObject({ finished: 1, total: 3 });
  });

  it("treats progress as unchanged while only unrelated fields stream", () => {
    const before = childWorkProgress(parent, new Map([[childId, childShell]]));
    const streamed = childWorkProgress(
      parent,
      new Map([[childId, { ...childShell, itemCount: 9 }]]),
    );
    expect(sameChildWorkProgress(before, streamed)).toBe(true);
    const advanced = childWorkProgress(
      parent,
      new Map([[childId, { ...childShell, todoProgress: { ...todo, completed: 2 } }]]),
    );
    expect(sameChildWorkProgress(before, advanced)).toBe(false);
  });
});
