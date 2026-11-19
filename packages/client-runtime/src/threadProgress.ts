import type {
  OrchestrationV2ThreadShell,
  OrchestrationV2ShellTimelineTask,
  ThreadId,
} from "@t3tools/contracts";
import {
  summarizeTimeline,
  type TimelineSummary,
  type TimelineTask,
  type TimelineTaskStatus,
} from "@t3tools/shared/timelineTasks";

import { todoProgressSummary, type TodoProgressSummary } from "./todoProgress.ts";

/**
 * One progress tree for a thread: the claude-timeline task tree, the latest todo list and the
 * latest run's subagents. With one source its tasks are the tree; with several each becomes a
 * group, and groups weigh the same.
 */
export type ThreadProgress = TimelineSummary;

type ProgressShell = Pick<
  OrchestrationV2ThreadShell,
  "todoProgress" | "childWork" | "timelineTasks" | "latestRunId"
>;

const STEP_STATUS = {
  completed: "completed",
  running: "in_progress",
  pending: "pending",
} as const satisfies Record<TodoProgressSummary["steps"][number]["status"], TimelineTaskStatus>;

function shellTodo(shell: ProgressShell | undefined): TodoProgressSummary | null {
  if (shell === undefined) return null;
  return todoProgressSummary({
    todoProgress: shell.todoProgress,
    latestRun: shell.latestRunId === null ? null : { runId: shell.latestRunId },
  });
}

function task(
  id: string,
  parent: string | null,
  title: string,
  status: TimelineTaskStatus,
  done?: readonly [number, number],
): TimelineTask {
  return { id, parent, title, status, weight: 1, ...(done === undefined ? {} : { done }) };
}

/** Rows past the shell's trimmed list, as one task that weighs and counts as all of them. */
function restTask(
  id: string,
  parent: string | null,
  shown: number,
  shownDone: number,
  total: number,
  totalDone: number,
): TimelineTask[] {
  const rest = total - shown;
  if (rest <= 0) return [];
  const done = Math.min(Math.max(totalDone - shownDone, 0), rest);
  const status = done === rest ? "completed" : done > 0 ? "in_progress" : "pending";
  const units = status === "in_progress" ? ([done, rest] as const) : undefined;
  return [{ ...task(id, parent, `${rest} more`, status, units), weight: rest }];
}

function timelineSource(tasks: ReadonlyArray<OrchestrationV2ShellTimelineTask>) {
  return (parent: string | null): TimelineTask[] =>
    tasks.map((entry) => ({
      ...entry,
      id: `tree:${entry.id}`,
      parent: entry.parent === null ? parent : `tree:${entry.parent}`,
    }));
}

function todoSource(todo: TodoProgressSummary) {
  return (parent: string | null): TimelineTask[] => [
    ...todo.steps.map((step, index) =>
      task(`todo:${index}`, parent, step.text, STEP_STATUS[step.status]),
    ),
    ...restTask(
      "todo:more",
      parent,
      todo.steps.length,
      todo.steps.filter((step) => step.status === "completed").length,
      todo.total,
      todo.completed,
    ),
  ];
}

function agentSource(
  work: NonNullable<OrchestrationV2ThreadShell["childWork"]>,
  threadIndex: ReadonlyMap<ThreadId, ProgressShell>,
) {
  return (parent: string | null): TimelineTask[] => [
    ...work.children.map((child, index) => {
      if (child.finished) return task(`agent:${index}`, parent, child.title, "completed");
      const todo = shellTodo(child.threadId === null ? undefined : threadIndex.get(child.threadId));
      return task(
        `agent:${index}`,
        parent,
        child.title,
        "in_progress",
        todo === null ? undefined : [todo.completed, todo.total],
      );
    }),
    ...restTask(
      "agent:more",
      parent,
      work.children.length,
      work.children.filter((child) => child.finished).length,
      work.total,
      work.finished,
    ),
  ];
}

/** The thread's progress from its own shell, with each running subagent's todo list it holds. */
export function threadProgress(
  shell: ProgressShell | null,
  threadIndex: ReadonlyMap<ThreadId, ProgressShell>,
): ThreadProgress | null {
  if (shell === null) return null;
  const todo = shellTodo(shell);
  const work = shell.childWork;
  const sources = [
    shell.timelineTasks != null && shell.timelineTasks.length > 0
      ? { id: "group:tree", title: "Task tree", tasks: timelineSource(shell.timelineTasks) }
      : null,
    todo === null ? null : { id: "group:todo", title: "Todo", tasks: todoSource(todo) },
    work == null || work.total === 0
      ? null
      : { id: "group:agents", title: "Agents", tasks: agentSource(work, threadIndex) },
  ].filter((source) => source !== null);
  if (sources.length === 0) return null;
  const tasks =
    sources.length === 1
      ? sources[0]!.tasks(null)
      : sources.flatMap((source) => [
          task(source.id, null, source.title, "pending"),
          ...source.tasks(source.id),
        ]);
  return summarizeTimeline(tasks);
}

/** Streaming updates that leave every row and share alone keep the previous value. */
export function sameThreadProgress(
  left: ThreadProgress | null,
  right: ThreadProgress | null,
): boolean {
  if (left === null || right === null) return left === right;
  return progressKey(left) === progressKey(right);
}

function progressKey(progress: ThreadProgress) {
  return JSON.stringify([
    progress.shares,
    progress.rows.map((row) => [
      row.task.id,
      row.task.title,
      row.task.note,
      row.task.done,
      row.task.weight,
      row.status,
      row.completed,
      row.depth,
    ]),
  ]);
}

/** Whole percent for list rows, never 100 while work is open (open work caps at 99.99%). */
export function progressPercentLabel(progress: ThreadProgress): string {
  return progress.status === "completed"
    ? "100%"
    : `${Math.min(99, Math.floor(progress.shares.completed * 100))}%`;
}
