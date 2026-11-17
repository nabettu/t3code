import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { todoProgressSummary } from "./todoProgress.js";

const runId = RunId.make("run:latest");
const progress = {
  runId,
  completed: 1,
  total: 2,
  current: "Fix the bug",
  steps: [
    { text: "Read the code", status: "completed" },
    { text: "Fix the bug", status: "running" },
  ],
} as const;

describe("todoProgressSummary", () => {
  it("shows the list of the latest run and hides one from an earlier run", () => {
    expect(todoProgressSummary({ todoProgress: progress, latestRun: { runId } })).toBe(progress);
    expect(
      todoProgressSummary({
        todoProgress: { ...progress, runId: RunId.make("run:earlier") },
        latestRun: { runId },
      }),
    ).toBeNull();
  });
});
