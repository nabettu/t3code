import type {
  OrchestrationV2ShellTodoProgress,
  OrchestrationV2ThreadShell,
  RunId,
} from "@t3tools/contracts";

export type TodoProgressSummary = OrchestrationV2ShellTodoProgress;

/** The thread's todo list progress, while it belongs to the thread's latest run. */
export function todoProgressSummary(thread: {
  readonly todoProgress?: OrchestrationV2ThreadShell["todoProgress"];
  readonly latestRun: { readonly runId: RunId } | null;
}): TodoProgressSummary | null {
  const progress = thread.todoProgress;
  if (progress == null || progress.total === 0) return null;
  if (progress.runId !== null && progress.runId !== thread.latestRun?.runId) return null;
  return progress;
}
