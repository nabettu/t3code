import type { ChildWorkProgress } from "@t3tools/client-runtime/child-work-progress";
import type { TodoProgressSummary } from "@t3tools/client-runtime/todo-progress";
import { BotIcon, CircleCheckIcon, CircleDashedIcon, CircleDotIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { hoverListWindow, todoFocusIndex } from "./SidebarTodoProgress.logic";

export function SidebarTodoProgress({
  progress,
  showCurrent,
  className,
}: {
  readonly progress: TodoProgressSummary;
  readonly showCurrent: boolean;
  readonly className?: string;
}) {
  const { completed, total, current } = progress;
  return (
    <span
      role="img"
      aria-label={`${completed} of ${total} steps done`}
      className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs", className)}
    >
      <span
        aria-hidden
        className="relative h-1 w-4 shrink-0 overflow-hidden rounded-full bg-current/20"
      >
        <span
          className="absolute inset-y-0 start-0 bg-current"
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </span>
      <span aria-hidden className="shrink-0 tabular-nums">
        {completed}/{total}
      </span>
      {showCurrent && current !== null ? (
        <span aria-hidden className="min-w-0 truncate">
          {current}
        </span>
      ) : null}
    </span>
  );
}

const STEP_ICONS = {
  completed: { Icon: CircleCheckIcon, className: "text-success-foreground" },
  running: { Icon: CircleDotIcon, className: "text-info-foreground" },
  pending: { Icon: CircleDashedIcon, className: "text-muted-foreground" },
} as const;

export function SidebarTodoSteps({ progress }: { readonly progress: TodoProgressSummary }) {
  const { start, end } = hoverListWindow(progress.steps.length, todoFocusIndex(progress.steps));
  const after = progress.total - end;
  return (
    <ol className="grid gap-1 border-t border-border/60 pt-2" aria-label="Todo steps">
      {start > 0 ? <li className="ps-5 text-muted-foreground">{start} earlier</li> : null}
      {progress.steps.slice(start, end).map((step, index) => {
        const { Icon, className } = STEP_ICONS[step.status];
        return (
          // Step texts can repeat; the list is replaced whole, never reordered.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={start + index} className="flex min-w-0 items-center gap-2">
            <Icon aria-label={step.status} className={cn("size-3 shrink-0", className)} />
            <span
              className={cn(
                "min-w-0 truncate",
                step.status === "completed" ? "text-muted-foreground" : "text-foreground/75",
              )}
            >
              {step.text}
            </span>
          </li>
        );
      })}
      {after > 0 ? <li className="ps-5 text-muted-foreground">+{after} more</li> : null}
    </ol>
  );
}

/** How many of a thread's subagents finished. */
export function SidebarChildWork({
  progress,
  className,
}: {
  readonly progress: ChildWorkProgress;
  readonly className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${progress.finished} of ${progress.total} subagents done`}
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs tabular-nums", className)}
    >
      <BotIcon aria-hidden className="size-3" />
      <span aria-hidden>
        {progress.finished}/{progress.total}
      </span>
    </span>
  );
}

export function SidebarChildWorkList({ progress }: { readonly progress: ChildWorkProgress }) {
  const { start, end } = hoverListWindow(
    progress.children.length,
    progress.children.findIndex((child) => !child.finished),
  );
  const after = progress.total - end;
  return (
    <ul className="grid gap-1 border-t border-border/60 pt-2" aria-label="Subagents">
      {start > 0 ? <li className="ps-5 text-muted-foreground">{start} earlier</li> : null}
      {progress.children.slice(start, end).map((child, index) => {
        const { Icon, className } = STEP_ICONS[child.finished ? "completed" : "running"];
        return (
          // Tasks can share a title and lack a thread; the list is replaced whole, never reordered.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={start + index} className="flex min-w-0 items-center gap-2">
            <Icon
              aria-label={child.finished ? "done" : "working"}
              className={cn("size-3 shrink-0", className)}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                child.finished ? "text-muted-foreground" : "text-foreground/75",
              )}
            >
              {child.title}
            </span>
            {child.todo ? (
              <SidebarTodoProgress
                progress={child.todo}
                showCurrent={false}
                className="shrink-0 text-muted-foreground"
              />
            ) : null}
          </li>
        );
      })}
      {after > 0 ? <li className="ps-5 text-muted-foreground">+{after} more</li> : null}
    </ul>
  );
}
