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
 * One progress tree for a thread. The claude-timeline task tree is the trunk; the latest todo
 * list breaks down its step in progress, and the latest run's subagents break down the running
 * todo step (else the tree's step). A source that has a step to sit under shows only while it has
 * open work, so a finished breakdown never marks the step itself done.
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
  const tree =
    shell.timelineTasks != null && shell.timelineTasks.length > 0
      ? timelineSource(shell.timelineTasks)(null)
      : [];
  const treeStep = tree.length === 0 ? null : (summarizeTimeline(tree).current?.id ?? null);
  const todo = shellTodo(shell);
  const showsTodo = todo !== null && (tree.length === 0 || todo.completed < todo.total);
  const todoTasks = showsTodo ? todoSource(todo)(treeStep) : [];
  const todoStep = showsTodo ? todo.steps.findIndex((step) => step.status === "running") : -1;
  const work = shell.childWork;
  const hasBase = tree.length > 0 || todoTasks.length > 0;
  const showsAgents = work != null && work.total > 0 && (!hasBase || work.finished < work.total);
  const agentTasks = showsAgents
    ? agentSource(work, threadIndex)(todoStep >= 0 ? `todo:${todoStep}` : treeStep)
    : [];
  const tasks = [...tree, ...todoTasks, ...agentTasks];
  return tasks.length === 0 ? null : summarizeTimeline(tasks);
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
