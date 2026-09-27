"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  ArrowClockwise,
  Headphones,
  Plus,
  SpotifyLogo,
} from "@phosphor-icons/react";
import { dateKey, prettyDate } from "@/lib/calendar";
import { listeningWeek, type SuggestionsResponse } from "@/lib/listening";
import { demoTracks } from "@/lib/demo";
import { SUGGESTION_DAY_KEY } from "@/lib/use-listening-history";
import type { Track } from "@/lib/types";

export function SongSuggestions({
  day,
  userId,
  onChoose,
}: {
  day: string;
  userId?: string;
  onChoose: (track: Track) => void;
}) {
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!userId);
  const [attempt, setAttempt] = useState(0);
  const { from, to, startDay, endDay } = listeningWeek(day);
  const future = startDay > dateKey(new Date());

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError("");
    (async () => {
      try {
        const response = await fetch("/api/spotify/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Afterglow-User": userId,
          },
          body: JSON.stringify({ from, to }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result.code === "account_changed") {
          window.location.reload();
          return;
        }
        if (response.status === 401) {
          setData({
            status: "connect",
            tracks: [],
            totalPlays: 0,
            lastSyncedAt: null,
          });
          return;
        }
        if (!response.ok)
          throw new Error(
            result.error || "Your listening history could not be loaded.",
          );
        setData(result);
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Your listening history could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [userId, from, to, attempt]);

  function rememberDay() {
    try {
      sessionStorage.setItem(SUGGESTION_DAY_KEY, day);
    } catch {
      /* Storage may be disabled. */
    }
  }

  const tracks = userId
    ? (data?.tracks ?? [])
    : demoTracks.map((track) => ({ track, plays: 0 }));
  return (
    <section
      className="song-suggestions"
      aria-labelledby="suggestions-title"
      aria-busy={loading}
    >
      <div className="suggestions-heading">
        <div>
          <h3 id="suggestions-title">
            <Headphones size={18} />
            {userId ? "On repeat that week" : "Your week, on repeat"}
          </h3>
          <p>
            {prettyDate(startDay)} – {prettyDate(endDay, true)}
          </p>
        </div>
        {userId && !loading && data?.status !== "connect" && (
          <button
            className="icon-button"
            aria-label="Refresh song suggestions"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <ArrowClockwise size={18} />
          </button>
        )}
      </div>
      <div aria-live="polite">
        {!loading && data?.status === "connect" && (
          <div className="suggestions-empty">
            <h4>Bring back what was on repeat.</h4>
            <p>
              Reconnect Spotify to allow listening history. We’ll save available
              plays privately for your weekly suggestions.
            </p>
            <a
              className="button suggestions-connect"
              href="/api/auth/login"
              onClick={rememberDay}
            >
              <SpotifyLogo size={18} weight="fill" /> Enable song suggestions
            </a>
          </div>
        )}
        {loading ? (
          <div className="suggestions-loading">
            <p>Finding the songs you kept coming back to…</p>
            {[0, 1, 2].map((n) => (
              <div className="suggestion-skeleton" key={n} aria-hidden="true">
                <i />
                <span />
              </div>
            ))}
          </div>
        ) : data?.status === "connect" && !tracks.length ? null : error ||
          (data?.status === "unavailable" && !tracks.length) ? (
          <div className="suggestions-empty">
            <h4>Suggestions are taking a break.</h4>
            <p>
              {error ||
                data?.message ||
                "Spotify couldn’t share your recent plays. You can still search for any song above."}
            </p>
            <button
              className="text-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <ArrowClockwise size={15} /> Try again
            </button>
          </div>
        ) : !tracks.length ? (
          <div className="suggestions-empty">
            <h4>
              {future
                ? "This week is still unwritten."
                : "No recorded plays for this week."}
            </h4>
            <p>
              {future
                ? "Come back after a little listening, or search for a song to set the mood."
                : "Spotify only shares recent listening history. We’ll keep the plays we can collect while Afterglow is open, so you can revisit them later."}
            </p>
          </div>
        ) : (
          <>
            {!userId && (
              <p className="suggestions-demo">
                Connect Spotify for suggestions from your listening history. For
                now, try an example song.
              </p>
            )}
            <ol className="suggestion-list">
              {tracks.map(({ track, plays }, index) => (
                <li key={track.id}>
                  <button
                    className="suggestion-track"
                    onClick={() => onChoose(track)}
                    aria-label={`Choose ${track.title} by ${track.artist}${plays ? `, ${plays} recorded ${plays === 1 ? "play" : "plays"} this week` : ""}`}
                  >
                    {userId && (
                      <span className="suggestion-rank" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    )}
                    <Image
                      src={track.artwork || "/album-placeholder.svg"}
                      alt=""
                      width={48}
                      height={48}
                      unoptimized
                    />
                    <span className="suggestion-track-info">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                    {userId && (
                      <span className="suggestion-plays">
                        {plays}
                        <small>{plays === 1 ? "play" : "plays"}</small>
                      </span>
                    )}
                    <Plus
                      className="suggestion-add"
                      size={18}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ol>
            {userId && (
              <p className="suggestions-note">
                {data?.status !== "ready" ? "Showing saved history. " : ""}
                Ranked from {data?.totalPlays} recorded plays this week.
                Spotify’s recent history may not include every listen.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
