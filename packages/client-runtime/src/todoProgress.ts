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

type TodoStepLike = {
  readonly text: string;
  readonly status: OrchestrationV2ShellTodoProgress["steps"][number]["status"];
};

function todoStepMark(status: TodoStepLike["status"]): string {
  return status === "completed" ? "✓" : status === "running" ? "◉" : "○";
}

/** One line per step, marked like the web inspector: ✓ done, ◉ running, ○ pending. */
export function todoStepLines(steps: ReadonlyArray<TodoStepLike>): string {
  return steps.map((step) => `${todoStepMark(step.status)} ${step.text}`).join("\n");
}

/** "Tasks 3/7 · current step", the label web gives a todo update. */
export function todoListLabel(steps: ReadonlyArray<TodoStepLike>): string {
  const done = steps.filter((step) => step.status === "completed").length;
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "pending");
  return `Tasks ${done}/${steps.length}${current ? ` · ${current.text}` : ""}`;
}
