import { progressPercentLabel, type ThreadProgress } from "@t3tools/client-runtime/thread-progress";
import { timelineRowWindow } from "@t3tools/shared/timelineTasks";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  ListTreeIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

import { TimelineBar } from "../chat/TimelineTasks";

/** A thread's progress tree as a list row shows it: percent and a bar. */
export function SidebarProgress({
  progress,
  className,
}: {
  readonly progress: ThreadProgress;
  readonly className?: string;
}) {
  const percent = progressPercentLabel(progress);
  const blocked = progress.blocked.length;
  return (
    <span
      role="img"
      aria-label={`${percent} done${blocked > 0 ? `, ${blocked} blocked` : ""}`}
      className={cn("inline-flex shrink-0 items-center gap-1 text-xs tabular-nums", className)}
    >
      <ListTreeIcon aria-hidden className="size-3" />
      <TimelineBar shares={progress.shares} className="h-1 w-5 shrink-0" />
      <span aria-hidden>{percent}</span>
    </span>
  );
}

const STATUS_ICONS = {
  completed: { Icon: CircleCheckIcon, className: "text-success-foreground" },
  in_progress: { Icon: CircleDotIcon, className: "text-info-foreground" },
  blocked: { Icon: CircleXIcon, className: "text-destructive-foreground" },
  pending: { Icon: CircleDashedIcon, className: "text-muted-foreground" },
} as const;

// Hover cards ignore the pointer, so long lists are windowed rather than scrolled.
const HOVER_LIST_ROWS = 8;

export function SidebarProgressRows({ progress }: { readonly progress: ThreadProgress }) {
  const { start, end } = timelineRowWindow(progress.rows, HOVER_LIST_ROWS);
  const after = progress.rows.length - end;
  return (
    <ol className="grid gap-1 border-t border-border/60 pt-2" aria-label="Progress">
      {start > 0 ? <li className="ps-5 text-muted-foreground">{start} earlier</li> : null}
      {progress.rows.slice(start, end).map((row) => {
        const { Icon, className } = STATUS_ICONS[row.status];
        return (
          <li
            key={row.task.id}
            className="flex min-w-0 items-center gap-2"
            style={{ paddingInlineStart: `${row.depth * 0.75}rem` }}
          >
            <Icon aria-label={row.status} className={cn("size-3 shrink-0", className)} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                row.status === "completed" ? "text-muted-foreground" : "text-foreground/75",
              )}
            >
              {row.task.title}
            </span>
            {row.leaf && row.task.done && row.status !== "completed" ? (
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {row.task.done[0]}/{row.task.done[1]}
              </span>
            ) : null}
          </li>
        );
      })}
      {after > 0 ? <li className="ps-5 text-muted-foreground">+{after} more</li> : null}
    </ol>
  );
}
