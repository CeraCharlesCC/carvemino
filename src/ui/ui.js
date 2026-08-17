import { ACHIEVEMENTS } from "../app/profile.js";
import { getTemplateCellValue, getTemplateCells } from "../domain/rules.js";

const PALETTE = [
  "#000000",
  "#6b9e8f",
  "#b5a66a",
  "#8a7b96",
  "#7a9a6d",
  "#a6645c",
  "#6882a3",
  "#b0864e",
  "#5a5d55"
];

const KEYBINDING_ACTIONS = Object.freeze([
  ["focusPrevious", "Focus previous"],
  ["focusNext", "Focus next"],
  ["cursorUp", "Cursor up"],
  ["cursorLeft", "Cursor left"],
  ["cursorDown", "Cursor down"],
  ["cursorRight", "Cursor right"],
  ["carve", "Carve"],
  ["fill", "Fill"],
  ["hardDrop", "Hard drop"],
  ["restart", "Restart"]
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

function createArcadeAudio() {
  let context = null;

  function getContext() {
    if (context) return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    return context;
  }

  function tone(frequency, duration = 0.04, volume = 0.025, delay = 0) {
    const audio = getContext();
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  return {
    select() {
      tone(520, 0.025, 0.018);
    },
    confirm() {
      tone(330, 0.04, 0.025);
      tone(660, 0.055, 0.022, 0.045);
    },
    back() {
      tone(440, 0.035, 0.018);
      tone(260, 0.045, 0.018, 0.035);
    }
  };
}

function clearCanvas(canvas, context) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#080a07";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCell(context, x, y, size, value, focused = false) {
  const inset = 1.5;
  context.fillStyle = PALETTE[value] || "#c8ccbe";
  context.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  context.strokeStyle = focused ? "#9aa592" : "#0a0b0866";
  context.lineWidth = focused ? 2 : 1;
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

function emptyProfile() {
  return {
    highScores: { classic: 0, carver: 0 },
    achievements: {},
    settings: { theme: "default", keybindings: {} }
  };
}

export function createUi({
  sendCommand,
  restart,
  startMode,
  quitGame,
  pauseGame,
  resumeGame,
  changeKeybinding,
  resetKeybindings
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
  const restartHint = document.querySelector("#restart-hint");
  const modeName = document.querySelector("#mode-name");
  const highScore = document.querySelector("#high-score");
  const keybindingList = document.querySelector("#keybinding-list");
  const achievementList = document.querySelector("#achievement-list");
  const achievementSummary = document.querySelector("#achievement-summary");
  const pauseOverlay = document.querySelector("#pause-overlay");
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
  const audio = createArcadeAudio();

  let rules = null;
  let profile = emptyProfile();
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
    if (button) requestAnimationFrame(() => button.focus());
  }

  function showScreen(screenName) {
    if (!screens.has(screenName)) return;
    if (currentScreen === "menu" && screenName !== "menu") stopAttractLoop();
    currentScreen = screenName;
    for (const [name, screen] of screens) screen.hidden = name !== screenName;
    if (screenName === "options") renderKeybindings();
    if (screenName === "menu") startAttractLoop();
    if (screenName !== "game") focusFirstMenuButton(screenName);
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
    const visibleTop = board.hiddenHeight;
    clearCanvas(fieldCanvas, field);
    drawGrid(field, board.width, board.visibleHeight, cellSize);

    for (let y = visibleTop; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const value = board.cells[y * board.width + x];
        if (value === 0) continue;
        drawCell(field, x * cellSize, (y - visibleTop) * cellSize, cellSize, value);
      }
    }

    for (const piece of view.activePieces) {
      const isFocused = view.focusedPiece && piece.id === view.focusedPiece.id;
      for (const cell of piece.cells) {
        const x = piece.x + cell.x;
        const y = piece.y + cell.y - visibleTop;
        if (y < 0 || y >= board.visibleHeight) continue;
        drawCell(field, x * cellSize, y * cellSize, cellSize, piece.cellValue, isFocused);
      }
    }

    if (view.incomingGarbage.length > 0) {
      const rows = view.incomingGarbage.reduce((sum, packet) => sum + packet.rows, 0);
      const warningRows = Math.min(rows, board.visibleHeight);
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
    if (!view.next || !rules) return;
    const cells = getTemplateCells(rules, view.next.templateId, view.next.rotation ?? 0);
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
    const value = getTemplateCellValue(rules, view.next.templateId);
    for (const cell of cells) {
      drawCell(next, originX + cell.x * cellSize, originY + cell.y * cellSize, cellSize, value);
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

    const editable = view.editableFillCells;
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
      drawCell(focus, px, py, cellSize, piece.cellValue, true);
    }

    if (focusCursor) {
      const px = originX + (focusCursor.x - minX) * cellSize;
      const py = originY + (focusCursor.y - minY) * cellSize;
      focus.save();
      focus.strokeStyle = "#9aa592";
      focus.lineWidth = 3;
      focus.strokeRect(px + 2.5, py + 2.5, cellSize - 5, cellSize - 5);
      focus.restore();
    }
  }

  function renderFocusConnector(view) {
    const piece = view.focusedPiece;
    const visibleCells = piece?.cells.filter((cell) => {
      const y = piece.y + cell.y - view.board.hiddenHeight;
      return y >= 0 && y < view.board.visibleHeight;
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
    const cellHeight = fieldCanvas.clientHeight / view.board.visibleHeight;
    const centerX = visibleCells.reduce(
      (sum, cell) => sum + piece.x + cell.x + 0.5,
      0
    ) / visibleCells.length;
    const centerY = visibleCells.reduce(
      (sum, cell) => sum + piece.y + cell.y - view.board.hiddenHeight + 0.5,
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
    score.textContent = String(view.score).padStart(7, "0");
    level.textContent = String(view.level);
    lines.textContent = String(view.totalLines);
    scrap.textContent = String(view.scrap).padStart(2, "0");
    fillCost.textContent = `${rules.sculpting.fillCost} scrap`;
    if (view.focusedPiece) {
      cut.textContent = `${view.focusedPiece.carveLimit - view.focusedPiece.carved} / ${view.focusedPiece.carveLimit}`;
    } else {
      cut.textContent = "-";
    }

    if (view.next) {
      const boardCellPx = fieldCanvas.clientWidth / view.board.width;
      const cursorCenter = (view.next.x + 0.5) * boardCellPx;
      const labelHalfWidth = 37;
      const labelCenter = Math.max(
        labelHalfWidth,
        Math.min(fieldCanvas.clientWidth - labelHalfWidth, cursorCenter)
      );
      cursor.style.left = `${cursorCenter}px`;
      cursor.style.setProperty("--cursor-label-shift", `${labelCenter - cursorCenter}px`);
    }
    gameOver.hidden = view.status !== "gameover";
  }

  function render(view) {
    if (!rules) return;
    lastView = view;
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

  function sculptAtCursor(type) {
    if (!lastView || !lastView.focusedPiece || !focusCursor) return;
    const piece = lastView.focusedPiece;
    const cells = type === "CARVE" ? piece.cells : lastView.editableFillCells;
    if (!cells.some((cell) => cell.x === focusCursor.x && cell.y === focusCursor.y)) return;
    sendCommand({ type, pieceId: piece.id, x: focusCursor.x, y: focusCursor.y });
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
    const classicValue = profile.highScores.classic || 0;
    const carverValue = profile.highScores.carver || 0;
    const classicScore = String(classicValue).padStart(7, "0");
    const carverScore = String(carverValue).padStart(7, "0");
    const ranking = [
      ["CLASSIC", classicValue],
      ["CARVER", carverValue]
    ].sort((left, right) => right[1] - left[1]);
    const bestScore = String(ranking[0][1]).padStart(7, "0");
    document.querySelector("#classic-high-score").textContent = classicScore;
    document.querySelector("#carver-high-score").textContent = carverScore;
    document.querySelector("#records-classic-score").textContent = classicScore;
    document.querySelector("#records-carver-score").textContent = carverScore;
    document.querySelector("#attract-high-score").textContent = bestScore;
    ranking.forEach(([mode, value], index) => {
      document.querySelector(`#attract-rank-${index + 1}-mode`).textContent = mode;
      document.querySelector(`#attract-rank-${index + 1}-score`).textContent = String(value).padStart(7, "0");
    });
    if (rules) highScore.textContent = String(profile.highScores[rules.modeId] || 0).padStart(7, "0");
  }

  function renderControlKeys() {
    const bindings = profile.settings.keybindings;
    focusPrevKey.textContent = keyLabel(bindings.focusPrevious);
    focusNextKey.textContent = keyLabel(bindings.focusNext);
    restartHint.textContent = `Press ${keyLabel(bindings.restart)} to restart`;
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
        audio.confirm();
        pendingBinding = action;
        renderKeybindings();
      });
      row.append(name, button);
      return row;
    }));
  }

  function setProfile(nextProfile) {
    profile = nextProfile || emptyProfile();
    document.documentElement.dataset.theme = profile.settings.theme || "default";
    renderProfileNumbers();
    renderAchievements();
    renderControlKeys();
    if (currentScreen === "options") renderKeybindings();
  }

  function setGameMode(nextRules) {
    rules = nextRules;
    modeName.textContent = rules.name.toUpperCase();
    fillCost.textContent = `${rules.sculpting.fillCost} scrap`;
    fieldCanvas.width = 320;
    fieldCanvas.height = Math.round((fieldCanvas.width / rules.board.width) * rules.board.visibleHeight);
    gameShell.style.setProperty("--field-height", `${fieldCanvas.height}px`);
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
      requestAnimationFrame(() => document.querySelector("#resume-game").focus());
    } else {
      resumeGame();
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
      audio.confirm();
      setPaused(true);
      event.preventDefault();
      return true;
    }
    const bindings = profile.settings.keybindings;
    const action = KEYBINDING_ACTIONS.find(([actionId]) => bindings[actionId] === event.code)?.[0];
    if (!action && event.code === "Enter") {
      sculptAtCursor("CARVE");
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
      case "carve": sculptAtCursor("CARVE"); break;
      case "fill": sculptAtCursor("FILL"); break;
      case "hardDrop": sendCommand({ type: "HARD_DROP_FOCUSED" }); break;
      case "restart": restart(); break;
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
    if (event.target instanceof HTMLSelectElement) return false;
    const movingPrevious = MENU_PREVIOUS_KEYS.has(event.code);
    if (!movingPrevious && !MENU_NEXT_KEYS.has(event.code)) return false;
    const buttons = getMenuButtons(container);
    if (buttons.length === 0) return false;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) index = 0;
    index = (index + (movingPrevious ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
    audio.select();
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

    if (currentScreen === "game") {
      if (gamePaused) {
        if (event.code === "Escape") {
          audio.back();
          setPaused(false);
          event.preventDefault();
        } else {
          handleMenuNavigation(event, pauseOverlay);
        }
        return;
      }
      handleGameKey(event);
      return;
    }

    if (currentScreen === "menu" && (event.code === "Enter" || event.code === "Space")) {
      const buttons = getMenuButtons(screens.get("menu"));
      const activeButton = buttons.includes(document.activeElement) ? document.activeElement : pressStart;
      activeButton.click();
      event.preventDefault();
      return;
    }

    if ((currentScreen === "menu" || currentScreen === "singleplayer") && event.code === "KeyR") {
      secondaryReturnScreen = currentScreen;
      audio.confirm();
      showScreen("records");
      event.preventDefault();
      return;
    }

    if ((currentScreen === "menu" || currentScreen === "singleplayer") && event.code === "KeyO") {
      secondaryReturnScreen = currentScreen;
      audio.confirm();
      showScreen("options");
      event.preventDefault();
      return;
    }

    if (handleMenuNavigation(event)) return;
    if (event.code === "Escape" && currentScreen !== "menu") {
      audio.back();
      if (currentScreen === "records" || currentScreen === "options") showScreen(secondaryReturnScreen);
      else showScreen("menu");
      event.preventDefault();
    }
  });

  for (const button of document.querySelectorAll("[data-nav]")) {
    button.addEventListener("click", () => {
      audio.confirm();
      navigateTo(button.dataset.nav);
    });
  }
  for (const button of document.querySelectorAll("[data-back]")) {
    button.addEventListener("click", () => {
      audio.back();
      showScreen(secondaryReturnScreen);
    });
  }
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => {
      audio.confirm();
      clearPause();
      startMode(button.dataset.mode);
      showScreen("game");
    });
  }

  document.querySelector("#pause-game").addEventListener("click", () => {
    audio.confirm();
    setPaused(true);
  });
  document.querySelector("#resume-game").addEventListener("click", () => {
    audio.back();
    setPaused(false);
  });
  document.querySelector("#restart-game").addEventListener("click", () => {
    audio.confirm();
    clearPause();
    restart();
  });
  document.querySelector("#quit-game").addEventListener("click", () => {
    audio.back();
    quitToSingleplayer();
  });
  document.querySelector("#reset-keybindings").addEventListener("click", () => {
    audio.confirm();
    pendingBinding = null;
    const nextProfile = resetKeybindings();
    if (nextProfile) setProfile(nextProfile);
  });
  showScreen("menu");

  return {
    render,
    setProfile,
    setGameMode,
    showScreen
  };
}
