import { getTemplateCells } from "../domain/rules.js";

const PALETTE = [
  "#000000",
  "#7bdff2",
  "#f6f7c4",
  "#cdb4db",
  "#b9fbc0",
  "#ffadad",
  "#a0c4ff",
  "#ffd6a5",
  "#747b84"
];

function clearCanvas(canvas, context) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0d0f12";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCell(context, x, y, size, value, focused = false) {
  const inset = 1.5;
  context.fillStyle = PALETTE[value] || "#eef1f3";
  context.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  context.strokeStyle = focused ? "#ffffff" : "#00000055";
  context.lineWidth = focused ? 2 : 1;
  context.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
}

function drawGrid(context, width, height, cellSize) {
  context.save();
  context.strokeStyle = "#ffffff0d";
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

export function createUi({ rules, sendCommand, restart }) {
  const fieldCanvas = document.querySelector("#field");
  const nextCanvas = document.querySelector("#next");
  const focusCanvas = document.querySelector("#focus");
  const field = fieldCanvas.getContext("2d");
  const next = nextCanvas.getContext("2d");
  const focus = focusCanvas.getContext("2d");
  const score = document.querySelector("#score");
  const level = document.querySelector("#level");
  const lines = document.querySelector("#lines");
  const cut = document.querySelector("#cut");
  const scrap = document.querySelector("#scrap");
  const fillCost = document.querySelector("#fill-cost");
  const cursor = document.querySelector("#drop-cursor");
  const gameOver = document.querySelector("#game-over");

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
      field.fillStyle = "#ffb4a233";
      field.fillRect(0, fieldCanvas.height - Math.min(rows, board.visibleHeight) * cellSize,
        fieldCanvas.width, Math.min(rows, board.visibleHeight) * cellSize);
    }
  }

  function renderNext(view) {
    clearCanvas(nextCanvas, next);
    if (!view.next) return;
    const cells = getTemplateCells(view.next.templateId, view.next.rotation ?? 0);
    let maxX = 0;
    let maxY = 0;
    for (const cell of cells) {
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    const cellSize = 24;
    const width = (maxX + 1) * cellSize;
    const height = (maxY + 1) * cellSize;
    const originX = (nextCanvas.width - width) / 2;
    const originY = (nextCanvas.height - height) / 2;
    const value = view.next.templateId === "I" ? 1
      : view.next.templateId === "O" ? 2
        : view.next.templateId === "T" ? 3
          : view.next.templateId === "S" ? 4
            : view.next.templateId === "Z" ? 5
              : view.next.templateId === "J" ? 6 : 7;
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
    focus.strokeStyle = "#ffffff10";
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
    focus.strokeStyle = "#aeb6be88";
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
      focus.strokeStyle = "#ffffff";
      focus.lineWidth = 3;
      focus.strokeRect(px + 2.5, py + 2.5, cellSize - 5, cellSize - 5);
      focus.restore();
    }
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
      cursor.style.left = `${(view.next.x + 0.5) * boardCellPx}px`;
    }
    gameOver.hidden = view.status !== "gameover";
  }

  function render(view) {
    lastView = view;
    renderField(view);
    renderNext(view);
    renderFocus(view);
    renderHud(view);
  }

  function moveFocusCursor(dx, dy) {
    if (!lastView || !lastView.focusedPiece || !focusLayout) return;
    if (focusCursorPieceId !== lastView.focusedPiece.id || !focusCursor) {
      resetFocusCursor(lastView.focusedPiece);
    }

    focusCursor.x = Math.max(
      focusLayout.minX,
      Math.min(focusLayout.maxX, focusCursor.x + dx)
    );
    focusCursor.y = Math.max(
      focusLayout.minY,
      Math.min(focusLayout.maxY, focusCursor.y + dy)
    );
    renderFocus(lastView);
  }

  function sculptAtCursor(type) {
    if (!lastView || !lastView.focusedPiece || !focusCursor) return;
    const piece = lastView.focusedPiece;
    const cells = type === "CARVE" ? piece.cells : lastView.editableFillCells;
    if (!cells.some((cell) => cell.x === focusCursor.x && cell.y === focusCursor.y)) return;
    sendCommand({ type, pieceId: piece.id, x: focusCursor.x, y: focusCursor.y });
  }

  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyQ") {
      sendCommand({ type: "FOCUS_PREVIOUS" });
    } else if (event.code === "KeyE") {
      sendCommand({ type: "FOCUS_NEXT" });
    } else if (event.code === "KeyW") {
      moveFocusCursor(0, -1);
    } else if (event.code === "KeyA") {
      moveFocusCursor(-1, 0);
    } else if (event.code === "KeyS") {
      moveFocusCursor(0, 1);
    } else if (event.code === "KeyD") {
      moveFocusCursor(1, 0);
    } else if (event.code === "KeyZ" || event.code === "Enter") {
      sculptAtCursor("CARVE");
    } else if (event.code === "KeyF" || event.code === "KeyX" || event.code === "ShiftRight") {
      sculptAtCursor("FILL");
    } else if (event.code === "Space") {
      sendCommand({ type: "HARD_DROP_FOCUSED" });
    } else if (event.code === "KeyR") {
      restart();
    } else {
      return;
    }
    event.preventDefault();
  });

  return { render };
}
