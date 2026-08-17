// BGM content is intentionally empty for now. This controller only preserves
// lifecycle/intensity state so music can be added later without changing the
// UI, game domain, or audio-engine public API.
export function createMusicController() {
  let audio = null;
  let output = null;
  let scene = "silent";
  let intensity = 1;

  return {
    attach({ context, output: nextOutput } = {}) {
      audio = context || null;
      output = nextOutput || null;
    },
    setScene(nextScene) {
      scene = nextScene || "silent";
    },
    setIntensity(nextIntensity) {
      intensity = Math.max(1, Math.floor(Number(nextIntensity) || 1));
    },
    stop() {
      scene = "silent";
    },
    dispose() {
      audio = null;
      output = null;
      scene = "silent";
    },
    getState() {
      return { scene, intensity, attached: Boolean(audio && output) };
    }
  };
}