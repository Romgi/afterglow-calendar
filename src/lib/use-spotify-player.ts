"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Memory } from "./types";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const VOLUME_STORAGE_KEY = "afterglow-volume-v1";
let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.Spotify?.Player) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.removeEventListener("error", onError);
      if (window.onSpotifyWebPlaybackSDKReady === onReady) {
        window.onSpotifyWebPlaybackSDKReady = previousReady;
      }
      if (error) {
        script.remove();
        sdkPromise = null;
        reject(error);
      } else resolve();
    };
    const onError = () =>
      finish(
        new Error(
          "Spotify’s player could not load. Check your connection and try reconnecting.",
        ),
      );
    const onReady = () => {
      finish();
      if (typeof previousReady === "function") previousReady();
    };
    const timeout = window.setTimeout(onError, 20_000);
    window.onSpotifyWebPlaybackSDKReady = onReady;
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return sdkPromise;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") return new Error(error);
  }
  if (response.status === 401)
    return new Error(
      "Your Spotify connection expired. Reconnect Spotify to play music.",
    );
  if (response.status === 403)
    return new Error(
      "Spotify playback requires Premium and access to this app. Check your Spotify account.",
    );
  if (response.status === 429)
    return new Error(
      "Spotify is receiving too many requests. Wait a moment, then try again.",
    );
  return new Error(fallback);
}

interface ActiveClip {
  request: number;
  uri: string;
  start: number;
  end: number;
  duration: number;
  lastPosition: number;
  lastObservedAt: number;
  issuedAt: number;
  acknowledged: boolean;
  started: boolean;
}

