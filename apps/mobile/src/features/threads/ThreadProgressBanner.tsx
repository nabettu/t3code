import { progressPercentLabel, type ThreadProgress } from "@t3tools/client-runtime/thread-progress";
import type { TimelineShares, TimelineTaskStatus } from "@t3tools/shared/timelineTasks";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

const ROW_LIST_MAX_HEIGHT = 260;
const DEPTH_INDENT = 14;

const SEGMENTS = [
  { status: "completed", className: "bg-primary" },
  { status: "in_progress", className: "bg-primary/40" },
  { status: "blocked", className: "bg-danger-foreground" },
] as const;

/** Done, in progress and blocked work side by side; the rest of the track is not started. */
export function ProgressBar(props: {
  readonly shares: TimelineShares;
  readonly className?: string;
}) {
  return (
    <View className={cn("h-1 flex-row overflow-hidden rounded-full bg-border", props.className)}>
      {SEGMENTS.map(({ status, className }) =>
        props.shares[status] > 0 ? (
          <View
            key={status}
            className={cn("h-full", className)}
            style={{ width: `${props.shares[status] * 100}%` }}
          />
        ) : null,
      )}
    </View>
  );
}

const MARKS: Record<TimelineTaskStatus, { mark: string; className: string }> = {
  completed: { mark: "✓", className: "text-foreground-muted" },
  in_progress: { mark: "◉", className: "text-primary" },
  blocked: { mark: "✕", className: "text-danger-foreground" },
  pending: { mark: "○", className: "text-foreground-muted" },
};

/** The thread's progress above the composer while work remains; a tap opens every row. */
export function ThreadProgressBanner(props: { readonly progress: ThreadProgress | null }) {
  const [expanded, setExpanded] = useState(false);
  const progress = props.progress;
  if (progress === null || progress.status === "completed") return null;
  const percent = progressPercentLabel(progress);
  const blocked = progress.blocked.length;
  return (
    <View
      className={cn(
        "shrink-0 px-4 pb-2",
        Platform.OS === "android" ? "bg-thread-canvas" : "bg-screen",
      )}
    >
      <View className="overflow-hidden rounded-2xl border border-border bg-subtle">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Progress ${percent}${
            progress.current ? `, now ${progress.current.title}` : ""
          }${blocked > 0 ? `, ${blocked} blocked` : ""}`}
          accessibilityState={{ expanded }}
          className="flex-row items-center gap-2 px-3 py-2 active:opacity-70"
          onPress={() => {
            void Haptics.selectionAsync();
            setExpanded((value) => !value);
          }}
        >
          <SymbolView name="list.bullet.indent" size={13} tintColorClassName="accent-icon-muted" />
          <Text className="text-xs tabular-nums text-foreground-muted">{percent}</Text>
          <ProgressBar shares={progress.shares} className="w-12" />
          <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
            {progress.current?.title ?? ""}
          </Text>
          {blocked > 0 ? (
            <Text className="text-xs text-danger-foreground">{blocked} blocked</Text>
          ) : null}
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.up"}
            size={12}
            tintColorClassName="accent-chevron"
          />
        </Pressable>
        {expanded ? (
          <ScrollView
            style={{ maxHeight: ROW_LIST_MAX_HEIGHT }}
            contentContainerClassName="gap-1 px-3 pb-2.5"
          >
            {progress.rows.map((row) => {
              const { mark, className } = MARKS[row.status];
              const open = row.status !== "completed";
              return (
                <View key={row.task.id} style={{ paddingLeft: row.depth * DEPTH_INDENT }}>
                  <View className="flex-row gap-2">
                    <Text className={cn("w-4 text-sm", className)}>{mark}</Text>
                    <Text
                      className={cn(
                        "flex-1 text-sm",
                        !open
                          ? "text-foreground-muted line-through"
                          : row.status === "in_progress" && row.leaf
                            ? "font-t3-medium text-foreground"
                            : "text-foreground",
                        !row.leaf && "font-t3-medium",
                      )}
                    >
                      {row.task.title}
                    </Text>
                    {row.leaf && row.task.done && open ? (
                      <Text className="text-xs tabular-nums text-foreground-muted">
                        {row.task.done[0]}/{row.task.done[1]}
                      </Text>
                    ) : null}
                  </View>
                  {row.task.note && open ? (
                    <Text
                      className={cn(
                        "pl-6 text-xs",
                        row.status === "blocked"
                          ? "text-danger-foreground"
                          : "text-foreground-muted",
                      )}
                    >
                      {row.task.note}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
