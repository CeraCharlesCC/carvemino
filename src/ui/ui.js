import { ACHIEVEMENTS, DEFAULT_AUDIO_SETTINGS } from "../app/profile.js";

const SCULPT_CURSOR_COLORS = Object.freeze({
  CARVE: "#d98b43",
  FILL: "#6fb879",
  NONE: "#f1f5e6"
});

const KEYBINDING_ACTIONS = Object.freeze([
  ["focusPrevious", "Focus previous"],
  ["focusNext", "Focus next"],
  ["cursorUp", "Cursor up"],
  ["cursorLeft", "Cursor left"],
  ["cursorDown", "Cursor down"],
  ["cursorRight", "Cursor right"],
  ["sculpt", "Sculpt"],
  ["hardDrop", "Hard drop"]
]);

const ATTRACT_PANELS = Object.freeze([
  ["title", 5200],
  ["demo", 6000],
  ["records", 4200]
]);

const ATTRACT_DEMO_STEPS = Object.freeze([
  {
    action: "CUT",
    caption: "REMOVE ONE CELL",
    piece: [[3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [5, 2], [3, 3], [4, 3]],
    actionCells: [[5, 2]],
    ghost: []
  },
  {
    action: "FILL",
    caption: "PATCH AN OPEN EDGE",
    piece: [[3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [3, 3], [4, 3]],
    actionCells: [[2, 3]],
    ghost: []
  },
  {
    action: "DROP",
    caption: "LOCK THE NEW SHAPE",
    piece: [[3, 3], [4, 3], [2, 4], [3, 4], [4, 4], [2, 5], [3, 5], [4, 5]],
    actionCells: [],
    ghost: [[3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]]
  }
]);

const MENU_PREVIOUS_KEYS = new Set(["ArrowUp", "ArrowLeft", "KeyW", "KeyA"]);
const MENU_NEXT_KEYS = new Set(["ArrowDown", "ArrowRight", "KeyS", "KeyD"]);
const NON_REPEATING_UI_KEYS = new Set(["Enter", "Space", "Escape", "KeyR", "KeyO"]);

export function getTitleScreenAction(code) {
  if (code === "Enter") return "start";
  if (code === "KeyR") return "records";
  if (code === "KeyO") return "options";
  return null;
}

export function getSculptAction(view, cursor) {
  const piece = view?.focusedPiece;
  if (!piece || !cursor || !view.sculpt) return null;
  if (view.sculpt.carve.targets.some((cell) => cell.x === cursor.x && cell.y === cursor.y)) {
    return "CARVE";
  }
  if (view.sculpt.fill.targets.some((cell) => cell.x === cursor.x && cell.y === cursor.y)) {
    return "FILL";
  }
  return null;
}

function clearCanvas(canvas, context) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#080a07";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCell(context, x, y, size, style, focused = false, pendingLock = false) {
  if (!style || typeof style.fill !== "string") {
    throw new Error("projected cell style with a fill color is required");
  }
  const inset = 1.5;
  context.fillStyle = style.fill;
  context.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  context.strokeStyle = pendingLock ? "#f0b35d" : focused ? "#9aa592" : "#0a0b0866";
  context.lineWidth = pendingLock || focused ? 2 : 1;
  context.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
}

function drawGrid(context, width, height, cellSize) {
  context.save();
  context.strokeStyle = "#9aa59212";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= width; x += 1) {
    const px = x * cellSize + 0.5;
    context.moveTo(px, 0);
    context.lineTo(px, height * cellSize);
  }
  for (let y = 0; y <= height; y += 1) {
    const py = y * cellSize + 0.5;
    context.moveTo(0, py);
    context.lineTo(width * cellSize, py);
  }
  context.stroke();
  context.restore();
}

function keyLabel(code) {
  if (!code) return "-";
  if (code === "Space") return "SPACE";
  if (code === "ShiftLeft") return "L SHIFT";
  if (code === "ShiftRight") return "R SHIFT";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase();
  return code.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}

function emptyProfile(modes) {
  return {
    highScores: Object.fromEntries(modes.map((mode) => [mode.id, 0])),
    achievements: {},
    settings: {
      theme: "default",
      keybindings: {},
      audio: { ...DEFAULT_AUDIO_SETTINGS }
    }
  };
}

