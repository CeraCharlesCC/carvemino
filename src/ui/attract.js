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

function cellKey(x, y) {
  return `${x},${y}`;
}

export function createAttract() {
  const panels = [...document.querySelectorAll("[data-attract-panel]")];
  const demoGrid = document.querySelector("#sculpt-demo-grid");
  const demoNumber = document.querySelector("#sculpt-demo-number");
  const demoAction = document.querySelector("#sculpt-demo-action");
  const demoCaption = document.querySelector("#sculpt-demo-caption");

  let panelIndex = 0;
  let panelTimer = null;
  let demoTimer = null;
  let demoStep = 0;

  const demoCells = Array.from({ length: 56 }, () => {
    const cell = document.createElement("span");
    cell.className = "sculpt-demo-cell";
    cell.setAttribute("aria-hidden", "true");
    return cell;
  });
  demoGrid?.replaceChildren(...demoCells);

  function renderDemoStep(index) {
    const step = ATTRACT_DEMO_STEPS[index % ATTRACT_DEMO_STEPS.length];
    const piece = new Set(step.piece.map(([x, y]) => cellKey(x, y)));
    const action = new Set(step.actionCells.map(([x, y]) => cellKey(x, y)));
    const ghost = new Set(step.ghost.map(([x, y]) => cellKey(x, y)));

    demoCells.forEach((cell, cellIndex) => {
      const x = cellIndex % 8;
      const y = Math.floor(cellIndex / 8);
      const key = cellKey(x, y);
      cell.className = "sculpt-demo-cell";
      if (y === 6) cell.classList.add("is-floor");
      if (ghost.has(key)) cell.classList.add("is-ghost");
      if (piece.has(key)) cell.classList.add("is-piece");
      if (action.has(key)) cell.classList.add("is-action");
    });
    demoNumber.textContent = String(index + 1).padStart(2, "0");
    demoAction.textContent = step.action;
    demoCaption.textContent = step.caption;
  }

  function stopDemo() {
    if (demoTimer) window.clearInterval(demoTimer);
    demoTimer = null;
  }

  function startDemo() {
    stopDemo();
    demoStep = 0;
    renderDemoStep(demoStep);
    demoTimer = window.setInterval(() => {
      demoStep = (demoStep + 1) % ATTRACT_DEMO_STEPS.length;
      renderDemoStep(demoStep);
    }, 1250);
  }

  function setPanel(panelName) {
    for (const panel of panels) panel.hidden = panel.dataset.attractPanel !== panelName;
    if (panelName === "demo") startDemo();
    else stopDemo();
  }

  function stop() {
    if (panelTimer) window.clearTimeout(panelTimer);
    panelTimer = null;
    stopDemo();
  }

  function schedulePanel() {
    const [, duration] = ATTRACT_PANELS[panelIndex];
    panelTimer = window.setTimeout(() => {
      panelIndex = (panelIndex + 1) % ATTRACT_PANELS.length;
      setPanel(ATTRACT_PANELS[panelIndex][0]);
      schedulePanel();
    }, duration);
  }

  function start() {
    stop();
    panelIndex = 0;
    setPanel(ATTRACT_PANELS[0][0]);
    schedulePanel();
  }

  return { start, stop };
}
