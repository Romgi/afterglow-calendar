import type { Memory, Track } from "./types";
import { dateKey } from "./calendar";

export const demoTracks: Track[] = [
  {
    id: "0ofHAoxe9vBkTCp2UQIavz",
    uri: "spotify:track:0ofHAoxe9vBkTCp2UQIavz",
    title: "Dreams",
    artist: "Fleetwood Mac",
    album: "Rumours",
    artwork:
      "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02e52a59a28efa4773dd2bfe1b",
    durationMs: 257800,
    url: "https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz",
  },
  {
    id: "3xKsf9qdS1CyvXSMEid6g8",
    uri: "spotify:track:3xKsf9qdS1CyvXSMEid6g8",
    title: "Pink + White",
    artist: "Frank Ocean",
    album: "Blonde",
    artwork:
      "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02c5649add07ed3720be9d5526",
    durationMs: 184516,
    url: "https://open.spotify.com/track/3xKsf9qdS1CyvXSMEid6g8",
  },
  {
    id: "7H0ya83CMmgFcOhw0UB6ow",
    uri: "spotify:track:7H0ya83CMmgFcOhw0UB6ow",
    title: "Space Song",
    artist: "Beach House",
    album: "Depression Cherry",
    artwork:
      "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e029b7190e673e46271b2754aab",
    durationMs: 320466,
    url: "https://open.spotify.com/track/7H0ya83CMmgFcOhw0UB6ow",
  },
  {
    id: "2X485T9Z5Ly0xyaghN73ed",
    uri: "spotify:track:2X485T9Z5Ly0xyaghN73ed",
    title: "Let It Happen",
    artist: "Tame Impala",
    album: "Currents",
    artwork:
      "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e029e1cfc756886ac782e363d79",
    durationMs: 467586,
    url: "https://open.spotify.com/track/2X485T9Z5Ly0xyaghN73ed",
  },
];
export function demoMemories(month: Date): Memory[] {
  const intervals = [
    [2, 8],
    [10, 14],
    [17, 23],
    [25, 30],
  ];
  const colors = ["#BDAE94", "#8FAF91", "#AF5557", "#917AAB"];
  const notes = [
    "Windows down. Taking the long way home.",
    "The last few slow days of summer.",
    "Late nights, nowhere in particular.",
    "A new season, a new feeling.",
  ];
  return demoTracks.map((track, i) => ({
    id: `demo-${i}`,
    track,
    start: dateKey(
      new Date(month.getFullYear(), month.getMonth(), intervals[i][0]),
    ),
    end: dateKey(
      new Date(
        month.getFullYear(),
        month.getMonth(),
        Math.min(
          intervals[i][1],
          new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
        ),
      ),
    ),
    clipStartMs: i === 0 ? 45000 : 30000,
    clipEndMs: i === 0 ? 75000 : 60000,
    color: colors[i],
    note: notes[i],
  }));
}
