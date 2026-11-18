import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon, CircleXIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { ThreadDetailsSection } from "./ThreadDetailsSection";
import type { TimelineShares, TimelineSummary, TimelineTaskStatus } from "./timelineTasks.logic";

function formatTimelinePercent(share: number) {
  return `${(share * 100).toFixed(1)}%`;
}

const SEGMENTS = [
  { status: "completed", className: "bg-success" },
  { status: "in_progress", className: "bg-info" },
  { status: "blocked", className: "bg-destructive" },
] as const;

/** Completed, in progress and blocked work side by side; the rest of the track is not started. */
function TimelineBar({
  shares,
  className,
}: {
  readonly shares: TimelineShares;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("flex h-1.5 overflow-hidden rounded-full bg-current/15", className)}
    >
      {SEGMENTS.map(({ status, className: segment }) =>
        shares[status] > 0 ? (
          <span key={status} className={segment} style={{ width: `${shares[status] * 100}%` }} />
        ) : null,
      )}
    </span>
  );
}

function unitsLabel(done: readonly [number, number] | undefined) {
  return done === undefined ? "" : ` ${done[0]}/${done[1]}`;
}

/** The composer banner's title: overall progress and the step being worked on. */
export function TimelineBannerTitle({ summary }: { readonly summary: TimelineSummary }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 tabular-nums">
        {formatTimelinePercent(summary.shares.completed)}
      </span>
      <TimelineBar shares={summary.shares} className="w-24 shrink-0 text-muted-foreground" />
      {summary.current ? (
        <span className="min-w-0 truncate font-normal text-info-foreground">
          {summary.current.title}
          {unitsLabel(summary.current.done)}
        </span>
      ) : null}
      {summary.blocked.length > 0 ? (
        <span className="shrink-0 font-normal text-destructive-foreground">
          {summary.blocked.length} blocked
        </span>
      ) : null}
    </span>
  );
}

const STATUS_ICONS: Record<
  TimelineTaskStatus,
  { Icon: typeof CircleCheckIcon; className: string }
> = {
  completed: { Icon: CircleCheckIcon, className: "text-success-foreground" },
  in_progress: { Icon: CircleDotIcon, className: "text-info-foreground" },
  blocked: { Icon: CircleXIcon, className: "text-destructive-foreground" },
  pending: { Icon: CircleDashedIcon, className: "text-muted-foreground" },
};

const ROW_LIMIT = 30;

/** The task tree in the thread details card. */
export function ThreadTimelineSection({ summary }: { readonly summary: TimelineSummary }) {
  const rows = summary.rows.slice(0, ROW_LIMIT);
  const hidden = summary.rows.length - rows.length;
  return (
    <ThreadDetailsSection
      headingId="thread-details-timeline-heading"
      title={`Task tree · ${summary.leaves.completed}/${summary.leaves.total}`}
      actions={
        <span className="text-2xs text-muted-foreground tabular-nums">
          {formatTimelinePercent(summary.shares.completed)}
        </span>
      }
    >
      <div className="flex flex-col gap-2 px-2.5 text-xs">
        <TimelineBar shares={summary.shares} className="text-muted-foreground" />
        <ol className="grid gap-1" aria-label="Task tree">
          {rows.map((row) => {
            const { Icon, className } = STATUS_ICONS[row.status];
            return (
              <li
                key={row.task.id}
                className="grid min-w-0 gap-0.5"
                style={{ paddingInlineStart: `${row.depth * 0.875}rem` }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon aria-label={row.status} className={cn("size-3 shrink-0", className)} />
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      row.status === "completed" ? "text-muted-foreground" : "text-foreground/85",
                    )}
                  >
                    {row.task.title}
                  </span>
                  {row.task.weight !== 1 ? (
                    <span className="shrink-0 rounded border border-border/70 px-1 text-2xs text-muted-foreground tabular-nums">
                      w{row.task.weight}
                    </span>
                  ) : null}
                  {row.leaf && row.task.done && row.status !== "completed" ? (
                    <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
                      {row.task.done[0]}/{row.task.done[1]}
                    </span>
                  ) : null}
                </span>
                {row.task.note && row.status !== "completed" ? (
                  <span
                    className={cn(
                      "ps-5 text-2xs",
                      row.status === "blocked"
                        ? "text-destructive-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {row.task.note}
                  </span>
                ) : null}
              </li>
            );
          })}
          {hidden > 0 ? <li className="ps-5 text-muted-foreground">+{hidden} more</li> : null}
        </ol>
      </div>
    </ThreadDetailsSection>
  );
}
