import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  defaultEnd,
  monthGrid,
  resizeMemory,
  rangeConflict,
} from "../src/lib/calendar";
import { demoMemories } from "../src/lib/demo";

test("new song spans seven inclusive days, stops before a following song", () => {
  const memories = demoMemories(new Date(2026, 8, 1));
  assert.equal(defaultEnd("2026-09-01", []), "2026-09-07");
  assert.equal(defaultEnd("2026-09-09", memories), "2026-09-09");
  assert.equal(defaultEnd("2026-09-15", memories), "2026-09-16");
});
test("date math handles leap days and month/year boundaries", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(monthGrid(new Date(2026, 1, 1)).length, 35);
  assert.equal(monthGrid(new Date(2026, 8, 1))[0], "2026-08-31");
});
test("drag edges clamp at neighbors and at minimum one day", () => {
  const memories = demoMemories(new Date(2026, 8, 1));
  assert.equal(
    resizeMemory(memories, "demo-1", "start", "2026-09-01")[1].start,
    "2026-09-09",
  );
  assert.equal(
    resizeMemory(memories, "demo-1", "end", "2026-09-29")[1].end,
    "2026-09-16",
  );
  assert.equal(
    resizeMemory(memories, "demo-1", "start", "2026-09-25")[1].start,
    "2026-09-14",
  );
  assert.equal(
    resizeMemory(memories, "demo-1", "end", "2026-09-01")[1].end,
    "2026-09-10",
  );
});
test("same-day overlaps are rejected, adjacent intervals are allowed", () => {
  const memories = demoMemories(new Date(2026, 8, 1));
  assert.equal(
    rangeConflict({ ...memories[1], start: "2026-09-08" }, memories),
    true,
  );
  assert.equal(
    rangeConflict({ ...memories[1], start: "2026-09-09" }, memories),
    false,
  );
});
