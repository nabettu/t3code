import type { OrchestrationV2ThreadShell, RunId } from "@t3tools/contracts";

export type TodoProgressSteps = NonNullable<OrchestrationV2ThreadShell["todoProgress"]>["steps"];

export interface TodoProgressSummary {
  readonly completed: number;
  readonly total: number;
  /** The running step, else the first pending one; null once every step is done. */
  readonly current: string | null;
  readonly steps: TodoProgressSteps;
}

/** The thread's todo list progress, while it belongs to the thread's latest run. */
export function todoProgressSummary(thread: {
  readonly todoProgress?: OrchestrationV2ThreadShell["todoProgress"];
  readonly latestRun: { readonly runId: RunId } | null;
}): TodoProgressSummary | null {
  const progress = thread.todoProgress;
  if (progress == null || progress.steps.length === 0) return null;
  if (progress.runId !== null && progress.runId !== thread.latestRun?.runId) return null;
  const current =
    progress.steps.find((step) => step.status === "running") ??
    progress.steps.find((step) => step.status === "pending");
  return {
    completed: progress.steps.filter((step) => step.status === "completed").length,
    total: progress.steps.length,
    current: current?.text ?? null,
    steps: progress.steps,
  };
}
