"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Plus, SpeakerHigh } from "@phosphor-icons/react";
import {
  addDays,
  dateKey,
  dayMemory,
  monthGrid,
  parseDay,
  prettyDate,
  resizeMemory,
} from "@/lib/calendar";
import type { Memory } from "@/lib/types";

interface Props {
  month: Date;
  memories: Memory[];
  selectedId: string | null;
  activeId: string | null;
  onSelect: (memory: Memory, day: string) => void;
  onAdd: (day: string) => void;
  onRangeChange: (memories: Memory[], commit: boolean) => void;
}
export function Calendar({
  month,
  memories,
  selectedId,
  activeId,
  onSelect,
  onAdd,
  onRangeChange,
}: Props) {
  const days = monthGrid(month),
    today = dateKey(new Date());
  const [drag, setDrag] = useState<{
    id: string;
    edge: "start" | "end";
    initial: Memory[];
  } | null>(null);
  const latest = useRef(memories);
  latest.current = memories;
  const changed = useRef(false);
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const cell = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-date]");
      if (!cell?.dataset.date) return;
      const resized = resizeMemory(
        drag.initial,
        drag.id,
        drag.edge,
        cell.dataset.date,
      );
      latest.current = resized;
      changed.current = true;
      onRangeChange(resized, false);
    };
    const finish = () => {
      if (changed.current) onRangeChange(latest.current, true);
      setDrag(null);
    };
    const cancel = () => {
      onRangeChange(drag.initial, false);
      setDrag(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [drag, onRangeChange]);
  return (
    <div
      className={`calendar ${drag ? "is-dragging" : ""}`}
      aria-label={month.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })}
    >
      <div className="weekdays">
        {[
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ].map((day) => (
          <span key={day}>
            <span className="weekday-full">{day.slice(0, 3)}</span>
            <span className="weekday-short">{day.slice(0, 1)}</span>
          </span>
        ))}
      </div>
      <div className="day-grid">
        {days.map((day, index) => {
          const memory = dayMemory(day, memories),
            date = parseDay(day),
            outside = date.getMonth() !== month.getMonth();
          const start = memory?.start === day,
            end = memory?.end === day,
            rowStart = index % 7 === 0;
          return (
            <div
              key={day}
              data-date={day}
              className={`day ${outside ? "outside" : ""} ${memory ? "has-memory" : ""} ${memory?.id === selectedId ? "selected-memory" : ""} ${start ? "range-start" : ""} ${end ? "range-end" : ""} ${day === today ? "is-today" : ""}`}
              style={
                memory
                  ? ({ "--song-color": memory.color } as React.CSSProperties)
                  : undefined
              }
            >
              <button
                className="day-hit"
                onClick={() => {
                  if (!drag) memory ? onSelect(memory, day) : onAdd(day);
                }}
                aria-label={`${prettyDate(day, true)}${memory ? `, ${memory.track.title} by ${memory.track.artist}, play clip` : ", add a song"}`}
              >
                <span className="day-top">
                  <span className="date-number">{date.getDate()}</span>
                  {memory?.id === activeId ? (
                    <SpeakerHigh
                      size={14}
                      weight="fill"
                      className="playing-icon"
                    />
                  ) : (
                    !memory && <Plus className="day-plus" size={16} />
                  )}
                </span>
                {memory && (
                  <span className="day-track">
                    {(start || rowStart) && (
                      <Image
                        src={memory.track.artwork || "/album-placeholder.svg"}
                        alt=""
                        width={30}
                        height={30}
                        unoptimized
                        className="day-art"
                      />
                    )}
                    <span className="day-track-text">
                      <strong>{memory.track.title}</strong>
                      {(start || rowStart) && (
                        <span>{memory.track.artist}</span>
                      )}
                    </span>
                  </span>
                )}
              </button>
              {memory &&
                (["start", "end"] as const).map(
                  (edge) =>
                    (edge === "start" ? start : end) && (
                      <button
                        key={edge}
                        className={`range-handle ${edge}`}
                        aria-label={`Change ${edge} date for ${memory.track.title}. Drag or use arrow keys.`}
                        title={`Drag ${edge} date`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          changed.current = false;
                          setDrag({ id: memory.id, edge, initial: memories });
                        }}
                        onKeyDown={(event) => {
                          if (
                            [
                              "ArrowLeft",
                              "ArrowRight",
                              "ArrowUp",
                              "ArrowDown",
                            ].includes(event.key)
                          ) {
                            event.preventDefault();
                            const step =
                              event.key === "ArrowLeft"
                                ? -1
                                : event.key === "ArrowRight"
                                  ? 1
                                  : event.key === "ArrowUp"
                                    ? -7
                                    : 7;
                            onRangeChange(
                              resizeMemory(
                                memories,
                                memory.id,
                                edge,
                                addDays(memory[edge], step),
                              ),
                              true,
                            );
                          }
                        }}
                      >
                        <span />
                      </button>
                    ),
                )}
            </div>
          );
        })}
      </div>
      <div className="calendar-foot">
        <span>
          <span className="key-mark" /> Click a day to listen. Drag the edges to
          stay a little longer.
        </span>
        <span>
          {
            memories.filter((m) => m.start <= days.at(-1)! && m.end >= days[0])
              .length
          }{" "}
          songs this month
        </span>
      </div>
    </div>
  );
}
