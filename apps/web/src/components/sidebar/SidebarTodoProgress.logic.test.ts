import { describe, expect, it } from "vite-plus/test";

import { hoverListWindow, todoFocusIndex } from "./SidebarTodoProgress.logic";

describe("hoverListWindow", () => {
  it.each([
    { length: 5, focus: 4, expected: { start: 0, end: 5 } },
    { length: 20, focus: -1, expected: { start: 0, end: 8 } },
    { length: 20, focus: 0, expected: { start: 0, end: 8 } },
    { length: 20, focus: 10, expected: { start: 8, end: 16 } },
    { length: 20, focus: 19, expected: { start: 12, end: 20 } },
  ])("keeps row $focus of $length in view", ({ length, focus, expected }) => {
    expect(hoverListWindow(length, focus)).toEqual(expected);
  });
});

describe("todoFocusIndex", () => {
  it.each([
    { statuses: ["pending", "completed", "running"], expected: 2 },
    { statuses: ["completed", "pending", "pending"], expected: 1 },
    { statuses: ["completed", "completed"], expected: -1 },
  ] as const)("focuses $expected in $statuses", ({ statuses, expected }) => {
    expect(todoFocusIndex(statuses.map((status) => ({ status })))).toBe(expected);
  });
});