export function createUi({
  modes,
  sendCommand,
  restart,
  startMode,
  quitGame,
  pauseGame,
  resumeGame,
  onAudioEvent = () => {},
  onScreenChange = () => {},
  changeKeybinding,
  resetKeybindings,
  changeAudioSetting
}) {
  const screens = new Map(
    [...document.querySelectorAll("[data-screen]")].map((screen) => [screen.dataset.screen, screen])
  );
  const fieldCanvas = document.querySelector("#field");
  const nextCanvas = document.querySelector("#next");
  const focusCanvas = document.querySelector("#focus");
  const field = fieldCanvas.getContext("2d");
  const next = nextCanvas.getContext("2d");
  const focus = focusCanvas.getContext("2d");
  const gameShell = document.querySelector("#game-shell");
  const score = document.querySelector("#score");
  const level = document.querySelector("#level");
  const lines = document.querySelector("#lines");
  const cut = document.querySelector("#cut");
  const scrap = document.querySelector("#scrap");
  const fillCost = document.querySelector("#fill-cost");
  const cursor = document.querySelector("#drop-cursor");
  const gameOver = document.querySelector("#game-over");
  const finalScore = document.querySelector("#final-score");
  const playAgainButton = document.querySelector("#play-again");
  const gameOverBackButton = document.querySelector("#game-over-back");
  const pauseGameButton = document.querySelector("#pause-game");
  const modeName = document.querySelector("#mode-name");
  const highScore = document.querySelector("#high-score");
  const keybindingList = document.querySelector("#keybinding-list");
  const masterVolume = document.querySelector("#audio-master-volume");
  const musicVolume = document.querySelector("#audio-music-volume");
  const sfxVolume = document.querySelector("#audio-sfx-volume");
  const musicEnabled = document.querySelector("#audio-music-enabled");
  const sfxEnabled = document.querySelector("#audio-sfx-enabled");
  const achievementList = document.querySelector("#achievement-list");
  const achievementSummary = document.querySelector("#achievement-summary");
  const modeMenu = document.querySelector("#mode-menu");
  const recordScoreList = document.querySelector("#record-score-list");
  const attractRanking = document.querySelector("#attract-ranking");
  const pauseOverlay = document.querySelector("#pause-overlay");
  const resumeGameButton = document.querySelector("#resume-game");
  const focusPrevKey = document.querySelector("#focus-prev-key");
  const focusNextKey = document.querySelector("#focus-next-key");
  const focusConnector = document.querySelector("#focus-connector");
  const focusConnectorPath = document.querySelector("#focus-connector-path");
  const pressStart = document.querySelector("#press-start");
  const attractPanels = [...document.querySelectorAll("[data-attract-panel]")];
  const attractDemoGrid = document.querySelector("#sculpt-demo-grid");
  const attractDemoNumber = document.querySelector("#sculpt-demo-number");
  const attractDemoAction = document.querySelector("#sculpt-demo-action");
  const attractDemoCaption = document.querySelector("#sculpt-demo-caption");

  const modeScoreOutputs = new Map();
  const recordScoreOutputs = new Map();
  let activeMode = null;
  let profile = emptyProfile(modes);
  let currentScreen = "menu";
  let lastView = null;
  let focusLayout = null;
  let focusCursor = null;
  let focusCursorPieceId = null;
  let pendingBinding = null;
  let gamePaused = false;
  let secondaryReturnScreen = "menu";
  let attractPanelIndex = 0;
  let attractPanelTimer = null;
  let attractDemoTimer = null;
  let attractDemoStep = 0;

  modeMenu.replaceChildren(...modes.map((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button mode-button";
    button.dataset.mode = mode.id;

    const name = document.createElement("span");
    name.textContent = mode.name;
    const scoreLabel = document.createElement("b");
    scoreLabel.append("HI ");
    const output = document.createElement("output");
    output.textContent = "0000000";
    scoreLabel.append(output);
    modeScoreOutputs.set(mode.id, output);
    button.append(name, scoreLabel);
    button.addEventListener("click", () => {
      onAudioEvent("confirm");
      clearPause();
      startMode(mode.id);
      showScreen("game");
    });
    return button;
  }));

  recordScoreList.replaceChildren(...modes.map((mode) => {
    const row = document.createElement("div");
    row.className = "record-score";
    const name = document.createElement("span");
    name.textContent = mode.name.toUpperCase();
    const output = document.createElement("output");
    output.textContent = "0000000";
    recordScoreOutputs.set(mode.id, output);
    row.append(name, output);
    return row;
  }));

  const attractDemoCells = Array.from({ length: 56 }, () => {
    const cell = document.createElement("span");
    cell.className = "sculpt-demo-cell";
    cell.setAttribute("aria-hidden", "true");
    return cell;
  });
  attractDemoGrid?.replaceChildren(...attractDemoCells);

  function cellKey(x, y) {
    return `${x},${y}`;
  }

  function renderAttractDemoStep(index) {
    const step = ATTRACT_DEMO_STEPS[index % ATTRACT_DEMO_STEPS.length];
    const piece = new Set(step.piece.map(([x, y]) => cellKey(x, y)));
    const action = new Set(step.actionCells.map(([x, y]) => cellKey(x, y)));
    const ghost = new Set(step.ghost.map(([x, y]) => cellKey(x, y)));

    attractDemoCells.forEach((cell, cellIndex) => {
      const x = cellIndex % 8;
      const y = Math.floor(cellIndex / 8);
      const key = cellKey(x, y);
      cell.className = "sculpt-demo-cell";
      if (y === 6) cell.classList.add("is-floor");
      if (ghost.has(key)) cell.classList.add("is-ghost");
      if (piece.has(key)) cell.classList.add("is-piece");
      if (action.has(key)) cell.classList.add("is-action");
    });
    attractDemoNumber.textContent = String(index + 1).padStart(2, "0");
    attractDemoAction.textContent = step.action;
    attractDemoCaption.textContent = step.caption;
  }

  function stopAttractDemo() {
    if (attractDemoTimer) window.clearInterval(attractDemoTimer);
    attractDemoTimer = null;
  }

  function startAttractDemo() {
    stopAttractDemo();
    attractDemoStep = 0;
    renderAttractDemoStep(attractDemoStep);
    attractDemoTimer = window.setInterval(() => {
      attractDemoStep = (attractDemoStep + 1) % ATTRACT_DEMO_STEPS.length;
      renderAttractDemoStep(attractDemoStep);
    }, 1250);
  }

  function setAttractPanel(panelName) {
    for (const panel of attractPanels) panel.hidden = panel.dataset.attractPanel !== panelName;
    if (panelName === "demo") startAttractDemo();
    else stopAttractDemo();
  }

  function stopAttractLoop() {
    if (attractPanelTimer) window.clearTimeout(attractPanelTimer);
    attractPanelTimer = null;
    stopAttractDemo();
  }

  function scheduleAttractPanel() {
    const [, duration] = ATTRACT_PANELS[attractPanelIndex];
    attractPanelTimer = window.setTimeout(() => {
      attractPanelIndex = (attractPanelIndex + 1) % ATTRACT_PANELS.length;
      setAttractPanel(ATTRACT_PANELS[attractPanelIndex][0]);
      scheduleAttractPanel();
    }, duration);
  }

  function startAttractLoop() {
    stopAttractLoop();
    attractPanelIndex = 0;
    setAttractPanel(ATTRACT_PANELS[0][0]);
    scheduleAttractPanel();
  }

  function focusFirstMenuButton(screenName) {
    const screen = screens.get(screenName);
    const button = screenName === "menu"
      ? pressStart
      : screen?.querySelector(".menu-button:not([disabled])");
    if (button) requestAnimationFrame(() => {
      if (currentScreen === screenName) button.focus();
    });
  }

  function showScreen(screenName) {
    if (!screens.has(screenName)) return;
    if (currentScreen === "menu" && screenName !== "menu") stopAttractLoop();
    currentScreen = screenName;
    for (const [name, screen] of screens) screen.hidden = name !== screenName;
    if (screenName === "options") renderOptions();
    if (screenName === "menu") startAttractLoop();
    if (screenName !== "game") focusFirstMenuButton(screenName);
    onScreenChange(screenName);
  }

  function navigateTo(screenName) {
    if ((screenName === "records" || screenName === "options") && currentScreen !== screenName) {
      secondaryReturnScreen = currentScreen === "records" || currentScreen === "options"
        ? "menu"
        : currentScreen;
    }
    showScreen(screenName);
  }

  function resetFocusCursor(piece) {
    focusCursorPieceId = piece ? piece.id : null;
    focusCursor = piece && piece.cells.length > 0 ? { ...piece.cells[0] } : null;
  }

  function renderField(view) {
    const board = view.board;
    const cellSize = fieldCanvas.width / board.width;
    clearCanvas(fieldCanvas, field);
    drawGrid(field, board.width, board.height, cellSize);

    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const style = board.cells[y * board.width + x];
        if (!style) continue;
        drawCell(field, x * cellSize, y * cellSize, cellSize, style);
      }
    }

    for (const piece of view.activePieces) {
      const isFocused = view.focusedPiece && piece.id === view.focusedPiece.id;
      for (const cell of piece.cells) {
        const x = piece.x + cell.x;
        const y = piece.y + cell.y;
        if (y < 0 || y >= board.height) continue;
        drawCell(
          field,
          x * cellSize,
          y * cellSize,
          cellSize,
          piece.style,
          isFocused,
          piece.pendingLock
        );
      }
    }

    if (view.incomingGarbageRows > 0) {
      const warningRows = Math.min(view.incomingGarbageRows, board.height);
      field.fillStyle = "#ffb4a233";
      field.fillRect(
        0,
        fieldCanvas.height - warningRows * cellSize,
        fieldCanvas.width,
        warningRows * cellSize
      );
    }
  }

  function renderNext(view) {
    clearCanvas(nextCanvas, next);
    if (!view.nextPiece) return;
    const cells = view.nextPiece.cells;
    let maxX = 0;
    let maxY = 0;
    for (const cell of cells) {
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    const cellSize = Math.min(24, Math.floor(150 / (maxX + 1)), Math.floor(88 / (maxY + 1)));
    const width = (maxX + 1) * cellSize;
    const height = (maxY + 1) * cellSize;
    const originX = (nextCanvas.width - width) / 2;
    const originY = (nextCanvas.height - height) / 2;
    for (const cell of cells) {
      drawCell(
        next,
        originX + cell.x * cellSize,
        originY + cell.y * cellSize,
        cellSize,
        view.nextPiece.style
      );
    }
  }

  function renderFocus(view) {
    clearCanvas(focusCanvas, focus);
    const piece = view.focusedPiece;
    focusLayout = null;
    if (!piece) {
      resetFocusCursor(null);
      return;
    }

    const editable = view.sculpt.fill.targets;
    const all = [...piece.cells, ...editable];
    let minX = Math.min(...all.map((cell) => cell.x));
    let maxX = Math.max(...all.map((cell) => cell.x));
    let minY = Math.min(...all.map((cell) => cell.y));
    let maxY = Math.max(...all.map((cell) => cell.y));
    minX -= 1;
    maxX += 1;
    minY -= 1;
    maxY += 1;

    const columns = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const cellSize = Math.floor(Math.min(32, 190 / columns, 190 / rows));
    const gridWidth = columns * cellSize;
    const gridHeight = rows * cellSize;
    const originX = Math.floor((focusCanvas.width - gridWidth) / 2);
    const originY = Math.floor((focusCanvas.height - gridHeight) / 2);

    focusLayout = { minX, minY, maxX, maxY, cellSize, originX, originY };
    if (focusCursorPieceId !== piece.id) resetFocusCursor(piece);
    if (!focusCursor
        || focusCursor.x < minX || focusCursor.x > maxX
        || focusCursor.y < minY || focusCursor.y > maxY) {
      resetFocusCursor(piece);
    }

    focus.strokeStyle = "#9aa59216";
    focus.lineWidth = 1;
    for (let x = 0; x <= columns; x += 1) {
      const px = originX + x * cellSize + 0.5;
      focus.beginPath();
      focus.moveTo(px, originY);
      focus.lineTo(px, originY + gridHeight);
      focus.stroke();
    }
    for (let y = 0; y <= rows; y += 1) {
      const py = originY + y * cellSize + 0.5;
      focus.beginPath();
      focus.moveTo(originX, py);
      focus.lineTo(originX + gridWidth, py);
      focus.stroke();
    }

    focus.save();
    focus.setLineDash([3, 4]);
    focus.strokeStyle = "#9aa59266";
    focus.lineWidth = 1.5;
    for (const cell of editable) {
      const px = originX + (cell.x - minX) * cellSize;
      const py = originY + (cell.y - minY) * cellSize;
      focus.strokeRect(px + 4, py + 4, cellSize - 8, cellSize - 8);
    }
    focus.restore();

    for (const cell of piece.cells) {
      const px = originX + (cell.x - minX) * cellSize;
      const py = originY + (cell.y - minY) * cellSize;
      drawCell(focus, px, py, cellSize, piece.style, true);
    }

    if (focusCursor) {
      const px = originX + (focusCursor.x - minX) * cellSize;
      const py = originY + (focusCursor.y - minY) * cellSize;
      const sculptAction = getSculptAction(view, focusCursor);
      const cursorColor = SCULPT_CURSOR_COLORS[sculptAction || "NONE"];
      focus.save();
      focus.fillStyle = "#f1f5e624";
      focus.fillRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
      focus.strokeStyle = "#080a07";
      focus.lineWidth = 7;
      focus.strokeRect(px + 2.5, py + 2.5, cellSize - 5, cellSize - 5);
      focus.strokeStyle = cursorColor;
      focus.lineWidth = 3;
      focus.strokeRect(px + 2.5, py + 2.5, cellSize - 5, cellSize - 5);

      const bracket = Math.max(5, Math.floor(cellSize * 0.24));
      const left = px + 0.5;
      const top = py + 0.5;
      const right = px + cellSize - 0.5;
      const bottom = py + cellSize - 0.5;
      focus.beginPath();
      focus.moveTo(left, top + bracket); focus.lineTo(left, top); focus.lineTo(left + bracket, top);
      focus.moveTo(right - bracket, top); focus.lineTo(right, top); focus.lineTo(right, top + bracket);
      focus.moveTo(right, bottom - bracket); focus.lineTo(right, bottom); focus.lineTo(right - bracket, bottom);
      focus.moveTo(left + bracket, bottom); focus.lineTo(left, bottom); focus.lineTo(left, bottom - bracket);
      focus.stroke();
      focus.restore();
    }
  }

  function renderFocusConnector(view) {
    const piece = view.focusedPiece;
    const visibleCells = piece?.cells.filter((cell) => {
      const y = piece.y + cell.y;
      return y >= 0 && y < view.board.height;
    }) || [];

    if (view.status === "gameover" || visibleCells.length === 0) {
      focusConnectorPath.setAttribute("d", "");
      return;
    }

    const shellRect = gameShell.getBoundingClientRect();
    const fieldRect = fieldCanvas.getBoundingClientRect();
    const focusRect = focusCanvas.getBoundingClientRect();
    if (shellRect.width === 0 || shellRect.height === 0 || focusRect.width === 0) {
      focusConnectorPath.setAttribute("d", "");
      return;
    }

    const scaleX = shellRect.width / gameShell.clientWidth;
    const scaleY = shellRect.height / gameShell.clientHeight;
    const fieldLeft = (fieldRect.left - shellRect.left) / scaleX;
    const fieldTop = (fieldRect.top - shellRect.top) / scaleY;
    const cellWidth = fieldCanvas.clientWidth / view.board.width;
    const cellHeight = fieldCanvas.clientHeight / view.board.height;
    const centerX = visibleCells.reduce(
      (sum, cell) => sum + piece.x + cell.x + 0.5,
      0
    ) / visibleCells.length;
    const centerY = visibleCells.reduce(
      (sum, cell) => sum + piece.y + cell.y + 0.5,
      0
    ) / visibleCells.length;
    const startX = fieldLeft + centerX * cellWidth;
    const startY = fieldTop + centerY * cellHeight;
    const endX = (focusRect.left - shellRect.left) / scaleX + 0.5;
    const endY = (focusRect.top - shellRect.top + focusRect.height / 2) / scaleY;

    focusConnector.setAttribute(
      "viewBox",
      `0 0 ${gameShell.clientWidth} ${gameShell.clientHeight}`
    );
    focusConnectorPath.setAttribute(
      "d",
      `M ${startX} ${startY} L ${endX} ${endY}`
    );
  }

  function renderHud(view) {
    const wasGameOverHidden = gameOver.hidden;
    const isGameOver = view.status === "gameover";
    score.textContent = String(view.score).padStart(7, "0");
    finalScore.textContent = String(view.score).padStart(7, "0");
    level.textContent = String(view.level);
    lines.textContent = String(view.totalLines);
    scrap.textContent = String(view.scrap).padStart(2, "0");
    fillCost.textContent = `${view.sculpt.fill.cost} scrap`;
    if (view.focusedPiece) {
      cut.textContent = `${view.sculpt.carve.remaining} / ${view.sculpt.carve.limit}`;
    } else {
      cut.textContent = "-";
    }

    if (view.nextPiece) {
      const boardCellPx = fieldCanvas.clientWidth / view.board.width;
      const cursorCenter = (view.nextPiece.x + 0.5) * boardCellPx;
      const labelHalfWidth = 37;
      const labelCenter = Math.max(
        labelHalfWidth,
        Math.min(fieldCanvas.clientWidth - labelHalfWidth, cursorCenter)
      );
      cursor.style.left = `${cursorCenter}px`;
      cursor.style.setProperty("--cursor-label-shift", `${labelCenter - cursorCenter}px`);
    }
    gameOver.hidden = !isGameOver;
    pauseGameButton.disabled = isGameOver;
    if (isGameOver && wasGameOverHidden) {
      requestAnimationFrame(() => {
        if (lastView?.status === "gameover") playAgainButton.focus();
      });
    }
  }

  function configureFieldCanvas(board) {
    const width = 320;
    const height = Math.round((width / board.width) * board.height);
    if (fieldCanvas.width !== width) fieldCanvas.width = width;
    if (fieldCanvas.height !== height) fieldCanvas.height = height;
    gameShell.style.setProperty("--field-height", `${height}px`);
  }

  function render(view) {
    lastView = view;
    configureFieldCanvas(view.board);
    renderField(view);
    renderNext(view);
    renderFocus(view);
    renderHud(view);
    renderFocusConnector(view);
  }

  function moveFocusCursor(dx, dy) {
    if (!lastView || !lastView.focusedPiece || !focusLayout) return;
    if (focusCursorPieceId !== lastView.focusedPiece.id || !focusCursor) {
      resetFocusCursor(lastView.focusedPiece);
    }

    focusCursor.x = Math.max(focusLayout.minX, Math.min(focusLayout.maxX, focusCursor.x + dx));
    focusCursor.y = Math.max(focusLayout.minY, Math.min(focusLayout.maxY, focusCursor.y + dy));
    renderFocus(lastView);
  }

  function sculptAtCursor() {
    if (!lastView || !lastView.focusedPiece || !focusCursor) return;
    const piece = lastView.focusedPiece;
    if (!getSculptAction(lastView, focusCursor)) return;
    sendCommand({ type: "SCULPT", pieceId: piece.id, x: focusCursor.x, y: focusCursor.y });
  }

  function renderAchievements() {
    const definitions = Object.values(ACHIEVEMENTS);
    const unlockedCount = definitions.filter((item) => profile.achievements[item.id]?.unlocked).length;
    achievementSummary.textContent = `${unlockedCount} / ${definitions.length}`;
    achievementList.replaceChildren(...definitions.map((item) => {
      const unlocked = Boolean(profile.achievements[item.id]?.unlocked);
      const element = document.createElement("div");
      element.className = `achievement-item${unlocked ? " unlocked" : ""}`;
      const name = document.createElement("b");
      name.textContent = unlocked ? item.name : "?????";
      const description = document.createElement("span");
      description.textContent = unlocked ? item.description : "Locked";
      element.append(name, description);
      return element;
    }));
  }

  function renderProfileNumbers() {
    const ranking = modes
      .map((mode) => [mode, profile.highScores[mode.id] || 0])
      .sort((left, right) => right[1] - left[1]);
    const bestScore = String(ranking[0]?.[1] || 0).padStart(7, "0");
    for (const [mode, value] of ranking) {
      const formatted = String(value).padStart(7, "0");
      modeScoreOutputs.get(mode.id).textContent = formatted;
      recordScoreOutputs.get(mode.id).textContent = formatted;
    }
    document.querySelector("#attract-high-score").textContent = bestScore;
    attractRanking.replaceChildren(...ranking.map(([mode, value], index) => {
      const row = document.createElement("div");
      const rank = document.createElement("b");
      const position = index + 1;
      const lastTwo = position % 100;
      const suffix = lastTwo >= 11 && lastTwo <= 13
        ? "TH"
        : ({ 1: "ST", 2: "ND", 3: "RD" }[position % 10] || "TH");
      rank.textContent = `${position}${suffix}`;
      const name = document.createElement("span");
      name.textContent = mode.name.toUpperCase();
      const output = document.createElement("output");
      output.textContent = String(value).padStart(7, "0");
      row.append(rank, name, output);
      return row;
    }));
    if (activeMode) highScore.textContent = String(profile.highScores[activeMode.id] || 0).padStart(7, "0");
  }

  function renderControlKeys() {
    const bindings = profile.settings.keybindings;
    focusPrevKey.textContent = keyLabel(bindings.focusPrevious);
    focusNextKey.textContent = keyLabel(bindings.focusNext);
  }

  function renderKeybindings() {
    keybindingList.replaceChildren(...KEYBINDING_ACTIONS.map(([action, label]) => {
      const row = document.createElement("div");
      row.className = "keybinding-row";
      const name = document.createElement("span");
      name.textContent = label;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `utility-button${pendingBinding === action ? " binding-capture" : ""}`;
      button.dataset.bindAction = action;
      button.textContent = pendingBinding === action
        ? "PRESS KEY"
        : keyLabel(profile.settings.keybindings[action]);
      button.addEventListener("click", () => {
        onAudioEvent("confirm");
        pendingBinding = action;
        renderKeybindings();
      });
      row.append(name, button);
      return row;
    }));
  }

  function renderAudioSettings() {
    const settings = profile.settings.audio || DEFAULT_AUDIO_SETTINGS;
    masterVolume.value = String(settings.masterVolume);
    musicVolume.value = String(settings.musicVolume);
    sfxVolume.value = String(settings.sfxVolume);
    musicEnabled.checked = settings.musicEnabled;
    sfxEnabled.checked = settings.sfxEnabled;
  }

  function renderOptions() {
    renderAudioSettings();
    renderKeybindings();
  }

  function setProfile(nextProfile) {
    profile = nextProfile || emptyProfile(modes);
    document.documentElement.dataset.theme = profile.settings.theme || "default";
    renderProfileNumbers();
    renderAchievements();
    renderControlKeys();
    if (currentScreen === "options") renderOptions();
  }

  function setGameMode(modeId) {
    const nextMode = modes.find((mode) => mode.id === modeId);
    if (!nextMode) throw new Error(`Unknown UI game mode: ${modeId}`);
    activeMode = nextMode;
    modeName.textContent = nextMode.name.toUpperCase();
    focusCursor = null;
    focusCursorPieceId = null;
    lastView = null;
    renderProfileNumbers();
  }

  function setPaused(paused) {
    if (gamePaused === paused) return;
    gamePaused = paused;
    pauseOverlay.hidden = !paused;
    if (paused) {
      pauseGame();
      requestAnimationFrame(() => {
        if (gamePaused) resumeGameButton.focus();
      });
    } else {
      resumeGame();
      requestAnimationFrame(() => document.querySelector("#pause-game").focus());
    }
  }

  function clearPause() {
    gamePaused = false;
    pauseOverlay.hidden = true;
  }

  function quitToSingleplayer() {
    clearPause();
    quitGame();
    showScreen("singleplayer");
  }

  function handleGameKey(event) {
    if (event.code === "Escape") {
      onAudioEvent("confirm");
      setPaused(true);
      event.preventDefault();
      return true;
    }
    const bindings = profile.settings.keybindings;
    const action = KEYBINDING_ACTIONS.find(([actionId]) => bindings[actionId] === event.code)?.[0];
    if (!action && event.code === "Enter") {
      sculptAtCursor();
      event.preventDefault();
      return true;
    }
    if (!action) return false;

    switch (action) {
      case "focusPrevious": sendCommand({ type: "FOCUS_PREVIOUS" }); break;
      case "focusNext": sendCommand({ type: "FOCUS_NEXT" }); break;
      case "cursorUp": moveFocusCursor(0, -1); break;
      case "cursorLeft": moveFocusCursor(-1, 0); break;
      case "cursorDown": moveFocusCursor(0, 1); break;
      case "cursorRight": moveFocusCursor(1, 0); break;
      case "sculpt": sculptAtCursor(); break;
      case "hardDrop": sendCommand({ type: "HARD_DROP_FOCUSED" }); break;
      default: return false;
    }
    event.preventDefault();
    return true;
  }

  function getMenuButtons(container) {
    return [...container.querySelectorAll([
      ".menu-button:not([disabled])",
      ".start-button:not([disabled])",
      ".attract-secondary button:not([disabled])"
    ].join(", "))];
  }

  function handleMenuNavigation(event, container = screens.get(currentScreen)) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return false;
    const movingPrevious = MENU_PREVIOUS_KEYS.has(event.code);
    if (!movingPrevious && !MENU_NEXT_KEYS.has(event.code)) return false;
    const buttons = getMenuButtons(container);
    if (buttons.length === 0) return false;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) index = 0;
    index = (index + (movingPrevious ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
    onAudioEvent("select");
    event.preventDefault();
    return true;
  }

  function trapMenuFocus(event, container) {
    if (event.code !== "Tab") return false;
    const buttons = getMenuButtons(container);
    if (buttons.length === 0) return false;
    const currentIndex = buttons.indexOf(document.activeElement);
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = currentIndex < 0
      ? (event.shiftKey ? buttons.length - 1 : 0)
      : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    event.preventDefault();
    return true;
  }

  window.addEventListener("keydown", (event) => {
    if (pendingBinding) {
      event.preventDefault();
      if (event.code === "Escape") {
        pendingBinding = null;
        renderKeybindings();
        return;
      }
      const action = pendingBinding;
      pendingBinding = null;
      const nextProfile = changeKeybinding(action, event.code);
      if (nextProfile) setProfile(nextProfile);
      else renderKeybindings();
      return;
    }

    if (event.repeat && NON_REPEATING_UI_KEYS.has(event.code)) {
      event.preventDefault();
      return;
    }

    if (currentScreen === "game") {
      if (lastView?.status === "gameover") {
        if (event.code === "Escape") {
          onAudioEvent("back");
          quitToSingleplayer();
          event.preventDefault();
        } else if (event.code === "Enter" || event.code === "Space") {
          const buttons = getMenuButtons(gameOver);
          const activeButton = buttons.includes(document.activeElement)
            ? document.activeElement
            : playAgainButton;
          activeButton.click();
          event.preventDefault();
        } else if (trapMenuFocus(event, gameOver)) {
          return;
        } else {
          handleMenuNavigation(event, gameOver);
        }
        return;
      }
      if (gamePaused) {
        if (event.code === "Escape") {
          onAudioEvent("back");
          setPaused(false);
          event.preventDefault();
        } else if (trapMenuFocus(event, pauseOverlay)) {
          return;
        } else {
          handleMenuNavigation(event, pauseOverlay);
        }
        return;
      }
      handleGameKey(event);
      return;
    }

    if (currentScreen === "menu") {
      const action = getTitleScreenAction(event.code);
      if (action === "start") {
        pressStart.click();
      } else if (action === "records" || action === "options") {
        secondaryReturnScreen = "menu";
        onAudioEvent("confirm");
        showScreen(action);
      }
      if (action || event.code === "Space" || MENU_PREVIOUS_KEYS.has(event.code)
          || MENU_NEXT_KEYS.has(event.code)) {
        event.preventDefault();
      }
      return;
    }

    if (handleMenuNavigation(event)) return;
    if (event.code === "Escape" && currentScreen !== "menu") {
      onAudioEvent("back");
      if (currentScreen === "records" || currentScreen === "options") showScreen(secondaryReturnScreen);
      else showScreen("menu");
      event.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentScreen === "game"
        && !gamePaused && lastView?.status === "playing") {
      setPaused(true);
    }
  });

  for (const button of document.querySelectorAll("[data-nav]")) {
    button.addEventListener("click", () => {
      onAudioEvent("confirm");
      navigateTo(button.dataset.nav);
    });
  }
  for (const button of document.querySelectorAll("[data-back]")) {
    button.addEventListener("click", () => {
      onAudioEvent("back");
      showScreen(secondaryReturnScreen);
    });
  }
  pauseGameButton.addEventListener("click", () => {
    if (lastView?.status === "gameover") return;
    onAudioEvent("confirm");
    setPaused(true);
  });
  document.querySelector("#resume-game").addEventListener("click", () => {
    onAudioEvent("back");
    setPaused(false);
  });
  document.querySelector("#restart-game").addEventListener("click", () => {
    onAudioEvent("confirm");
    clearPause();
    restart();
    requestAnimationFrame(() => pauseGameButton.focus());
  });
  document.querySelector("#quit-game").addEventListener("click", () => {
    onAudioEvent("back");
    quitToSingleplayer();
  });
  playAgainButton.addEventListener("click", () => {
    onAudioEvent("confirm");
    clearPause();
    restart();
    requestAnimationFrame(() => pauseGameButton.focus());
  });
  gameOverBackButton.addEventListener("click", () => {
    onAudioEvent("back");
    quitToSingleplayer();
  });
  document.querySelector("#reset-keybindings").addEventListener("click", () => {
    onAudioEvent("confirm");
    pendingBinding = null;
    const nextProfile = resetKeybindings();
    if (nextProfile) setProfile(nextProfile);
  });

  for (const input of [masterVolume, musicVolume, sfxVolume]) {
    input.addEventListener("input", () => {
      const nextProfile = changeAudioSetting?.(input.dataset.audioSetting, Number(input.value));
      if (nextProfile) profile = nextProfile;
    });
  }
  for (const input of [musicEnabled, sfxEnabled]) {
    input.addEventListener("change", () => {
      const nextProfile = changeAudioSetting?.(input.dataset.audioSetting, input.checked);
      if (nextProfile) profile = nextProfile;
      onAudioEvent("confirm");
    });
  }
  showScreen("menu");

  return {
    render,
    setProfile,
    setGameMode,
    showScreen
  };
}
