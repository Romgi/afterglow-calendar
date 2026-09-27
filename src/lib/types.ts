export interface Track {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  durationMs: number;
  url: string;
}

export interface Memory {
  id: string;
  track: Track;
  start: string;
  end: string;
  clipStartMs: number;
  clipEndMs: number;
  color: string;
  note: string;
}

export interface Session {
  configured: boolean;
  user: { id: string; name: string; image?: string } | null;
}
