import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { todoProgressSummary } from "./todoProgress.js";

const runId = RunId.make("run:latest");
const steps = [
  { text: "Read the code", status: "completed" },
  { text: "Write the test", status: "pending" },
  { text: "Fix the bug", status: "running" },
] as const;

describe("todoProgressSummary", () => {
  it("counts finished steps and names the running one", () => {
    expect(todoProgressSummary({ todoProgress: { runId, steps }, latestRun: { runId } })).toEqual({
      completed: 1,
      total: 3,
      current: "Fix the bug",
      steps,
    });
  });

  it("falls back to the first pending step, then to none", () => {
    const pending = steps.map((step) =>
      step.status === "running" ? { ...step, status: "completed" as const } : step,
    );
    expect(
      todoProgressSummary({ todoProgress: { runId, steps: pending }, latestRun: { runId } })
        ?.current,
    ).toBe("Write the test");
    const done = steps.map((step) => ({ ...step, status: "completed" as const }));
    expect(
      todoProgressSummary({ todoProgress: { runId, steps: done }, latestRun: { runId } }),
    ).toMatchObject({ completed: 3, total: 3, current: null });
  });

  it("hides a list from an earlier run", () => {
    expect(
      todoProgressSummary({
        todoProgress: { runId: RunId.make("run:earlier"), steps },
        latestRun: { runId },
      }),
    ).toBeNull();
  });
});
