import type { TodoProgressSummary } from "@t3tools/client-runtime/todo-progress";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

const STEP_LIST_MAX_HEIGHT = 220;

/** The latest todo list above the composer while steps remain; a tap opens every step. */
export function ThreadTodoBanner(props: { readonly progress: TodoProgressSummary | null }) {
  const [expanded, setExpanded] = useState(false);
  const progress = props.progress;
  if (progress === null || progress.completed >= progress.total) return null;
  const hiddenSteps = progress.total - progress.steps.length;
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
          accessibilityLabel={`Tasks ${progress.completed} of ${progress.total} done${
            progress.current ? `, now ${progress.current}` : ""
          }`}
          accessibilityState={{ expanded }}
          className="flex-row items-center gap-2 px-3 py-2 active:opacity-70"
          onPress={() => {
            void Haptics.selectionAsync();
            setExpanded((value) => !value);
          }}
        >
          <SymbolView name="list.number" size={13} tintColorClassName="accent-icon-muted" />
          <Text className="text-xs tabular-nums text-foreground-muted">
            {progress.completed}/{progress.total}
          </Text>
          <View className="h-1 w-10 overflow-hidden rounded-full bg-border">
            <View
              className="h-full rounded-full bg-primary"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </View>
          <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
            {progress.current ?? ""}
          </Text>
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.up"}
            size={12}
            tintColorClassName="accent-chevron"
          />
        </Pressable>
        {expanded ? (
          <ScrollView
            style={{ maxHeight: STEP_LIST_MAX_HEIGHT }}
            contentContainerClassName="gap-1 px-3 pb-2.5"
          >
            {progress.steps.map((step) => (
              <View key={step.text} className="flex-row gap-2">
                <Text
                  className={cn(
                    "w-4 text-sm",
                    step.status === "completed"
                      ? "text-foreground-muted"
                      : step.status === "running"
                        ? "text-primary"
                        : "text-foreground-muted",
                  )}
                >
                  {step.status === "completed" ? "✓" : step.status === "running" ? "◉" : "○"}
                </Text>
                <Text
                  className={cn(
                    "flex-1 text-sm",
                    step.status === "completed"
                      ? "text-foreground-muted line-through"
                      : step.status === "running"
                        ? "font-t3-medium text-foreground"
                        : "text-foreground",
                  )}
                >
                  {step.text}
                </Text>
              </View>
            ))}
            {hiddenSteps > 0 ? (
              <Text className="text-xs text-foreground-muted">+{hiddenSteps} more</Text>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
