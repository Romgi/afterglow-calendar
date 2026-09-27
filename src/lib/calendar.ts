import type { Memory } from "./types";

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(day: string, days: number): string {
  const date = parseDay(day);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
export function monthGrid(month: Date): string[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return Array.from({ length: Math.ceil((offset + last) / 7) * 7 }, (_, i) =>
    addDays(dateKey(first), i - offset),
  );
}
export function defaultEnd(start: string, memories: Memory[]): string {
  const next = memories
    .filter((m) => m.start > start)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return next && next.start <= addDays(start, 6)
    ? addDays(next.start, -1)
    : addDays(start, 6);
}
export function dayMemory(day: string, memories: Memory[]): Memory | undefined {
  return memories.find((m) => day >= m.start && day <= m.end);
}
export function resizeMemory(
  memories: Memory[],
  id: string,
  edge: "start" | "end",
  target: string,
): Memory[] {
  const current = memories.find((m) => m.id === id);
  if (!current) return memories;
  const others = memories.filter((m) => m.id !== id);
  let value = target;
  if (edge === "start") {
    value = value > current.end ? current.end : value;
    const previous = others
      .filter((m) => m.end < current.start)
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    if (previous && value <= previous.end) value = addDays(previous.end, 1);
  } else {
    value = value < current.start ? current.start : value;
    const next = others
      .filter((m) => m.start > current.end)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (next && value >= next.start) value = addDays(next.start, -1);
  }
  return memories.map((m) => (m.id === id ? { ...m, [edge]: value } : m));
}
export function rangeConflict(memory: Memory, memories: Memory[]): boolean {
  return memories.some(
    (m) => m.id !== memory.id && m.start <= memory.end && m.end >= memory.start,
  );
}
export function prettyDate(day: string, year = false): string {
  return parseDay(day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
  });
}
export function secondsLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}