export function useSpotifyPlayer(enabled: boolean) {
  const [playing, setPlaying] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(0.6);
  const [volumeSupported, setVolumeSupported] = useState(true);
  const volumeRef = useRef(0.6);
  const volumeLoadedRef = useRef(false);
  const volumeSupportedRef = useRef(true);
  const volumeWorkerRef = useRef<{ player: Spotify.Player } | null>(null);
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef<string | null>(null);
  const activeRef = useRef<ActiveClip | null>(null);
  const requestRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandsRef = useRef<Promise<void>>(Promise.resolve());
  const playControllersRef = useRef(new Set<AbortController>());

  const applyVolume = useCallback(() => {
    const player = playerRef.current;
    if (!player || !deviceRef.current || !volumeSupportedRef.current) return;
    if (volumeWorkerRef.current?.player === player) return;
    const worker = { player };
    volumeWorkerRef.current = worker;
    void (async () => {
      let applied: number | null = null;
      try {
        // One SDK write at a time; intermediate drag values collapse into the
        // latest preference instead of racing with one another.
        while (
          playerRef.current === player &&
          deviceRef.current &&
          applied !== volumeRef.current
        ) {
          const requested: number = volumeRef.current;
          try {
            await player.setVolume(requested);
          } catch {
            if (
              playerRef.current === player &&
              deviceRef.current &&
              requested === volumeRef.current
            ) {
              setError(
                "Spotify could not change volume. Try again or use your device’s volume controls.",
              );
              break;
            }
          }
          applied = requested;
        }
      } finally {
        if (volumeWorkerRef.current === worker) volumeWorkerRef.current = null;
      }
    })();
  }, []);

  const setVolume = useCallback(
    (value: number): void => {
      if (!Number.isFinite(value)) return;
      if (!volumeSupportedRef.current) {
        setError(
          "On iPhone and iPad, use your device’s volume buttons or Control Center.",
        );
        return;
      }
      const next = Math.min(1, Math.max(0, value));
      volumeRef.current = next;
      setVolumeState(next);
      try {
        window.localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
      } catch {
        // Playback remains usable when browser storage is unavailable.
      }
      applyVolume();
    },
    [applyVolume],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) clearTimeout(pollRef.current);
    if (endTimerRef.current !== null) clearTimeout(endTimerRef.current);
    pollRef.current = null;
    endTimerRef.current = null;
  }, []);

  // Serial commands prevent an older HTTP play request from arriving after a
  // newer selection or pause. Each operation also checks its request version.
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const command = commandsRef.current.catch(() => undefined).then(operation);
    commandsRef.current = command.catch(() => undefined);
    return command;
  }, []);

  const finishClip = useCallback(
    (clip: ActiveClip, player: Spotify.Player) => {
      if (
        activeRef.current !== clip ||
        requestRef.current !== clip.request ||
        playerRef.current !== player
      )
        return;
      stopPolling();
      activeRef.current = null;
      setPlaying(false);
      setPositionMs(clip.end);
      void enqueue(async () => {
        if (requestRef.current !== clip.request || playerRef.current !== player)
          return;
        try {
          await player.pause();
        } catch (cause) {
          if (
            requestRef.current === clip.request &&
            playerRef.current === player
          ) {
            setPlaying(true);
            setError(
              messageOf(
                cause,
                "Spotify could not pause at the end of your clip.",
              ),
            );
          }
        }
      });
    },
    [enqueue, stopPolling],
  );

  const armClipEnd = useCallback(
    (clip: ActiveClip, player: Spotify.Player, position: number) => {
      if (endTimerRef.current !== null) clearTimeout(endTimerRef.current);
      // Keep an independent cutoff if SDK state becomes null or stops resolving.
      // At a full-track boundary, a tiny lead avoids Spotify's next-track autoplay.
      const trackEndLead = clip.end >= clip.duration - 50 ? 50 : 0;
      endTimerRef.current = setTimeout(
        () => finishClip(clip, player),
        Math.max(0, clip.end - position - trackEndLead),
      );
    },
    [finishClip],
  );

  const consumeState = useCallback(
    (state: Spotify.PlaybackState | null) => {
      const clip = activeRef.current;
      const player = playerRef.current;
      if (
        !clip ||
        !player ||
        !clip.acknowledged ||
        clip.request !== requestRef.current
      )
        return;
      const uri = state?.track_window.current_track.uri;
      const linkedUri = state?.track_window.current_track.linked_from?.uri;
      // A transient null must not discard the independently armed clip cutoff.
      if (!state) return;
      if (uri !== clip.uri && linkedUri !== clip.uri) {
        if (clip.started) {
          const elapsed = Date.now() - clip.lastObservedAt;
          const naturalEnding =
            clip.end >= clip.duration - 100 &&
            clip.lastPosition >= clip.duration - 1_000 &&
            elapsed < 3_000 &&
            clip.lastPosition + elapsed >= clip.end - 250;
          if (naturalEnding) {
            finishClip(clip, player);
            return;
          }
          // A different track selected well before the clip ends is external
          // playback control; release it without pausing the user's new choice.
          stopPolling();
          activeRef.current = null;
          setPlaying(false);
          setActiveId(null);
        }
        return;
      }
      if (state.loading) {
        // Refresh the remaining time while buffering is positively observed,
        // but keep a cutoff if the next SDK update disappears entirely.
        clip.lastPosition = Math.max(clip.start, state.position);
        clip.lastObservedAt = Date.now();
        armClipEnd(clip, player, clip.lastPosition);
        return;
      }
      if (!clip.started) {
        if (state.paused) return;
        // A previous playback of the same song may still be in the SDK cache
        // immediately after the request. Wait for the seek/start to reach it.
        const nearStart =
          state.position >= Math.max(0, clip.start - 1_000) &&
          state.position <= clip.start + 3_000;
        if (!nearStart && state.timestamp < clip.issuedAt) return;
        clip.started = true;
        clip.lastPosition = state.position;
        clip.lastObservedAt = Date.now();
      }
      setPositionMs(state.position);
      setPlaying(!state.paused);
      if (state.position >= clip.end) {
        finishClip(clip, player);
        return;
      }
      if (state.paused) {
        if (
          clip.end >= clip.duration - 100 &&
          clip.lastPosition >= clip.duration - 1_000 &&
          clip.lastPosition + Date.now() - clip.lastObservedAt >= clip.end - 250
        ) {
          finishClip(clip, player);
          return;
        }
        stopPolling();
        activeRef.current = null;
        return;
      }
      if (clip.lastPosition !== state.position) {
        clip.lastPosition = state.position;
        clip.lastObservedAt = Date.now();
      }
      // Repeated cached SDK samples must not postpone the cutoff forever.
      const estimatedPosition =
        clip.lastPosition + Date.now() - clip.lastObservedAt;
      armClipEnd(clip, player, estimatedPosition);
    },
    [armClipEnd, finishClip, stopPolling],
  );

  const startPolling = useCallback(
    (request: number) => {
      if (pollRef.current !== null) clearTimeout(pollRef.current);
      pollRef.current = null;
      const tick = async () => {
        const player = playerRef.current;
        const clip = activeRef.current;
        if (
          !player ||
          !clip ||
          clip.request !== request ||
          requestRef.current !== request
        )
          return;
        try {
          const state = await player.getCurrentState();
          if (requestRef.current !== request || playerRef.current !== player)
            return;
          consumeState(state);
          if (
            activeRef.current === clip &&
            !clip.started &&
            Date.now() - clip.issuedAt > 15_000
          ) {
            finishClip(clip, player);
            setError(
              "Spotify did not start playback. Try the song again, or reconnect Spotify.",
            );
            return;
          }
        } catch (cause) {
          if (requestRef.current !== request || playerRef.current !== player)
            return;
          // The independent cutoff remains armed while playback status is
          // unavailable; dropping it here could leave the song running.
          setError(
            messageOf(
              cause,
              "Spotify playback is unavailable. Try reconnecting.",
            ),
          );
          return;
        }
        if (activeRef.current === clip && requestRef.current === request) {
          pollRef.current = setTimeout(() => void tick(), 150);
        }
      };
      void tick();
    },
    [consumeState, finishClip],
  );

  useEffect(() => {
    if (!volumeLoadedRef.current) {
      volumeLoadedRef.current = true;
      const { userAgent, platform, maxTouchPoints } = window.navigator;
      const supported = !(
        /iPad|iPhone|iPod/.test(userAgent) ||
        (platform === "MacIntel" && maxTouchPoints > 1)
      );
      volumeSupportedRef.current = supported;
      setVolumeSupported(supported);
      try {
        const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY);
        const parsed =
          stored === null || stored.trim() === "" ? NaN : Number(stored);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          volumeRef.current = parsed;
          setVolumeState(parsed);
        }
      } catch {
        // The default also covers private contexts that deny storage access.
      }
    }
    let alive = true;
    let connectionFailed = false;
    let instance: Spotify.Player | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    const tokenControllers = new Set<AbortController>();
    setReady(false);
    setPlaying(false);
    setError(null);
    setActiveId(null);
    setPositionMs(0);

    const fail = (message: string, disconnect = false) => {
      if (!alive) return;
      requestRef.current += 1;
      activeRef.current = null;
      stopPolling();
      setPlaying(false);
      setError(message);
      if (disconnect) {
        connectionFailed = true;
        if (connectTimer !== null) clearTimeout(connectTimer);
        deviceRef.current = null;
        setReady(false);
        instance?.disconnect();
      }
    };

    if (enabled) {
      void loadSdk()
        .then(async () => {
          if (!alive) return;
          instance = new window.Spotify.Player({
            name: "Afterglow",
            volume: volumeRef.current,
            getOAuthToken: (callback) => {
              const controller = new AbortController();
              tokenControllers.add(controller);
              const timeout = setTimeout(() => controller.abort(), 12_000);
              void (async () => {
                try {
                  const response = await fetch("/api/spotify/token", {
                    cache: "no-store",
                    credentials: "same-origin",
                    signal: controller.signal,
                  });
                  if (!response.ok)
                    throw await responseError(
                      response,
                      "Spotify could not refresh your connection. Reconnect Spotify.",
                    );
                  const body: unknown = await response.json();
                  const token =
                    body && typeof body === "object"
                      ? (body as { accessToken?: unknown }).accessToken
                      : null;
                  if (typeof token !== "string" || !token)
                    throw new Error(
                      "Spotify returned an invalid connection. Reconnect Spotify.",
                    );
                  if (alive) callback(token);
                } catch (cause) {
                  fail(
                    controller.signal.aborted
                      ? "Spotify took too long to connect. Check your connection and reconnect."
                      : messageOf(
                          cause,
                          "Spotify could not connect. Please reconnect.",
                        ),
                    true,
                  );
                } finally {
                  clearTimeout(timeout);
                  tokenControllers.delete(controller);
                }
              })();
            },
          });
          const player = instance;
          playerRef.current = player;
          player.addListener("ready", ({ device_id }) => {
            if (!alive) return;
            if (connectTimer !== null) clearTimeout(connectTimer);
            deviceRef.current = device_id;
            connectionFailed = false;
            setReady(true);
            setError(null);
            applyVolume();
          });
          player.addListener("not_ready", () => {
            if (!alive) return;
            deviceRef.current = null;
            setReady(false);
            fail(
              "Spotify’s player disconnected. Check your connection and reconnect.",
              true,
            );
          });
          player.addListener("player_state_changed", (state) => {
            if (alive) consumeState(state);
          });
          player.addListener("autoplay_failed", () =>
            fail("Your browser paused playback. Click the song again to play."),
          );
          player.addListener("account_error", () =>
            fail(
              "Spotify Premium is required to play your songs in Afterglow.",
              true,
            ),
          );
          player.addListener("authentication_error", () =>
            fail(
              "Your Spotify connection expired. Reconnect Spotify to play music.",
              true,
            ),
          );
          player.addListener("initialization_error", () =>
            fail(
              "Spotify’s browser player is unavailable. Enable protected-content playback or try another browser.",
              true,
            ),
          );
          player.addListener("playback_error", () =>
            fail(
              "Spotify could not play this song. It may be unavailable for your account.",
            ),
          );
          connectTimer = setTimeout(
            () =>
              fail(
                "Spotify’s player took too long to connect. Try reconnecting.",
                true,
              ),
            25_000,
          );
          const connected = await player.connect();
          if (alive && !connected && !connectionFailed)
            fail("Spotify’s player could not connect. Try reconnecting.", true);
        })
        .catch((cause: unknown) =>
          fail(messageOf(cause, "Spotify’s player could not load."), true),
        );
    }

    return () => {
      alive = false;
      requestRef.current += 1;
      activeRef.current = null;
      deviceRef.current = null;
      stopPolling();
      if (connectTimer !== null) clearTimeout(connectTimer);
      for (const controller of tokenControllers) controller.abort();
      for (const controller of playControllersRef.current) controller.abort();
      playControllersRef.current.clear();
      if (playerRef.current === instance) playerRef.current = null;
      instance?.disconnect();
    };
  }, [enabled, applyVolume, consumeState, stopPolling]);

  const play = useCallback(
    async (memory: Memory): Promise<void> => {
      const player = playerRef.current;
      const deviceId = deviceRef.current;
      if (!enabled || !player || !deviceId) {
        setError(
          enabled
            ? "Spotify’s player is still connecting. Try again in a moment."
            : "Connect Spotify to play your songs.",
        );
        return;
      }
      // Must happen in the original click call stack, before any await or queue.
      let activation: Promise<unknown>;
      try {
        activation = player.activateElement().then(
          () => null,
          (cause: unknown) => cause ?? new Error("Playback was blocked."),
        );
      } catch {
        setError(
          "Your browser blocked playback. Click the song again to play.",
        );
        return;
      }
      const start = Math.max(0, Math.round(memory.clipStartMs));
      const end = Math.min(
        memory.track.durationMs,
        Math.round(memory.clipEndMs),
      );
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        setError("Choose a clip with an end after its start.");
        return;
      }
      const request = ++requestRef.current;
      stopPolling();
      activeRef.current = {
        request,
        uri: memory.track.uri,
        start,
        end,
        duration: memory.track.durationMs,
        lastPosition: start,
        lastObservedAt: Date.now(),
        issuedAt: Date.now(),
        acknowledged: false,
        started: false,
      };
      setError(null);
      setPlaying(false);
      setActiveId(memory.id);
      setPositionMs(start);
      await enqueue(async () => {
        if (requestRef.current !== request || playerRef.current !== player)
          return;
        const controller = new AbortController();
        playControllersRef.current.add(controller);
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const activationError = await activation;
          if (activationError)
            throw new Error(
              "Your browser blocked playback. Click the song again to play.",
            );
          if (requestRef.current !== request || playerRef.current !== player)
            return;
          const response = await fetch("/api/spotify/play", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deviceId,
              uri: memory.track.uri,
              positionMs: start,
            }),
            signal: controller.signal,
          });
          if (!response.ok)
            throw await responseError(
              response,
              "Spotify could not play this song. Try again.",
            );
          if (requestRef.current !== request || playerRef.current !== player)
            return;
          const clip = activeRef.current;
          if (clip?.request === request) {
            clip.acknowledged = true;
            clip.issuedAt = Date.now();
            armClipEnd(clip, player, start);
            startPolling(request);
          }
        } catch (cause) {
          if (requestRef.current !== request || playerRef.current !== player)
            return;
          activeRef.current = null;
          setPlaying(false);
          setError(
            controller.signal.aborted
              ? "Spotify took too long to start the song. Try again."
              : messageOf(cause, "Spotify could not play this song."),
          );
        } finally {
          clearTimeout(timeout);
          playControllersRef.current.delete(controller);
        }
      });
    },
    [enabled, enqueue, armClipEnd, startPolling, stopPolling],
  );

  const pause = useCallback(async (): Promise<void> => {
    const player = playerRef.current;
    const request = ++requestRef.current;
    activeRef.current = null;
    stopPolling();
    setPlaying(false);
    if (!player) return;
    await enqueue(async () => {
      if (requestRef.current !== request || playerRef.current !== player)
        return;
      try {
        await player.pause();
      } catch (cause) {
        if (requestRef.current === request && playerRef.current === player) {
          setPlaying(true);
          setError(
            messageOf(cause, "Spotify could not pause playback. Try again."),
          );
        }
      }
    });
  }, [enqueue, stopPolling]);

  const clearError = useCallback(() => setError(null), []);
  return {
    play,
    pause,
    playing,
    activeId,
    positionMs,
    ready,
    error,
    clearError,
    volume,
    setVolume,
    volumeSupported,
  };
}
