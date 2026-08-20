import { GAMEPLAY_ACTION_IDS } from "../config.js";
import { getGameInputAction } from "./game-input.js";
import { getSculptAction, getVersusEventLabel, getVersusResultLabel } from "./game-screen-model.js";
import { createResponsiveShell } from "./responsive-shell.js";

const SCULPT_CURSOR_COLORS = Object.freeze({
  CARVE: "#d98b43",
  FILL: "#6fb879",
  NONE: "#f1f5e6"
});

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

export function createGameScreen({ sendCommand }) {
  const fieldCanvas = document.querySelector("#field");
  const nextCanvas = document.querySelector("#next");
  const focusCanvas = document.querySelector("#focus");
  const field = fieldCanvas.getContext("2d");
  const next = nextCanvas.getContext("2d");
  const focus = focusCanvas.getContext("2d");
  const gameStage = document.querySelector("#game-stage");
  const gameShellFrame = document.querySelector("#game-shell-frame");
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
  const pauseGameButton = document.querySelector("#pause-game");
  const headerScore = document.querySelector(".header-score");
  const modeName = document.querySelector("#mode-name");
  const gameScreen = document.querySelector("#game-screen");
  const gameOverEyebrow = document.querySelector("#game-over-eyebrow");
  const gameOverTitle = document.querySelector("#game-over-title");
  const finalScorePanel = document.querySelector("#final-score-panel");
  const versusResultDetail = document.querySelector("#versus-result-detail");
  const pauseEyebrow = document.querySelector("#pause-eyebrow");
  const pauseTitle = document.querySelector("#pause-title");
  const resumeGameButton = document.querySelector("#resume-game");
  const restartGameButton = document.querySelector("#restart-game");
  const gameOverBackButton = document.querySelector("#game-over-back");
  const versusPanel = document.querySelector("#versus-panel");
  const opponentCanvas = document.querySelector("#opponent-field");
  const opponent = opponentCanvas.getContext("2d");
  const peerState = document.querySelector("#peer-state");
  const versusFeed = document.querySelector("#versus-feed");
  const focusConnector = document.querySelector("#focus-connector");
  const focusConnectorPath = document.querySelector("#focus-connector-path");
  const responsiveShell = createResponsiveShell({
    stage: gameStage,
    frame: gameShellFrame,
    shell: gameShell
  });

  let lastView = null;
  let focusLayout = null;
  let focusCursor = null;
  let focusCursorPieceId = null;
  let lastMeta = null;
  let gameContext = Object.freeze({ kind: "singleplayer", localPlayerId: null });
  let versusMessages = [];

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

  function renderOpponent(view) {
    if (!view) return;
    const board = view.board;
    const width = 100;
    const height = Math.round((width / board.width) * board.height);
    if (opponentCanvas.width !== width) opponentCanvas.width = width;
    if (opponentCanvas.height !== height) opponentCanvas.height = height;
    const cellSize = width / board.width;
    clearCanvas(opponentCanvas, opponent);
    drawGrid(opponent, board.width, board.height, cellSize);

    for (let y = 0; y < board.height; y += 1) {
      for (let x = 0; x < board.width; x += 1) {
        const style = board.cells[y * board.width + x];
        if (style) drawCell(opponent, x * cellSize, y * cellSize, cellSize, style);
      }
    }
    for (const piece of view.activePieces) {
      for (const cell of piece.cells) {
        const x = piece.x + cell.x;
        const y = piece.y + cell.y;
        if (y < 0 || y >= board.height) continue;
        drawCell(opponent, x * cellSize, y * cellSize, cellSize, piece.style, false, piece.pendingLock);
      }
    }
  }

  function renderConnectionState(meta) {
    if (gameContext.kind !== "multiplayer") return;
    const state = String(meta?.connectionStats?.transportState || "open");
    if (state.includes("failed")) peerState.textContent = "FAILED";
    else if (state.includes("disconnected") || state.includes("closed")) peerState.textContent = "LOST";
    else if (state.includes("open") || state.includes("connected")) peerState.textContent = "OPEN";
    else peerState.textContent = state.replace(/^connection-|^channel-/, "").toUpperCase().slice(0, 12);
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

  function renderHud(view, meta = null) {
    const wasGameOverHidden = gameOver.hidden;
    const isVersus = gameContext.kind === "multiplayer";
    const isGameOver = isVersus ? meta?.matchStatus === "finished" : view.status === "gameover";
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
    if (isVersus) {
      gameOverTitle.textContent = getVersusResultLabel(meta?.matchResult, gameContext.localPlayerId);
      versusResultDetail.textContent = "LAN VS // MATCH COMPLETE";
    }
    if (isGameOver && wasGameOverHidden) {
      requestAnimationFrame(() => {
        if (!gameOver.hidden) playAgainButton.focus();
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

  function render(view, meta = null) {
    lastView = view;
    lastMeta = meta;
    configureFieldCanvas(view.board);
    responsiveShell.refresh();
    renderField(view);
    renderNext(view);
    renderFocus(view);
    renderHud(view, meta);
    if (gameContext.kind === "multiplayer") {
      renderOpponent(meta?.opponentViews?.[0]?.view);
      renderConnectionState(meta);
    }
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

  function performAction(action) {
    switch (action) {
      case GAMEPLAY_ACTION_IDS.focusPrevious: sendCommand({ type: "FOCUS_PREVIOUS" }); break;
      case GAMEPLAY_ACTION_IDS.focusNext: sendCommand({ type: "FOCUS_NEXT" }); break;
      case GAMEPLAY_ACTION_IDS.cursorUp: moveFocusCursor(0, -1); break;
      case GAMEPLAY_ACTION_IDS.cursorLeft: moveFocusCursor(-1, 0); break;
      case GAMEPLAY_ACTION_IDS.cursorDown: moveFocusCursor(0, 1); break;
      case GAMEPLAY_ACTION_IDS.cursorRight: moveFocusCursor(1, 0); break;
      case GAMEPLAY_ACTION_IDS.sculpt: sculptAtCursor(); break;
      case GAMEPLAY_ACTION_IDS.hardDrop: sendCommand({ type: "HARD_DROP_FOCUSED" }); break;
      default: return false;
    }
    return true;
  }

  function handleKey(event, bindings) {
    const action = getGameInputAction(event.code, bindings);
    if (!action || !performAction(action)) return false;
    event.preventDefault();
    return true;
  }

  function setGameMode(mode, { kind = "singleplayer", localPlayerId = null } = {}) {
    modeName.textContent = mode.name.toUpperCase();
    gameContext = Object.freeze({ kind, localPlayerId });
    const isVersus = kind === "multiplayer";
    gameScreen.dataset.gameKind = kind;
    gameShell.dataset.versus = isVersus ? "true" : "false";
    headerScore.hidden = isVersus;
    versusPanel.hidden = !isVersus;
    gameOverEyebrow.textContent = isVersus ? "MATCH COMPLETE" : "RUN COMPLETE";
    gameOverTitle.textContent = isVersus ? "MATCH OVER" : "GAME OVER";
    finalScorePanel.hidden = isVersus;
    versusResultDetail.hidden = !isVersus;
    pauseGameButton.textContent = isVersus ? "MENU" : "PAUSE";
    pauseEyebrow.textContent = isVersus ? "MATCH CONTINUES" : "GAME SUSPENDED";
    pauseTitle.textContent = isVersus ? "MATCH MENU" : "PAUSED";
    restartGameButton.hidden = isVersus;
    resumeGameButton.querySelector("span").textContent = isVersus ? "Return to Match" : "Resume";
    playAgainButton.querySelector("span").textContent = isVersus ? "LAN Lobby" : "Play Again";
    gameOverBackButton.querySelector("span").textContent = isVersus ? "LAN" : "Back";
    peerState.textContent = isVersus ? "OPEN" : "OFFLINE";
    versusMessages = [];
    versusFeed.replaceChildren();
    focusCursor = null;
    focusCursorPieceId = null;
    lastView = null;
    lastMeta = null;
    responsiveShell.scheduleRefresh();
  }

  function handleMatchEvents(events) {
    if (gameContext.kind !== "multiplayer") return;
    const labels = events
      .map((event) => getVersusEventLabel(event, gameContext.localPlayerId))
      .filter(Boolean);
    if (labels.length === 0) return;
    versusMessages = [...versusMessages, ...labels].slice(-3);
    versusFeed.replaceChildren(...versusMessages.map((label) => {
      const item = document.createElement("span");
      item.textContent = label;
      return item;
    }));
  }

  return {
    getContext: () => gameContext,
    getStatus: () => gameContext.kind === "multiplayer" && lastMeta?.matchStatus === "finished"
      ? "gameover"
      : lastView?.status || null,
    handleMatchEvents,
    handleKey,
    performAction,
    refreshLayout: responsiveShell.scheduleRefresh,
    render,
    setGameMode
  };
}
