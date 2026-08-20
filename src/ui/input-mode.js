const INPUT_MODES = Object.freeze({
  keyboard: "keyboard",
  touch: "touch",
  controller: "controller"
});

const INTERACTIVE_SELECTOR = "button, input, select, textarea, [role='button'], [tabindex]";

export function getInitialInputMode(matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  if (typeof matchMedia !== "function") return INPUT_MODES.keyboard;
  try {
    return matchMedia("(hover: none) and (pointer: coarse)")?.matches
      ? INPUT_MODES.touch
      : INPUT_MODES.keyboard;
  } catch {
    return INPUT_MODES.keyboard;
  }
}

export function createInputMode({
  root = globalThis.document?.querySelector?.(".console-layout"),
  manual = globalThis.document?.querySelector?.("#startup-manual"),
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  matchMedia = globalThis.matchMedia?.bind(globalThis)
} = {}) {
  const validModes = new Set(Object.values(INPUT_MODES));
  let mode = getInitialInputMode(matchMedia);

  function applyMode() {
    if (documentObject?.documentElement?.dataset) documentObject.documentElement.dataset.inputMode = mode;
    if (root?.dataset) root.dataset.inputMode = mode;
  }

  function setMode(nextMode) {
    if (!validModes.has(nextMode)) throw new Error(`Unknown input mode: ${nextMode}`);
    if (mode === nextMode) return false;
    mode = nextMode;
    applyMode();
    return true;
  }

  function handleKeyDown() {
    setMode(INPUT_MODES.keyboard);
  }

  function handlePointerDown(event) {
    if (event?.pointerType !== "touch" && event?.pointerType !== "pen") return;
    const interactive = event.target?.closest?.(INTERACTIVE_SELECTOR);
    if (!interactive) return;
    const belongsToUi = root?.contains?.(interactive) || manual?.contains?.(interactive);
    if (belongsToUi) setMode(INPUT_MODES.touch);
  }

  applyMode();
  windowObject?.addEventListener?.("keydown", handleKeyDown, true);
  documentObject?.addEventListener?.("pointerdown", handlePointerDown, true);

  return {
    getMode: () => mode,
    setMode,
    destroy() {
      windowObject?.removeEventListener?.("keydown", handleKeyDown, true);
      documentObject?.removeEventListener?.("pointerdown", handlePointerDown, true);
    }
  };
}