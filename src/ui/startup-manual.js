import { DEFAULT_KEYBINDINGS, GAMEPLAY_ACTIONS } from "../config.js";
import { formatKeyLabel, getGameInputAction } from "./game-input.js";
import { mapPhysicalFaceActionForMenu } from "./gamepad-input.js";

const FIELD_WIDTH = 8;
const FIELD_HEIGHT = 7;
const FOCUS_SIZE = 4;
const FILL_COST = 2;
const MINIMUM_CELLS = 2;

const MANUAL_GAME_ACTIONS = new Set(GAMEPLAY_ACTIONS.map(({ id }) => id));
const MANUAL_CONTROLLER_PREVIOUS_ACTIONS = new Set(["cursorUp", "cursorLeft", "focusPrevious"]);
const MANUAL_CONTROLLER_NEXT_ACTIONS = new Set(["cursorDown", "cursorRight", "focusNext"]);

export function getManualControllerIntent(pageIndex, actionId, { controllerType, physicalFace = false } = {}) {
  if (pageIndex === 1 && MANUAL_GAME_ACTIONS.has(actionId)) return "practice";
  if (physicalFace) actionId = mapPhysicalFaceActionForMenu(actionId, controllerType);
  if (MANUAL_CONTROLLER_PREVIOUS_ACTIONS.has(actionId)) return "previous";
  if (MANUAL_CONTROLLER_NEXT_ACTIONS.has(actionId)) return "next";
  if (actionId === "sculpt") return "activate";
  if (actionId === "hardDrop") return "back";
  return "consume";
}

function copyCell(cell) {
  return { x: cell.x, y: cell.y };
}

function copyState(state) {
  return {
    ...state,
    cursor: { ...state.cursor },
    pieces: state.pieces.map((piece) => ({
      ...piece,
      origin: { ...piece.origin },
      cells: piece.cells.map(copyCell)
    }))
  };
}

function focusedPiece(state) {
  if (state.focusedIndex < 0) return null;
  return state.pieces[state.focusedIndex] || null;
}

function hasCell(piece, x, y) {
  return piece.cells.some((cell) => cell.x === x && cell.y === y);
}

function isAdjacentToPiece(piece, x, y) {
  return piece.cells.some((cell) => Math.abs(cell.x - x) + Math.abs(cell.y - y) === 1);
}

export function getManualDemoTarget(state) {
  const piece = focusedPiece(state);
  if (!piece || piece.locked) return null;
  const { x, y } = state.cursor;
  if (hasCell(piece, x, y)) {
    return piece.cells.length > MINIMUM_CELLS && piece.carved < piece.carveLimit ? "cut" : null;
  }
  if (state.scrap >= FILL_COST && isAdjacentToPiece(piece, x, y)) return "fill";
  return null;
}

function firstCell(piece) {
  return piece?.cells[0] ? copyCell(piece.cells[0]) : { x: 0, y: 0 };
}

function nextEditableIndex(state, direction) {
  if (state.pieces.every((piece) => piece.locked)) return -1;
  const start = state.focusedIndex < 0 ? 0 : state.focusedIndex;
  for (let step = 1; step <= state.pieces.length; step += 1) {
    const index = (start + direction * step + state.pieces.length * 2) % state.pieces.length;
    if (!state.pieces[index].locked) return index;
  }
  return -1;
}

export function createManualDemoState() {
  return {
    focusedIndex: 0,
    cursor: { x: 1, y: 0 },
    scrap: 2,
    lastAction: "ready",
    pieces: [
      {
        id: "alpha",
        origin: { x: 1, y: 1 },
        cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
        carved: 0,
        carveLimit: 2,
        locked: false
      },
      {
        id: "beta",
        origin: { x: 5, y: 0 },
        cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
        carved: 0,
        carveLimit: 2,
        locked: false
      }
    ]
  };
}

