export const MANUAL_CONTROLLER_CURSOR_DEADZONE = 0.22;
export const MANUAL_CONTROLLER_CURSOR_SPEED = 620;

const DEFAULT_RESPONSE_CURVE = 1.4;
const DEFAULT_MAX_DELTA_MS = 50;

function finiteCoordinate(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedBounds(bounds = {}) {
  const left = finiteCoordinate(bounds.left);
  const top = finiteCoordinate(bounds.top);
  return {
    left,
    top,
    right: Math.max(left, finiteCoordinate(bounds.right, left)),
    bottom: Math.max(top, finiteCoordinate(bounds.bottom, top))
  };
}

export function applyManualCursorDeadzone(stick = {}, {
  deadzone = MANUAL_CONTROLLER_CURSOR_DEADZONE,
  responseCurve = DEFAULT_RESPONSE_CURVE
} = {}) {
  const x = clamp(finiteCoordinate(stick.x), -1, 1);
  const y = clamp(finiteCoordinate(stick.y), -1, 1);
  const magnitude = Math.min(1, Math.hypot(x, y));
  if (magnitude <= deadzone || magnitude === 0) return { x: 0, y: 0, magnitude: 0 };

  const scaledMagnitude = Math.pow((magnitude - deadzone) / (1 - deadzone), responseCurve);
  const directionScale = scaledMagnitude / Math.hypot(x, y);
  return {
    x: x * directionScale,
    y: y * directionScale,
    magnitude: scaledMagnitude
  };
}

export function moveManualCursor(position, stick, deltaMs, bounds, {
  speed = MANUAL_CONTROLLER_CURSOR_SPEED,
  deadzone = MANUAL_CONTROLLER_CURSOR_DEADZONE,
  responseCurve = DEFAULT_RESPONSE_CURVE,
  maxDeltaMs = DEFAULT_MAX_DELTA_MS
} = {}) {
  const area = normalizedBounds(bounds);
  const input = applyManualCursorDeadzone(stick, { deadzone, responseCurve });
  const elapsedSeconds = clamp(finiteCoordinate(deltaMs), 0, maxDeltaMs) / 1000;
  return {
    x: clamp(finiteCoordinate(position?.x, area.left) + input.x * speed * elapsedSeconds, area.left, area.right),
    y: clamp(finiteCoordinate(position?.y, area.top) + input.y * speed * elapsedSeconds, area.top, area.bottom)
  };
}

function centerOf(element, fallbackBounds) {
  const bounds = element?.getBoundingClientRect?.() || fallbackBounds;
  return {
    x: (finiteCoordinate(bounds?.left) + finiteCoordinate(bounds?.right)) / 2,
    y: (finiteCoordinate(bounds?.top) + finiteCoordinate(bounds?.bottom)) / 2
  };
}

export function createManualControllerCursor({
  dialog,
  boundsElement = dialog?.querySelector?.(".manual-book"),
  cursorElement = dialog?.querySelector?.(".manual-controller-cursor"),
  documentObject = globalThis.document,
  deadzone = MANUAL_CONTROLLER_CURSOR_DEADZONE,
  speed = MANUAL_CONTROLLER_CURSOR_SPEED,
  responseCurve = DEFAULT_RESPONSE_CURVE,
  maxDeltaMs = DEFAULT_MAX_DELTA_MS
} = {}) {
  let position = null;
  let lastTimestamp = null;
  let previousPressed = null;
  let target = null;

  function currentBounds() {
    return normalizedBounds(boundsElement?.getBoundingClientRect?.());
  }

  function clearTarget() {
    target?.classList?.remove?.("is-controller-cursor-target");
    target = null;
  }

  function setTarget(nextTarget) {
    if (nextTarget === target) return;
    clearTarget();
    target = nextTarget;
    target?.classList?.add?.("is-controller-cursor-target");
  }

  function findTarget() {
    const hit = documentObject?.elementFromPoint?.(position.x, position.y);
    const button = hit?.closest?.("button:not(:disabled)");
    if (!button || button.disabled || !dialog?.contains?.(button)) return null;
    return button;
  }

  function renderPosition() {
    if (!cursorElement || !position) return;
    cursorElement.style.left = `${position.x}px`;
    cursorElement.style.top = `${position.y}px`;
  }

  function show() {
    if (cursorElement) cursorElement.hidden = false;
  }

  function hide() {
    if (cursorElement) cursorElement.hidden = true;
    clearTarget();
    lastTimestamp = null;
    previousPressed = null;
  }

  function reset({ startTarget = null } = {}) {
    hide();
    const bounds = currentBounds();
    position = centerOf(startTarget, bounds);
    position = moveManualCursor(position, {}, 0, bounds);
    renderPosition();
  }

  function update(snapshot, timestamp) {
    if (!snapshot) return false;
    const bounds = currentBounds();
    if (!position) position = centerOf(null, bounds);

    const input = applyManualCursorDeadzone(snapshot.rightStick, { deadzone, responseCurve });
    const validTimestamp = Number.isFinite(timestamp) ? timestamp : null;
    const deltaMs = validTimestamp !== null && lastTimestamp !== null
      ? validTimestamp - lastTimestamp
      : 0;
    position = moveManualCursor(position, snapshot.rightStick, deltaMs, bounds, {
      deadzone,
      speed,
      responseCurve,
      maxDeltaMs
    });
    lastTimestamp = validTimestamp;
    renderPosition();

    const pressed = snapshot.rightStickPressed === true;
    const pressedEdge = snapshot.rightStickJustPressed === true || (previousPressed === false && pressed);
    previousPressed = pressed;
    if (input.magnitude > 0 || pressedEdge) show();
    if (cursorElement?.hidden !== false) return false;

    setTarget(findTarget());
    if (!pressedEdge || !target) return false;
    const clickedTarget = target;
    try {
      clickedTarget.focus?.({ preventScroll: true });
    } catch {
      clickedTarget.focus?.();
    }
    clickedTarget.click?.();
    clearTarget();
    return true;
  }

  function destroy() {
    hide();
    position = null;
  }

  return { reset, update, hide, destroy };
}
