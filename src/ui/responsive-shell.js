const DEFAULT_NATURAL_WIDTH = 576;
const DESKTOP_MAX_SCALE = 1.12;
const TOUCH_MAX_SCALE = 1;

function finitePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getResponsiveShellScale({
  availableWidth,
  availableHeight,
  shellWidth,
  shellHeight,
  maxScale = DESKTOP_MAX_SCALE
}) {
  const naturalWidth = finitePositive(shellWidth, DEFAULT_NATURAL_WIDTH);
  const naturalHeight = finitePositive(shellHeight, 1);
  const width = finitePositive(availableWidth, naturalWidth);
  const height = finitePositive(availableHeight, naturalHeight * maxScale);
  const widthScale = width / naturalWidth;
  const heightScale = height / naturalHeight;

  return Math.min(maxScale, widthScale, heightScale);
}

export function createResponsiveShell({ stage, frame, shell, viewport = window }) {
  if (!stage || !frame || !shell) throw new Error("responsive shell elements are required");

  const coarsePointer = viewport.matchMedia?.("(pointer: coarse)");
  const compactLayout = viewport.matchMedia?.("(max-width: 699px)");
  let scheduledFrame = null;

  function getPixelProperty(element, property) {
    const styles = element && viewport.getComputedStyle?.(element);
    const value = Number.parseFloat(styles?.getPropertyValue(property));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function getReservedHeight() {
    const styles = viewport.getComputedStyle?.(stage);
    if (!styles) return 0;
    const value = Number.parseFloat(styles.getPropertyValue("--game-stage-reserved-height"));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function getBottomClearance(stageRect) {
    const cabinet = stage.closest?.(".arcade-cabinet");
    const cabinetRect = cabinet?.getBoundingClientRect?.();
    const body = stage.ownerDocument?.body;
    const cabinetRemainder = cabinetRect
      ? Math.max(0, cabinetRect.bottom - stageRect.bottom)
      : 0;

    return cabinetRemainder
      + getPixelProperty(cabinet, "margin-bottom")
      + getPixelProperty(body, "padding-bottom");
  }

  function refresh() {
    const isCompact = compactLayout?.matches === true;
    if (isCompact) {
      frame.style.removeProperty("width");
      frame.style.removeProperty("height");
      shell.style.width = `${Math.min(DEFAULT_NATURAL_WIDTH, stage.clientWidth)}px`;
    } else {
      shell.style.removeProperty("width");
    }

    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width <= 0) return null;

    const naturalWidth = shell.offsetWidth || DEFAULT_NATURAL_WIDTH;
    const naturalHeight = shell.offsetHeight;
    if (naturalHeight <= 0) return null;

    const visualViewport = viewport.visualViewport;
    const viewportHeight = visualViewport?.height || viewport.innerHeight || naturalHeight;
    const viewportTop = visualViewport?.offsetTop || 0;
    const viewportAvailableHeight = Math.max(
      1,
      viewportHeight
        - Math.max(0, stageRect.top - viewportTop)
        - getBottomClearance(stageRect)
        - getReservedHeight()
    );
    const availableHeight = stageRect.height > 0
      ? Math.min(viewportAvailableHeight, stageRect.height)
      : viewportAvailableHeight;
    const isCoarse = coarsePointer?.matches === true;
    const scale = getResponsiveShellScale({
      availableWidth: stage.clientWidth || stageRect.width,
      availableHeight,
      shellWidth: naturalWidth,
      shellHeight: naturalHeight,
      maxScale: isCoarse ? TOUCH_MAX_SCALE : DESKTOP_MAX_SCALE
    });

    shell.style.setProperty("--game-shell-scale", String(scale));
    frame.style.width = `${naturalWidth * scale}px`;
    frame.style.height = `${naturalHeight * scale}px`;
    return scale;
  }

  function scheduleRefresh() {
    if (scheduledFrame !== null) return;
    scheduledFrame = viewport.requestAnimationFrame(() => {
      scheduledFrame = null;
      refresh();
    });
  }

  viewport.addEventListener("resize", scheduleRefresh);
  viewport.visualViewport?.addEventListener("resize", scheduleRefresh);
  viewport.visualViewport?.addEventListener("scroll", scheduleRefresh);
  coarsePointer?.addEventListener?.("change", scheduleRefresh);
  compactLayout?.addEventListener?.("change", scheduleRefresh);

  return {
    refresh,
    scheduleRefresh,
    destroy() {
      if (scheduledFrame !== null) viewport.cancelAnimationFrame(scheduledFrame);
      viewport.removeEventListener("resize", scheduleRefresh);
      viewport.visualViewport?.removeEventListener("resize", scheduleRefresh);
      viewport.visualViewport?.removeEventListener("scroll", scheduleRefresh);
      coarsePointer?.removeEventListener?.("change", scheduleRefresh);
      compactLayout?.removeEventListener?.("change", scheduleRefresh);
    }
  };
}