export function performManualDemoAction(state, actionId, payload = {}) {
  if (actionId === "reset") {
    const reset = createManualDemoState();
    reset.lastAction = "reset";
    return reset;
  }

  const next = copyState(state);
  const piece = focusedPiece(next);

  if (actionId === "focusPrevious" || actionId === "focusNext") {
    const direction = actionId === "focusPrevious" ? -1 : 1;
    const index = nextEditableIndex(next, direction);
    if (index < 0) {
      next.focusedIndex = -1;
      next.lastAction = "allDropped";
      return next;
    }
    next.focusedIndex = index;
    next.cursor = firstCell(next.pieces[index]);
    next.lastAction = "focus";
    return next;
  }

  if (!piece || piece.locked) {
    next.lastAction = "allDropped";
    return next;
  }

  const moves = {
    cursorUp: [0, -1],
    cursorLeft: [-1, 0],
    cursorDown: [0, 1],
    cursorRight: [1, 0]
  };
  if (moves[actionId]) {
    const [dx, dy] = moves[actionId];
    next.cursor.x = Math.max(0, Math.min(FOCUS_SIZE - 1, next.cursor.x + dx));
    next.cursor.y = Math.max(0, Math.min(FOCUS_SIZE - 1, next.cursor.y + dy));
    next.lastAction = "cursor";
    return next;
  }

  if (actionId === "cursorSet") {
    next.cursor.x = Math.max(0, Math.min(FOCUS_SIZE - 1, Number(payload.x) || 0));
    next.cursor.y = Math.max(0, Math.min(FOCUS_SIZE - 1, Number(payload.y) || 0));
    next.lastAction = "cursor";
    return next;
  }

  if (actionId === "sculpt") {
    const target = getManualDemoTarget(next);
    if (target === "cut") {
      piece.cells = piece.cells.filter((cell) => cell.x !== next.cursor.x || cell.y !== next.cursor.y);
      piece.carved += 1;
      next.scrap += 1;
      next.lastAction = "cut";
    } else if (target === "fill") {
      piece.cells.push(copyCell(next.cursor));
      next.scrap -= FILL_COST;
      next.lastAction = "fill";
    } else {
      next.lastAction = "invalid";
    }
    return next;
  }

  if (actionId === "hardDrop") {
    const maxY = Math.max(...piece.cells.map((cell) => cell.y));
    piece.origin.y = FIELD_HEIGHT - 1 - maxY;
    piece.locked = true;
    const index = nextEditableIndex(next, 1);
    if (index < 0) {
      next.focusedIndex = -1;
      next.lastAction = "allDropped";
    } else {
      next.focusedIndex = index;
      next.cursor = firstCell(next.pieces[index]);
      next.lastAction = "drop";
    }
    return next;
  }

  return next;
}

function fieldCellAt(state, x, y) {
  for (let index = 0; index < state.pieces.length; index += 1) {
    const piece = state.pieces[index];
    const localX = x - piece.origin.x;
    const localY = y - piece.origin.y;
    if (hasCell(piece, localX, localY)) return { piece, index };
  }
  return null;
}

