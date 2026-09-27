"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowSquareOut,
  Asterisk,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  Check,
  CloudCheck,
  DotsThree,
  Headphones,
  Pause,
  PencilSimple,
  Play,
  Plus,
  SignOut,
  SpotifyLogo,
  X,
} from "@phosphor-icons/react";
import { Calendar } from "./calendar";
import { MemoryEditor } from "./memory-editor";
import {
  dateKey,
  dayMemory,
  prettyDate,
  secondsLabel,
  spanDays,
} from "@/lib/calendar";
import { demoMemories } from "@/lib/demo";
import { useSpotifyPlayer } from "@/lib/use-spotify-player";
import type { Memory, Session } from "@/lib/types";

export function Afterglow() {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [session, setSession] = useState<Session | null>(null),
    [memories, setMemories] = useState<Memory[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [syncError, setSyncError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [editor, setEditor] = useState<{
      day: string;
      existing: Memory | null;
    } | null>(null),
    [notice, setNotice] = useState(""),
    [accountOpen, setAccountOpen] = useState(false);
  const [connectionPrompt, setConnectionPrompt] = useState(false);
  const connectionDialog = useRef<HTMLDialogElement>(null);
  const revision = useRef(0),
    pending = useRef<Memory[] | null>(null),
    busy = useRef(false),
    saved = useRef<Memory[]>([]),
    user = useRef<Session["user"]>(null),
    generation = useRef(0),
    hasLoaded = useRef(false);
  const player = useSpotifyPlayer(!!session?.user);
  const selected = memories.find((m) => m.id === selectedId) ?? null;
  const playingMemory =
    memories.find((m) => m.id === player.activeId) ?? selected;
  const isDemo = !session?.user;
  const fetchMemories = useCallback(async () => {
    const response = await fetch("/api/memories", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Your calendar could not be loaded.");
    revision.current = data.revision;
    saved.current = data.memories;
    hasLoaded.current = true;
    setMemories(data.memories);
    setSyncError(false);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const data: Session = await response.json();
        if (!response.ok) throw new Error("Could not check your account.");
        if (cancelled) return;
        setSession(data);
        user.current = data.user;
        if (data.user) {
          await fetchMemories();
        } else {
          const samples = demoMemories(new Date());
          setMemories(samples);
          setSelectedId(samples[0].id);
          setSelectedDay(samples[0].start);
        }
        const params = new URLSearchParams(window.location.search);
        if (params.get("auth_error")) {
          const reason = params.get("auth_error");
          setNotice(
            reason === "session_expired"
              ? "The Spotify connection link expired. Please connect again."
              : reason === "access_denied"
                ? "Spotify connection was cancelled. Your calendar is still here."
                : "Spotify could not connect. Please try again, and check that your account is added to the Spotify app.",
          );
          window.history.replaceState({}, "", window.location.pathname);
        }
      } catch (e) {
        if (!cancelled) {
          setSyncError(true);
          setNotice(
            e instanceof Error ? e.message : "Could not load your calendar.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMemories]);
  useEffect(() => {
    if (!session?.user) return;
    const refresh = () => {
      if (!busy.current && !editor && document.visibilityState === "visible")
        void fetchMemories().catch(() => setSyncError(true));
    };
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [session?.user, editor, fetchMemories]);
  useEffect(() => {
    if (connectionPrompt) connectionDialog.current?.showModal();
  }, [connectionPrompt]);
  const persist = useCallback(
    async (list: Memory[]) => {
      if (!user.current) return;
      if (!hasLoaded.current) {
        setNotice(
          "Load your saved calendar before making changes. Use Retry sync above.",
        );
        return;
      }
      pending.current = list;
      if (busy.current) return;
      busy.current = true;
      setSaving(true);
      const currentGeneration = generation.current;
      try {
        while (pending.current && currentGeneration === generation.current) {
          const next = pending.current;
          pending.current = null;
          const response = await fetch("/api/memories", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              memories: next,
              revision: revision.current,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            pending.current = null;
            if (response.status === 409) {
              await fetchMemories();
              throw new Error(
                "This calendar changed on another device. The latest version is loaded; please make your change again.",
              );
            }
            setMemories(saved.current);
            throw new Error(
              data.error || "Could not save your change. Please try again.",
            );
          }
          revision.current = data.revision;
          saved.current = next;
          setSyncError(false);
        }
      } catch (e) {
        pending.current = null;
        setSyncError(true);
        setNotice(
          e instanceof Error ? e.message : "Your changes could not be saved.",
        );
      } finally {
        busy.current = false;
        setSaving(false);
      }
    },
    [fetchMemories],
  );
  const changeRange = useCallback(
    (list: Memory[], commit: boolean) => {
      if (user.current && !hasLoaded.current) return;
      setMemories(list);
      if (commit) void persist(list);
    },
    [persist],
  );
  function play(memory: Memory) {
    if (!session?.user) {
      setConnectionPrompt(true);
      return;
    }
    player.clearError();
    void player.play(memory);
  }
  function select(memory: Memory, day: string) {
    setSelectedId(memory.id);
    setSelectedDay(day);
    if (player.playing && player.activeId === memory.id) void player.pause();
    else play(memory);
  }
  function add(day: string) {
    if (user.current && !hasLoaded.current) {
      setNotice(
        "Your calendar has not loaded yet. Use Retry sync before adding a song.",
      );
      return;
    }
    const occupied = dayMemory(day, memories);
    if (occupied) {
      setSelectedId(occupied.id);
      setSelectedDay(day);
      setEditor({ day, existing: occupied });
    } else setEditor({ day, existing: null });
  }
  function save(memory: Memory) {
    const next = [...memories.filter((m) => m.id !== memory.id), memory].sort(
      (a, b) => a.start.localeCompare(b.start),
    );
    setMemories(next);
    setSelectedId(memory.id);
    setSelectedDay(memory.start);
    setEditor(null);
    if (player.activeId === memory.id) void player.pause();
    void persist(next);
  }
  function remove(id: string) {
    const next = memories.filter((m) => m.id !== id);
    setMemories(next);
    setSelectedId(null);
    setEditor(null);
    if (player.activeId === id) void player.pause();
    void persist(next);
  }
  async function logout() {
    await player.pause();
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) {
      generation.current++;
      window.location.assign("/");
    } else setNotice("Could not sign out. Please try again.");
  }
  const monthStart = dateKey(month),
    monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const monthMemories = memories.filter(
    (m) => m.start <= monthEnd && m.end >= monthStart,
  );
  const monthDays = monthMemories.reduce(
    (n, m) =>
      n +
      spanDays(
        m.start < monthStart ? monthStart : m.start,
        m.end > monthEnd ? monthEnd : m.end,
      ),
    0,
  );
  const message = player.error || notice;
  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="/" className="wordmark" aria-label="Afterglow home">
          <Asterisk weight="bold" size={31} />
          <span>
            afterglow<span className="wordmark-period">.</span>
          </span>
        </a>
        <div className="header-center">
          <span className="active-tab">Your calendar</span>
          <span className="header-tagline">
            A place for the songs that stay.
          </span>
        </div>
        <div className="account-area">
          {session?.user ? (
            <>
              <button
                className="account-button"
                onClick={() => setAccountOpen(!accountOpen)}
                aria-expanded={accountOpen}
              >
                <span className="avatar">
                  {session.user.name.charAt(0).toUpperCase()}
                </span>
                <span>{session.user.name.split(" ")[0]}</span>
                <DotsThree size={21} />
              </button>
              {accountOpen && (
                <div className="account-menu">
                  <p>Connected with Spotify</p>
                  <a className="text-button" href="/api/auth/login">
                    Reconnect Spotify
                  </a>
                  <button onClick={() => void logout()}>
                    <SignOut size={17} /> Sign out
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              className="button connect-button"
              disabled={loading}
              onClick={() => setConnectionPrompt(true)}
            >
              <SpotifyLogo weight="fill" size={20} />
              <span>Connect Spotify</span>
            </button>
          )}
        </div>
      </header>
      <main>
        <div className="intro-row">
          <div>
            <p className="eyebrow">YOUR LIFE, ON REPEAT</p>
            <h1>A soundtrack to remember.</h1>
          </div>
          <div className="saved-status">
            {loading ? (
              "Opening your calendar…"
            ) : isDemo ? (
              <>
                <span className="demo-dot" /> Exploring a demo
              </>
            ) : syncError ? (
              <button
                className="text-button"
                onClick={() =>
                  void fetchMemories().catch((e) => setNotice(e.message))
                }
              >
                Retry sync
              </button>
            ) : (
              <>
                <CloudCheck size={17} />
                {saving ? "Saving your memory…" : "Private & synced"}
              </>
            )}
          </div>
        </div>
        {message && (
          <div className="notice" role="alert">
            <span>{message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => {
                setNotice("");
                player.clearError();
              }}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <div className="workspace">
          <section className="calendar-section" aria-label="Music calendar">
            <div className="month-toolbar">
              <div className="month-title">
                <h2>
                  {month.toLocaleDateString("en-US", { month: "long" })}
                  <span>{month.getFullYear()}</span>
                </h2>
                <label className="month-picker" title="Jump to a month">
                  <CalendarBlank size={17} />
                  <input
                    type="month"
                    aria-label="Jump to month"
                    value={`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`}
                    onChange={(e) => {
                      if (e.target.value) {
                        const [y, m] = e.target.value.split("-").map(Number);
                        setMonth(new Date(y, m - 1, 1));
                      }
                    }}
                  />
                </label>
              </div>
              <div className="month-controls">
                <button
                  className="today-button"
                  onClick={() =>
                    setMonth(
                      new Date(
                        new Date().getFullYear(),
                        new Date().getMonth(),
                        1,
                      ),
                    )
                  }
                >
                  Today
                </button>
                <div className="month-arrows">
                  <button
                    className="icon-button"
                    aria-label="Previous month"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() - 1, 1),
                      )
                    }
                  >
                    <CaretLeft size={19} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next month"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() + 1, 1),
                      )
                    }
                  >
                    <CaretRight size={19} />
                  </button>
                </div>
                <button
                  className="button primary add-main"
                  disabled={loading}
                  onClick={() =>
                    add(
                      dateKey(
                        new Date(
                          month.getFullYear(),
                          month.getMonth(),
                          month.getMonth() === new Date().getMonth() &&
                            month.getFullYear() === new Date().getFullYear()
                            ? new Date().getDate()
                            : 1,
                        ),
                      ),
                    )
                  }
                >
                  <Plus size={17} />
                  <span>Add a song</span>
                </button>
              </div>
            </div>
            {loading ? (
              <div className="calendar-loading" aria-busy="true">
                <Asterisk size={40} />
                <p>Every song has a time and place.</p>
              </div>
            ) : (
              <Calendar
                month={month}
                memories={memories}
                selectedId={selectedId}
                activeId={player.playing ? player.activeId : null}
                onSelect={select}
                onAdd={add}
                onRangeChange={changeRange}
              />
            )}
            <div className="month-summary">
              <div className="album-stack">
                {monthMemories.slice(0, 4).map((m) => (
                  <Image
                    key={m.id}
                    src={m.track.artwork || "/album-placeholder.svg"}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                  />
                ))}
              </div>
              <p>
                {monthMemories.length ? (
                  <>
                    <strong>{monthMemories.length} songs.</strong> {monthDays}{" "}
                    days with a soundtrack.
                  </>
                ) : (
                  <>
                    A fresh page. <strong>Give it a soundtrack.</strong>
                  </>
                )}
              </p>
              {isDemo && (
                <button
                  className="text-button"
                  onClick={() => setConnectionPrompt(true)}
                >
                  Make it yours <span>↗</span>
                </button>
              )}
            </div>
          </section>
          <aside className="memory-panel" aria-label="Selected memory">
            <div className="panel-heading">
              <span>
                {selected ? "THE SONG THAT WAS THERE" : "MAKE A MEMORY"}
              </span>
              <Headphones size={18} />
            </div>
            {selected ? (
              <>
                <div
                  className="artwork-frame"
                  style={
                    { "--song-color": selected.color } as React.CSSProperties
                  }
                >
                  <Image
                    className="feature-artwork"
                    src={selected.track.artwork || "/album-placeholder.svg"}
                    alt={`${selected.track.album} album cover`}
                    width={400}
                    height={400}
                    unoptimized
                    priority
                  />
                  <button
                    className="artwork-play"
                    aria-label={`${player.playing && player.activeId === selected.id ? "Pause" : "Play"} ${selected.track.title}`}
                    onClick={() =>
                      player.playing && player.activeId === selected.id
                        ? void player.pause()
                        : play(selected)
                    }
                  >
                    {player.playing && player.activeId === selected.id ? (
                      <Pause size={22} weight="fill" />
                    ) : (
                      <Play size={22} weight="fill" />
                    )}
                  </button>
                </div>
                <div className="detail-title">
                  <h2>{selected.track.title}</h2>
                  <p>{selected.track.artist}</p>
                  <a
                    className="spotify-attribution"
                    href={selected.track.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <SpotifyLogo size={17} weight="fill" /> Spotify{" "}
                    <ArrowSquareOut size={13} />
                  </a>
                </div>
                <div className="memory-date-range">
                  <span
                    className="color-dot"
                    style={{ background: selected.color }}
                  />
                  <span>
                    {prettyDate(selected.start)} – {prettyDate(selected.end)}
                    {selected.start.slice(0, 4) !== String(month.getFullYear())
                      ? `, ${selected.start.slice(0, 4)}`
                      : ""}
                  </span>
                  <span>{spanDays(selected.start, selected.end)} days</span>
                </div>
                {selected.note && (
                  <p className="memory-note">“{selected.note}”</p>
                )}
                <div className="favorite-part">
                  <span>THE PART YOU KEEP</span>
                  <div>
                    <span>{secondsLabel(selected.clipStartMs)}</span>
                    <div className="mini-clip">
                      <span
                        style={{
                          left: `${(selected.clipStartMs / selected.track.durationMs) * 100}%`,
                          width: `${((selected.clipEndMs - selected.clipStartMs) / selected.track.durationMs) * 100}%`,
                          background: selected.color,
                        }}
                      />
                    </div>
                    <span>{secondsLabel(selected.clipEndMs)}</span>
                  </div>
                </div>
                <button
                  className="button edit-memory"
                  onClick={() =>
                    setEditor({ day: selectedDay, existing: selected })
                  }
                >
                  <PencilSimple size={17} /> Edit memory
                </button>
              </>
            ) : (
              <div className="empty-memory">
                <div className="empty-symbol">
                  <Asterisk size={58} weight="light" />
                </div>
                <h2>
                  Some days sound
                  <br />
                  like a song.
                </h2>
                <p>
                  Pick a day. Find its song.
                  <br />
                  Keep a little piece of that time.
                </p>
                <button
                  className="button primary"
                  onClick={() => add(selectedDay)}
                >
                  <Plus size={17} /> Add your first song
                </button>
              </div>
            )}
          </aside>
        </div>
        <footer className="page-footer">
          <span>For the moments you can still hear.</span>
          <span>
            Made for listening back <Asterisk size={14} />
          </span>
        </footer>
      </main>
      <div className="player-bar" aria-label="Music player">
        <div className="now-playing">
          {playingMemory ? (
            <>
              <Image
                src={playingMemory.track.artwork || "/album-placeholder.svg"}
                alt=""
                width={46}
                height={46}
                unoptimized
              />
              <div>
                <strong>{playingMemory.track.title}</strong>
                <span>{playingMemory.track.artist}</span>
              </div>
            </>
          ) : (
            <>
              <Headphones size={28} />
              <div>
                <strong>Your soundtrack starts here</strong>
                <span>Select a song on the calendar</span>
              </div>
            </>
          )}
        </div>
        <div className="player-controls">
          <button
            className="main-play"
            disabled={!playingMemory}
            aria-label={
              player.playing ? "Pause playback" : "Play selected clip"
            }
            onClick={() =>
              player.playing
                ? void player.pause()
                : playingMemory && play(playingMemory)
            }
          >
            {player.playing ? (
              <Pause size={19} weight="fill" />
            ) : (
              <Play size={19} weight="fill" />
            )}
          </button>
          <span className="player-time">
            {secondsLabel(
              player.activeId === playingMemory?.id
                ? Math.max(playingMemory?.clipStartMs ?? 0, player.positionMs)
                : (playingMemory?.clipStartMs ?? 0),
            )}
          </span>
          <div className="player-progress">
            <span
              style={{
                width: `${playingMemory && player.activeId === playingMemory.id ? Math.min(100, Math.max(0, ((player.positionMs - playingMemory.clipStartMs) / (playingMemory.clipEndMs - playingMemory.clipStartMs)) * 100)) : 0}%`,
              }}
            />
          </div>
          <span className="player-time">
            {secondsLabel(playingMemory?.clipEndMs ?? 0)}
          </span>
        </div>
        <div className="player-caption">
          <SpotifyLogo size={20} weight="fill" />
          <span>
            {player.playing
              ? "Playing your favorite part"
              : session?.user
                ? player.ready
                  ? "Ready when you are"
                  : "Connecting player…"
                : "A little time travel"}
          </span>
        </div>
      </div>
      {editor && (
        <MemoryEditor
          key={editor.existing?.id ?? editor.day}
          day={editor.day}
          existing={editor.existing}
          memories={memories}
          demo={isDemo}
          onClose={() => {
            setEditor(null);
            if (player.playing) void player.pause();
          }}
          onSave={save}
          onDelete={remove}
          onPreview={play}
        />
      )}
      {connectionPrompt && (
        <dialog
          className="connect-dialog"
          ref={connectionDialog}
          aria-labelledby="connect-title"
          onCancel={() => setConnectionPrompt(false)}
        >
          <button
            className="icon-button dialog-close"
            aria-label="Close Spotify connection"
            onClick={() => setConnectionPrompt(false)}
          >
            <X size={22} />
          </button>
          <div className="connect-logo">
            <SpotifyLogo size={42} weight="fill" />
          </div>
          <p className="eyebrow">YOUR SONGS. YOUR DAYS.</p>
          <h2 id="connect-title">Bring your soundtrack.</h2>
          <p>
            Connect Spotify to search songs, play your favorite parts, and keep
            your calendar with you across devices.
          </p>
          <ul>
            <li>
              <Check size={17} /> Your memories stay private
            </li>
            <li>
              <Check size={17} /> Choose any part of a song
            </li>
            <li>
              <Check size={17} /> Saved to your account
            </li>
          </ul>
          {session?.configured ? (
            <a className="button primary" href="/api/auth/login">
              <SpotifyLogo size={20} weight="fill" /> Continue with Spotify
            </a>
          ) : (
            <div className="setup-message">
              Spotify connection is being set up. You can explore the demo
              calendar in the meantime.
            </div>
          )}
          <small>
            Spotify Premium is required for playback. During development, your
            Spotify account must be invited to the app.
          </small>
        </dialog>
      )}
    </div>
  );
}
