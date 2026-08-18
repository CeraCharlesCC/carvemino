const SCULPT_CURSOR_COLORS = Object.freeze({
  CARVE: "#d98b43",
  FILL: "#6fb879",
  NONE: "#f1f5e6"
});

export const KEYBINDING_ACTIONS = Object.freeze([
  ["focusPrevious", "Focus previous"],
  ["focusNext", "Focus next"],
  ["cursorUp", "Cursor up"],
  ["cursorLeft", "Cursor left"],
  ["cursorDown", "Cursor down"],
  ["cursorRight", "Cursor right"],
  ["sculpt", "Sculpt"],
  ["hardDrop", "Hard drop"]
]);

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

export function getGameInputAction(code, bindings = {}) {
  const action = KEYBINDING_ACTIONS.find(([actionId]) => bindings[actionId] === code)?.[0];
  if (action) return action;
  return code === "Enter" ? "sculpt" : null;
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

export function createGameScreen({ sendCommand }) {
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
  const pauseGameButton = document.querySelector("#pause-game");
  const modeName = document.querySelector("#mode-name");
  const focusConnector = document.querySelector("#focus-connector");
  const focusConnectorPath = document.querySelector("#focus-connector-path");

  let lastView = null;
  let focusLayout = null;
  let focusCursor = null;
  let focusCursorPieceId = null;

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

  function handleKey(event, bindings) {
    const action = getGameInputAction(event.code, bindings);
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

  function setGameMode(mode) {
    modeName.textContent = mode.name.toUpperCase();
    focusCursor = null;
    focusCursorPieceId = null;
    lastView = null;
  }

  return {
    getStatus: () => lastView?.status || null,
    handleKey,
    render,
    setGameMode
  };
}
