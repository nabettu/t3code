import type { TodoProgressSummary } from "@t3tools/client-runtime/todo-progress";
import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon } from "lucide-react";

import { cn } from "~/lib/utils";

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
  const hidden = progress.total - progress.steps.length;
  return (
    <ol className="grid gap-1 border-t border-border/60 pt-2" aria-label="Todo steps">
      {progress.steps.map((step, index) => {
        const { Icon, className } = STEP_ICONS[step.status];
        return (
          // Step texts can repeat; the list is replaced whole, never reordered.
          // oxlint-disable-next-line react/no-array-index-key
          <li key={index} className="flex min-w-0 items-center gap-2">
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
      {hidden > 0 ? <li className="ps-5 text-muted-foreground">+{hidden} more</li> : null}
    </ol>
  );
}
