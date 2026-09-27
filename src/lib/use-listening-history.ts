"use client";

import { useEffect } from "react";
import { dateKey } from "./calendar";
import { listeningWeek } from "./listening";

export const SUGGESTION_DAY_KEY = "afterglow-suggestion-day";

// Keep a private record of the recent plays Spotify makes available while the
// calendar is open, so suggestions remain useful when revisiting earlier weeks.
export function useListeningHistory(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let busy = false;
    let stopped = false;
    let lastAttempt = 0;
    async function sync() {
      if (
        busy ||
        stopped ||
        document.visibilityState !== "visible" ||
        Date.now() - lastAttempt < 120_000
      )
        return;
      busy = true;
      lastAttempt = Date.now();
      try {
        const { from, to } = listeningWeek(dateKey(new Date()));
        const response = await fetch("/api/spotify/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Afterglow-User": userId!,
          },
          body: JSON.stringify({ from, to }),
          signal: controller.signal,
        });
        const data = await response.json();
        // The song picker explains permission and connection problems. Avoid
        // repeated background requests until the account is connected again.
        if (
          data.status === "connect" ||
          response.status === 401 ||
          response.status === 409
        )
          stopped = true;
      } catch {
        // Suggestions have their own visible retry state; calendar sync is separate.
      } finally {
        busy = false;
      }
    }
    void sync();
    const timer = setInterval(() => void sync(), 300_000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [userId]);
}
