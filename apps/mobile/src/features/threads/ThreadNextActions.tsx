import type { NextAction } from "@t3tools/client-runtime/next-actions";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, ScrollView } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/** The agent's suggested follow-ups. A tap sends one; a long press puts it in the composer. */
export function ThreadNextActions(props: {
  readonly actions: ReadonlyArray<NextAction>;
  readonly onSend: (action: NextAction) => void;
  readonly onEdit: (action: NextAction) => void;
}) {
  if (props.actions.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className={cn("shrink-0", Platform.OS === "android" ? "bg-thread-canvas" : "bg-screen")}
      contentContainerClassName="gap-2 px-4 py-2"
    >
      {props.actions.map((action) => (
        <Pressable
          key={action.prompt}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={`Sends “${action.prompt}”. Long press to edit it first.`}
          accessibilityActions={[{ name: "longpress", label: "Edit before sending" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "longpress") props.onEdit(action);
          }}
          className="max-w-64 rounded-2xl bg-subtle px-3 py-1.5 active:opacity-70"
          onPress={() => {
            void Haptics.selectionAsync();
            props.onSend(action);
          }}
          onLongPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            props.onEdit(action);
          }}
        >
          <Text className="font-t3-medium text-sm text-foreground" numberOfLines={1}>
            {action.label}
          </Text>
          {action.reason ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {action.reason}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}
