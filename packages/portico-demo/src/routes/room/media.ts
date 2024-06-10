import { useCallback, useEffect, useState } from "react";

export interface StreamControls {
  audio: TrackControls;
  video: TrackControls;
}

export interface TrackControls {
  available: boolean;
  enabled: boolean;
  toggle(): void;
}

export function useStreamControls(
  stream: MediaStream | undefined
): StreamControls {
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);

  const toggleAudio = useCallback(() => {
    if (stream == null) return;
    setAudioEnabled(toggle(stream.getAudioTracks()));
  }, [stream]);
  const toggleVideo = useCallback(() => {
    if (stream == null) return;
    setVideoEnabled(toggle(stream.getVideoTracks()));
  }, [stream]);

  useEffect(() => {
    if (stream != null) {
      const [audio, video] = [stream.getAudioTracks(), stream.getVideoTracks()];
      setAudioAvailable(audio.length > 0);
      setAudioEnabled(audio.some((track) => track.enabled));
      setVideoAvailable(video.length > 0);
      setVideoEnabled(video.some((track) => track.enabled));
    } else {
      setAudioAvailable(false);
      setAudioEnabled(false);
      setVideoAvailable(false);
      setVideoEnabled(false);
    }
  }, [stream]);

  return {
    audio: {
      available: audioAvailable,
      enabled: audioEnabled,
      toggle: toggleAudio,
    },
    video: {
      available: videoAvailable,
      enabled: videoEnabled,
      toggle: toggleVideo,
    },
  };
}

function toggle(tracks: MediaStreamTrack[]): boolean {
  let enabled: boolean | undefined;
  for (const track of tracks) {
    if (enabled == null) enabled = !track.enabled;
    track.enabled = enabled;
  }
  return enabled ?? false;
}
