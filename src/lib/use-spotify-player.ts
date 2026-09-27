"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Memory } from "./types";

const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
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
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef<string | null>(null);
  const activeRef = useRef<ActiveClip | null>(null);
  const requestRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandsRef = useRef<Promise<void>>(Promise.resolve());
  const playControllersRef = useRef(new Set<AbortController>());

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  // Serial commands prevent an older HTTP play request from arriving after a
  // newer selection or pause. Each operation also checks its request version.
  const enqueue = useCallback((operation: () => Promise<void>) => {
    const command = commandsRef.current.catch(() => undefined).then(operation);
    commandsRef.current = command.catch(() => undefined);
    return command;
  }, []);

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
      if (!state || (uri !== clip.uri && linkedUri !== clip.uri)) {
        if (clip.started) {
          stopPolling();
          activeRef.current = null;
          setPlaying(false);
          setActiveId(null);
        }
        return;
      }
      if (state.loading) return;
      if (!clip.started) {
        if (state.paused) return;
        // A previous playback of the same song may still be in the SDK cache
        // immediately after the request. Wait for the seek/start to reach it.
        const nearStart =
          state.position >= Math.max(0, clip.start - 1_000) &&
          state.position <= clip.start + 3_000;
        if (!nearStart && state.timestamp < clip.issuedAt) return;
        clip.started = true;
      }
      setPositionMs(state.position);
      setPlaying(!state.paused);
      if (state.paused) {
        stopPolling();
        activeRef.current = null;
        return;
      }
      if (state.position >= clip.end) {
        stopPolling();
        activeRef.current = null;
        setPlaying(false);
        setPositionMs(clip.end);
        void enqueue(async () => {
          if (
            requestRef.current !== clip.request ||
            playerRef.current !== player
          )
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
      }
    },
    [enqueue, stopPolling],
  );

  const startPolling = useCallback(
    (request: number) => {
      stopPolling();
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
            activeRef.current = null;
            setPlaying(false);
            setError(
              "Spotify did not start playback. Try the song again, or reconnect Spotify.",
            );
            return;
          }
        } catch (cause) {
          if (requestRef.current !== request || playerRef.current !== player)
            return;
          activeRef.current = null;
          setPlaying(false);
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
    [consumeState, stopPolling],
  );

  useEffect(() => {
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
            volume: 0.6,
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
          });
          player.addListener("not_ready", () => {
            if (!alive) return;
            deviceRef.current = null;
            setReady(false);
            fail(
              "Spotify’s player disconnected. Check your connection and reconnect.",
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
  }, [enabled, consumeState, stopPolling]);

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
    [enabled, enqueue, startPolling, stopPolling],
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
  };
}
