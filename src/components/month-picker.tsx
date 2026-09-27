"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Check,
} from "@phosphor-icons/react";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

export function MonthPicker({
  month,
  onChange,
}: {
  month: Date;
  onChange: (month: Date) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const monthButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(month.getFullYear());
  const [yearText, setYearText] = useState(String(month.getFullYear()));

  const positionPanel = useCallback(() => {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    panel.current.style.maxHeight = `${Math.max(0, height - 24)}px`;
    panel.current.style.maxWidth = `${Math.max(0, width - 24)}px`;
    const bounds = panel.current.getBoundingClientRect();
    const titleLeft =
      trigger.current.parentElement?.getBoundingClientRect().left ??
      anchor.left;
    const left = Math.max(
      leftEdge + 12,
      Math.min(titleLeft, leftEdge + width - bounds.width - 12),
    );
    const below = anchor.bottom + 10;
    const above = anchor.top - bounds.height - 10;
    const preferredTop =
      below + bounds.height <= topEdge + height - 12 ? below : above;
    const top = Math.max(
      topEdge + 12,
      Math.min(preferredTop, topEdge + height - bounds.height - 12),
    );
    panel.current.style.left = `${left}px`;
    panel.current.style.top = `${top}px`;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        positionPanel();
    };
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.visualViewport?.addEventListener("resize", positionPanel);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", positionPanel);
    };
  }, [open, positionPanel]);

  function browseYear(value: number) {
    const next = Math.max(MIN_YEAR, Math.min(MAX_YEAR, value));
    setYear(next);
    setYearText(String(next));
  }

  function choose(value: Date) {
    onChange(value);
    panel.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="month-jump-trigger"
        aria-label="Choose month and year"
        title="Choose month and year"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onClick={(event) => {
          event.preventDefault();
          if (panel.current?.matches(":popover-open")) {
            panel.current.hidePopover();
          } else {
            browseYear(month.getFullYear());
            panel.current?.showPopover();
            positionPanel();
            monthButtons.current[month.getMonth()]?.focus({
              preventScroll: true,
            });
          }
        }}
      >
        <CalendarBlank size={20} />
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="month-jump-panel"
        onToggle={(event) =>
          setOpen((event.nativeEvent as ToggleEvent).newState === "open")
        }
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof Node &&
            !event.currentTarget.contains(next) &&
            next !== trigger.current
          )
            panel.current?.hidePopover();
        }}
      >
        <h3 id={`${id}-title`}>Jump to a month</h3>
        <span
          className="month-jump-announcement"
          aria-live="polite"
          aria-atomic="true"
        >
          {open ? `Showing months in ${year}` : ""}
        </span>
        <div className="month-jump-year">
          <button
            type="button"
            aria-label="Previous year"
            disabled={year === MIN_YEAR}
            onClick={() => browseYear(year - 1)}
          >
            <CaretLeft size={20} />
          </button>
          <input
            aria-label="Year"
            aria-describedby={`${id}-hint`}
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={yearText}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, "");
              setYearText(value);
              if (
                value.length === 4 &&
                Number(value) >= MIN_YEAR &&
                Number(value) <= MAX_YEAR
              )
                setYear(Number(value));
            }}
            onBlur={() => setYearText(String(year))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setYearText(String(year));
                monthButtons.current[month.getMonth()]?.focus();
              }
            }}
          />
          <button
            type="button"
            aria-label="Next year"
            disabled={year === MAX_YEAR}
            onClick={() => browseYear(year + 1)}
          >
            <CaretRight size={20} />
          </button>
        </div>
        <p id={`${id}-hint`} className="month-jump-hint">
          Use the arrows, or type a year.
        </p>
        <div
          className="month-jump-grid"
          role="group"
          aria-label={`Months in ${year}`}
        >
          {MONTHS.map((name, index) => {
            const selected =
              year === month.getFullYear() && index === month.getMonth();
            return (
              <button
                key={name}
                ref={(node) => {
                  monthButtons.current[index] = node;
                }}
                type="button"
                aria-label={`${name} ${year}`}
                aria-pressed={selected}
                onClick={() => choose(new Date(year, index, 1))}
                onKeyDown={(event) => {
                  const offset = {
                    ArrowRight: 1,
                    ArrowLeft: -1,
                    ArrowDown: 3,
                    ArrowUp: -3,
                  }[event.key];
                  const target =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 11
                        : offset !== undefined
                          ? (index + offset + 12) % 12
                          : null;
                  if (target !== null) {
                    event.preventDefault();
                    monthButtons.current[target]?.focus();
                  }
                }}
              >
                {name}
                {selected && <Check size={13} weight="bold" />}
              </button>
            );
          })}
        </div>
        <button
          className="month-jump-today"
          type="button"
          onClick={() => {
            const now = new Date();
            choose(new Date(now.getFullYear(), now.getMonth(), 1));
          }}
        >
          Back to this month <ArrowRight size={18} />
        </button>
      </div>
    </>
  );
}
