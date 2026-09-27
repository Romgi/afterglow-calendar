"use client";

import { SpeakerHigh, SpeakerLow, SpeakerX } from "@phosphor-icons/react";

export function VolumeControl({
  volume,
  supported,
  onChange,
}: {
  volume: number;
  supported: boolean;
  onChange: (volume: number) => void;
}) {
  const percent = Math.round(volume * 100);
  const Icon =
    percent === 0 ? SpeakerX : percent <= 50 ? SpeakerLow : SpeakerHigh;

  if (!supported) {
    return (
      <div
        className="volume-device"
        title="Spotify on iPhone and iPad uses your device's volume buttons."
      >
        <SpeakerHigh size={19} aria-hidden="true" />
        <span>Use device volume</span>
      </div>
    );
  }

  return (
    <div className="volume-control">
      <Icon size={19} weight="regular" aria-hidden="true" />
      <input
        className="volume-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label="Volume"
        aria-valuetext={`${percent}%`}
        title={`Volume: ${percent}%`}
        style={{ "--volume-level": `${percent}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <span className="volume-value" aria-hidden="true">
        {percent}%
      </span>
    </div>
  );
}
