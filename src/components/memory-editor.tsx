"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Check,
  MagnifyingGlass,
  Play,
  Plus,
  SpotifyLogo,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  defaultEnd,
  prettyDate,
  rangeConflict,
  secondsLabel,
  spanDays,
} from "@/lib/calendar";
import { albumColor } from "@/lib/color";
import { demoTracks } from "@/lib/demo";
import type { Memory, Track } from "@/lib/types";

interface Props {
  day: string;
  existing: Memory | null;
  memories: Memory[];
  demo: boolean;
  onClose: () => void;
  onSave: (memory: Memory) => void;
  onDelete: (id: string) => void;
  onPreview: (memory: Memory) => void;
}
export function MemoryEditor({
  day,
  existing,
  memories,
  demo,
  onClose,
  onSave,
  onDelete,
  onPreview,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [track, setTrack] = useState<Track | null>(existing?.track ?? null);
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Track[]>(demo ? demoTracks : []),
    [searching, setSearching] = useState(false),
    [error, setError] = useState("");
  const [start, setStart] = useState(existing?.start ?? day),
    [end, setEnd] = useState(existing?.end ?? defaultEnd(day, memories));
  const [clipStart, setClipStart] = useState(existing?.clipStartMs ?? 0),
    [clipEnd, setClipEnd] = useState(existing?.clipEndMs ?? 30000);
  const [color, setColor] = useState(existing?.color ?? "#9CAAA0"),
    [note, setNote] = useState(existing?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false),
    [colorLoading, setColorLoading] = useState(false);
  const selection = useRef(0);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  useEffect(() => {
    if (demo) {
      setResults(
        demoTracks.filter((t) =>
          `${t.title} ${t.artist}`.toLowerCase().includes(query.toLowerCase()),
        ),
      );
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const response = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Could not search Spotify.");
        setResults(data.tracks);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not search Spotify.",
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, demo]);
  async function choose(value: Track) {
    const request = ++selection.current;
    setTrack(value);
    setClipStart(0);
    setClipEnd(Math.min(value.durationMs, 30000));
    setColorLoading(true);
    const extracted = await albumColor(value.artwork);
    if (request === selection.current) {
      setColor(extracted);
      setColorLoading(false);
    }
  }
  function memory(): Memory | null {
    return track
      ? {
          id: existing?.id ?? crypto.randomUUID(),
          track,
          start,
          end,
          clipStartMs: clipStart,
          clipEndMs: clipEnd,
          color,
          note,
        }
      : null;
  }
  function save() {
    const value = memory();
    if (!value) return;
    if (!start || !end || start > end) {
      setError("Choose an end date on or after the start.");
      return;
    }
    if (rangeConflict(value, memories)) {
      setError(
        "Those dates already have a song. Choose a free range or adjust the other song first.",
      );
      return;
    }
    if (clipStart >= clipEnd) {
      setError("The end of your clip needs to come after the start.");
      return;
    }
    onSave(value);
  }
  return (
    <dialog
      ref={dialog}
      className="editor"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      aria-labelledby="editor-title"
    >
      <div className="editor-head">
        <div>
          <p className="eyebrow">
            {existing ? "KEEP THE FEELING" : "A SONG FOR THIS CHAPTER"}
          </p>
          <h2 id="editor-title">
            {existing ? "Edit this memory" : "What did it sound like?"}
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close song editor"
          onClick={onClose}
        >
          <X size={22} />
        </button>
      </div>
      {!track ? (
        <>
          <div className="editor-date">
            Starting {prettyDate(day, true)} <span>· up to 7 days</span>
          </div>
          <label className="search-field">
            <MagnifyingGlass size={22} />
            <input
              autoFocus
              type="search"
              placeholder="Search for a song or artist"
              aria-label="Search Spotify songs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="search-results" aria-live="polite">
            {searching ? (
              <p className="search-message">Finding your song…</p>
            ) : results.length ? (
              results.map((result) => (
                <button
                  key={result.id}
                  className="search-result"
                  onClick={() => void choose(result)}
                >
                  <Image
                    src={result.artwork || "/album-placeholder.svg"}
                    alt={`${result.album} album cover`}
                    width={52}
                    height={52}
                    unoptimized
                  />
                  <span>
                    <strong>{result.title}</strong>
                    <small>
                      {result.artist} · {result.album}
                    </small>
                  </span>
                  <Plus size={20} />
                </button>
              ))
            ) : (
              <p className="search-message">
                {query.length >= 2
                  ? "No songs found. Try a different title or artist."
                  : "Find the song that takes you back."}
              </p>
            )}
          </div>
          <div className="search-source">
            <SpotifyLogo size={20} weight="fill" />
            {demo
              ? "Example songs · connect Spotify to search your music"
              : "Search powered by Spotify"}
          </div>
        </>
      ) : (
        <>
          <button
            className="text-button back-button"
            onClick={() => {
              selection.current++;
              setTrack(null);
              setColorLoading(false);
            }}
          >
            <ArrowLeft size={15} /> Choose another song
          </button>
          <div className="chosen-track">
            <Image
              src={track.artwork || "/album-placeholder.svg"}
              alt={`${track.album} album cover`}
              width={80}
              height={80}
              unoptimized
            />
            <div>
              <h3>{track.title}</h3>
              <p>{track.artist}</p>
              <a href={track.url} target="_blank" rel="noreferrer">
                <SpotifyLogo size={15} weight="fill" /> Listen on Spotify
              </a>
            </div>
          </div>
          <div className="form-section">
            <div className="section-label">
              <h3>The days it belongs to</h3>
              <span>{start <= end ? spanDays(start, end) : 0} days</span>
            </div>
            <div className="date-inputs">
              <label>
                From
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <span>→</span>
              <label>
                Through
                <input
                  type="date"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="form-section">
            <div className="section-label">
              <h3>Your favorite part</h3>
              <button
                className="text-button"
                onClick={() => {
                  const m = memory();
                  if (m) onPreview(m);
                }}
              >
                <Play size={14} weight="fill" /> Preview
              </button>
            </div>
            <div
              className="clip-track"
              style={
                {
                  "--clip-start": `${(clipStart / track.durationMs) * 100}%`,
                  "--clip-end": `${(clipEnd / track.durationMs) * 100}%`,
                  "--song-color": color,
                } as React.CSSProperties
              }
            >
              <div className="clip-selection" />
            </div>
            <div className="clip-controls">
              <label>
                <span>
                  Starts at <b>{secondsLabel(clipStart)}</b>
                </span>
                <input
                  type="range"
                  aria-label="Clip start"
                  min="0"
                  max={Math.max(0, track.durationMs - 1000)}
                  step="1000"
                  value={clipStart}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setClipStart(Math.min(v, clipEnd - 1000));
                  }}
                />
              </label>
              <label>
                <span>
                  Ends at <b>{secondsLabel(clipEnd)}</b>
                </span>
                <input
                  type="range"
                  aria-label="Clip end"
                  min="1000"
                  max={track.durationMs}
                  step="1000"
                  value={clipEnd}
                  onChange={(e) =>
                    setClipEnd(
                      Math.max(Number(e.target.value), clipStart + 1000),
                    )
                  }
                />
              </label>
            </div>
            <p className="field-hint">
              {secondsLabel(clipEnd - clipStart)} of a{" "}
              {secondsLabel(track.durationMs)} song. Playback stops at your end
              point.
            </p>
          </div>
          <div className="note-color">
            <label className="note-field">
              A little context <span>optional</span>
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Where does this song take you?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="color-field">
              Color
              <input
                type="color"
                aria-label="Calendar color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <span>{colorLoading ? "Finding…" : "From the cover"}</span>
            </label>
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {track && (
        <div className="editor-actions">
          {existing ? (
            <button
              className={`text-button delete-button ${confirmDelete ? "confirm-delete" : ""}`}
              onClick={() => {
                if (confirmDelete) onDelete(existing.id);
                else setConfirmDelete(true);
              }}
            >
              <Trash size={17} />
              {confirmDelete ? "Confirm remove" : "Remove song"}
            </button>
          ) : (
            <span />
          )}
          <button
            className="button primary"
            onClick={save}
            disabled={colorLoading}
          >
            <Check size={17} />
            {existing ? "Save changes" : "Add to calendar"}
          </button>
        </div>
      )}
    </dialog>
  );
}