export function createStartupManual({
  i18n,
  returnFocus = null,
  screen = null,
  onAudioEvent = () => {},
  getKeybindings = () => DEFAULT_KEYBINDINGS
} = {}) {
  const dialog = document.querySelector("#startup-manual");
  if (!dialog) {
    return {
      open() {},
      close() {},
      handleGameAction() { return null; },
      handleControllerAction() { return null; },
      handleControllerStart() { return null; },
      refreshKeybindings() {}
    };
  }

  const pages = [...dialog.querySelectorAll("[data-manual-page]")];
  const paginationButtons = [...dialog.querySelectorAll("[data-manual-page-target]")];
  const previousButton = dialog.querySelector("[data-manual-previous]");
  const nextButton = dialog.querySelector("[data-manual-next]");
  const nextLabel = dialog.querySelector("[data-manual-next-label]");
  const nextIcon = dialog.querySelector("[data-manual-next-icon]");
  const nextHint = dialog.querySelector("[data-manual-next-hint]");
  const pageNumber = dialog.querySelector("#manual-page-number");
  const labStage = dialog.querySelector("#manual-lab-stage");
  const fieldGrid = dialog.querySelector("#manual-field-grid");
  const focusGrid = dialog.querySelector("#manual-focus-grid");
  const cutReadout = dialog.querySelector("#manual-lab-cut");
  const scrapReadout = dialog.querySelector("#manual-lab-scrap");
  const targetReadout = dialog.querySelector("#manual-lab-target");
  const status = dialog.querySelector("#manual-lab-status");
  let pageIndex = 0;
  let demoState = createManualDemoState();
  let activeReturnFocus = returnFocus;
  const touchInput = globalThis.matchMedia?.("(hover: none) and (pointer: coarse)");

  function usesPhysicalPad() {
    return touchInput?.matches === true;
  }

  function currentKeybindings() {
    return getKeybindings?.() || DEFAULT_KEYBINDINGS;
  }

  function refreshKeybindings() {
    const bindings = currentKeybindings();
    for (const element of dialog.querySelectorAll("[data-manual-keybinding]")) {
      const actionIds = element.dataset.manualKeybinding.split(/\s+/).filter(Boolean);
      element.textContent = actionIds
        .map((actionId) => formatKeyLabel(bindings[actionId]))
        .join(" / ");
    }
    for (const element of dialog.querySelectorAll("[data-manual-key-alias]")) {
      const code = element.dataset.manualKeyAlias;
      const actionId = element.dataset.manualKeyAliasAction;
      element.textContent = formatKeyLabel(code);
      element.hidden = bindings[actionId] === code || getGameInputAction(code, bindings) !== actionId;
    }
  }

  function positionOverScreen() {
    if (!usesPhysicalPad() || !screen) return;
    const bounds = screen.getBoundingClientRect();
    const overshoot = 8;
    dialog.style.setProperty("--manual-screen-top", `${Math.max(0, bounds.top - overshoot)}px`);
    dialog.style.setProperty("--manual-screen-left", `${Math.max(0, bounds.left - overshoot)}px`);
    dialog.style.setProperty("--manual-screen-width", `${Math.min(globalThis.innerWidth, bounds.width + overshoot * 2)}px`);
    dialog.style.setProperty("--manual-screen-height", `${Math.min(globalThis.innerHeight, bounds.height + overshoot * 2)}px`);
  }

  function renderDemo() {
    fieldGrid.replaceChildren();
    for (let y = 0; y < FIELD_HEIGHT; y += 1) {
      for (let x = 0; x < FIELD_WIDTH; x += 1) {
        const cell = document.createElement("span");
        cell.className = "manual-field-cell";
        const occupied = fieldCellAt(demoState, x, y);
        if (occupied) {
          cell.classList.add("is-piece", `is-piece-${occupied.piece.id}`);
          if (occupied.piece.locked) cell.classList.add("is-locked");
          if (occupied.index === demoState.focusedIndex) cell.classList.add("is-focused");
        }
        fieldGrid.append(cell);
      }
    }

    const piece = focusedPiece(demoState);
    const target = getManualDemoTarget(demoState);
    focusGrid.replaceChildren();
    for (let y = 0; y < FOCUS_SIZE; y += 1) {
      for (let x = 0; x < FOCUS_SIZE; x += 1) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "manual-focus-cell";
        cell.dataset.manualCell = `${x},${y}`;
        if (piece && hasCell(piece, x, y)) cell.classList.add("is-piece");
        else if (piece && !piece.locked && isAdjacentToPiece(piece, x, y)) cell.classList.add("is-fill-candidate");
        if (demoState.cursor.x === x && demoState.cursor.y === y && piece) {
          cell.classList.add("is-cursor");
          if (target === "cut") cell.classList.add("can-cut");
          if (target === "fill") cell.classList.add("can-fill");
        }
        const action = demoState.cursor.x === x && demoState.cursor.y === y
          ? (target || "none")
          : (piece && hasCell(piece, x, y) ? "cut" : "none");
        cell.setAttribute("aria-label", i18n.t("manual.lab.cell", {
          x: x + 1,
          y: y + 1,
          action: i18n.t(`manual.action.${action}`)
        }));
        focusGrid.append(cell);
      }
    }

    cutReadout.textContent = piece ? `${Math.max(0, piece.carveLimit - piece.carved)} / ${piece.carveLimit}` : "-";
    scrapReadout.textContent = String(demoState.scrap).padStart(2, "0");
    targetReadout.textContent = target ? target.toUpperCase() : "--";
    targetReadout.dataset.target = target || "none";
    status.textContent = i18n.t(`manual.lab.status.${demoState.lastAction}`);
  }

  function perform(actionId, payload) {
    demoState = performManualDemoAction(demoState, actionId, payload);
    renderDemo();
  }

  function renderPage() {
    pages.forEach((page, index) => { page.hidden = index !== pageIndex; });
    previousButton.disabled = pageIndex === 0;
    pageNumber.textContent = `${String(pageIndex + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}`;
    const isLastPage = pageIndex === pages.length - 1;
    nextButton.classList.toggle("is-final-action", isLastPage);
    nextButton.classList.remove("is-start-action");
    nextLabel.textContent = i18n.t(isLastPage ? "manual.nav.close" : "manual.nav.next");
    if (nextIcon) nextIcon.textContent = isLastPage ? "▶" : "→";
    if (nextHint) {
      nextHint.hidden = true;
    }
    paginationButtons.forEach((button) => {
      const isCurrent = Number(button.dataset.manualPageTarget) === pageIndex;
      if (isCurrent) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (pageIndex === 1) {
      renderDemo();
      requestAnimationFrame(() => labStage?.focus({ preventScroll: true }));
    }
  }

  function close() {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function open({ returnFocus: nextReturnFocus = returnFocus } = {}) {
    activeReturnFocus = nextReturnFocus;
    pageIndex = 0;
    demoState = createManualDemoState();
    refreshKeybindings();
    renderPage();
    positionOverScreen();
    if (usesPhysicalPad() && typeof dialog.show === "function") dialog.show();
    else if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    requestAnimationFrame(() => nextButton?.focus());
  }

  function handleGameAction(actionId) {
    if (!dialog.open) return null;
    if (pageIndex !== 1) return false;
    if (!MANUAL_GAME_ACTIONS.has(actionId)) return false;
    perform(actionId);
    return true;
  }

  function controllerButtons() {
    return [...dialog.querySelectorAll("button:not([disabled])")].filter((button) => (
      !button.hidden && !button.closest?.("[hidden]")
    ));
  }

  function moveControllerFocus(movingPrevious) {
    const buttons = controllerButtons();
    if (buttons.length === 0) return false;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) index = movingPrevious ? 0 : -1;
    index = (index + (movingPrevious ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
    onAudioEvent("select");
    return true;
  }

  function activateControllerFocus() {
    const buttons = controllerButtons();
    const activeButton = buttons.includes(document.activeElement) ? document.activeElement : nextButton;
    if (!activeButton || activeButton.disabled) return false;
    activeButton.click();
    return true;
  }

  function handleControllerAction(actionId, options) {
    if (!dialog.open) return null;
    const intent = getManualControllerIntent(pageIndex, actionId, options);
    if (intent === "practice") {
      perform(actionId);
      return true;
    }
    if (intent === "previous") return moveControllerFocus(true);
    if (intent === "next") return moveControllerFocus(false);
    if (intent === "activate") return activateControllerFocus();
    if (intent === "back") {
      if (pageIndex > 0) previousButton.click();
      else close();
      return true;
    }
    return false;
  }

  function handleControllerStart() {
    if (!dialog.open) return null;
    if (pageIndex === 1) {
      nextButton.click();
      return true;
    }
    return activateControllerFocus();
  }

  for (const button of dialog.querySelectorAll("[data-manual-close]")) {
    button.addEventListener("click", close);
  }
  previousButton.addEventListener("click", () => {
    if (pageIndex <= 0) return;
    pageIndex -= 1;
    renderPage();
  });
  for (const button of paginationButtons) {
    button.addEventListener("click", () => {
      const targetIndex = Number(button.dataset.manualPageTarget);
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= pages.length) return;
      pageIndex = targetIndex;
      renderPage();
    });
  }
  nextButton.addEventListener("click", () => {
    if (pageIndex >= pages.length - 1) {
      close();
      return;
    }
    pageIndex += 1;
    renderPage();
  });
  dialog.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-manual-action]");
    if (actionButton && dialog.contains(actionButton)) {
      perform(actionButton.dataset.manualAction);
      return;
    }
    const cell = event.target.closest("[data-manual-cell]");
    if (!cell || !focusGrid.contains(cell)) return;
    const [x, y] = cell.dataset.manualCell.split(",").map(Number);
    perform("cursorSet", { x, y });
    labStage?.focus();
  });
  dialog.addEventListener("keydown", (event) => {
    if (pageIndex !== 1) return;
    if ((event.code === "Enter" || event.code === "Space") && event.target.closest("button")) return;
    const action = getGameInputAction(event.code, currentKeybindings());
    if (!action) return;
    perform(action);
    event.preventDefault();
    event.stopPropagation();
  });
  dialog.addEventListener("close", () => {
    const focusTarget = activeReturnFocus;
    requestAnimationFrame(() => focusTarget?.focus());
  });
  window.addEventListener("resize", () => {
    if (dialog.open) positionOverScreen();
  });
  document.addEventListener("click", (event) => {
    if (!dialog.open || !event.target.closest?.(".physical-control-surface [data-pause-game]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  i18n.apply(dialog);
  refreshKeybindings();
  renderDemo();
  return { open, close, handleGameAction, handleControllerAction, handleControllerStart, refreshKeybindings };
}
