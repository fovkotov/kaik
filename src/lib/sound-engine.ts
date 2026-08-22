let audioContext: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

function resumeNow(ctx: AudioContext) {
  if (ctx.state === "running" || ctx.state === "closed") return;
  try {
    const pending = ctx.resume();
    void pending.catch(() => {});
  } catch {
    // Web Audio failures are silent.
  }
}

function createContext(): AudioContext {
  try {
    return new AudioContext({ latencyHint: 0 });
  } catch {
    try {
      return new AudioContext({ latencyHint: "interactive" });
    } catch {
      return new AudioContext();
    }
  }
}

export function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = createContext();
  }
  resumeNow(audioContext);
  return audioContext;
}

export async function decodeAudioData(dataUri: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(dataUri);
  if (cached) return cached;

  const ctx = getAudioContext();
  const base64 = dataUri.split(",")[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  bufferCache.set(dataUri, audioBuffer);
  return audioBuffer;
}

export interface PlaySoundOptions {
  volume?: number;
  playbackRate?: number;
  onEnd?: () => void;
}

export interface SoundPlayback {
  stop: () => void;
}

function startPlayback(
  ctx: AudioContext,
  buffer: AudioBuffer,
  volume: number,
  playbackRate: number,
  onEnd?: () => void
): SoundPlayback {
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();

  source.buffer = buffer;
  source.playbackRate.value = playbackRate;
  gain.gain.value = volume / 3;

  source.connect(gain);
  gain.connect(ctx.destination);

  source.onended = () => {
    onEnd?.();
  };

  source.start(ctx.currentTime);

  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // No-op if already stopped.
      }
    },
  };
}

export async function playSound(
  dataUri: string,
  options: PlaySoundOptions = {}
): Promise<SoundPlayback> {
  const { volume = 1, playbackRate = 1, onEnd } = options;
  const ctx = getAudioContext();
  resumeNow(ctx);

  const cached = bufferCache.get(dataUri);
  if (cached) return startPlayback(ctx, cached, volume, playbackRate, onEnd);

  const buffer = await decodeAudioData(dataUri);
  return startPlayback(ctx, buffer, volume, playbackRate, onEnd);
}
