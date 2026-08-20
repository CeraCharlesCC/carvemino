import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createI18n, resolveLocale } from "../src/i18n.js";
import {
  createOnScreenGameInput,
  formatKeyLabel,
  getGameInputAction,
  getOnScreenGameAction,
  isGameplayActionId,
  isRepeatingGameAction,
  triggerHapticFeedback
} from "../src/ui/game-input.js";
import { getSculptAction, getVersusEventLabel, getVersusResultLabel } from "../src/ui/game-screen-model.js";
import { getResponsiveShellScale } from "../src/ui/responsive-shell.js";
import { getLanStatusText } from "../src/ui/lan-lobby.js";
import { createInputMode, getInitialInputMode } from "../src/ui/input-mode.js";
import { createNavigation } from "../src/ui/navigation.js";
import {
  getBackScreen,
  getGameExitScreen,
  getMenuButtons,
  getTitleScreenAction,
  shouldPauseGameSimulation
} from "../src/ui/navigation-model.js";
import {
  claimStartupManualVisit,
  createManualDemoState,
  getManualControllerIntent,
  getManualDemoTarget,
  performManualDemoAction
} from "../src/ui/startup-manual.js";
import { replaceGlobal } from "./helpers/globals.mjs";

function createPointerControl(actionId) {
  const pressed = new Set();
  return {
    pressed,
    control: {
      disabled: false,
      dataset: { gameAction: actionId },
      classList: {
        add: (value) => pressed.add(value),
        remove: (value) => pressed.delete(value)
      },
      setPointerCapture() {}
    }
  };
}

function createPointerRoot(...controls) {
  const handlers = new Map();
  return {
    handlers,
    root: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      removeEventListener: (type) => handlers.delete(type),
      contains: (candidate) => controls.includes(candidate)
    }
  };
}

function touchPointerEvent(pointerId, control, overrides = {}) {
  return {
    isPrimary: pointerId === 1,
    pointerType: "touch",
    pointerId,
    target: { closest: () => control },
    preventDefault() {},
    ...overrides
  };
}

function createNavigationElement(dataset = {}) {
  const handlers = new Map();
  return {
    dataset: { ...dataset },
    hidden: false,
    handlers,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
    focus() {
      globalThis.document.activeElement = this;
    },
    click() {
      handlers.get("click")?.();
    },
    matches() {
      return false;
    }
  };
}

function createNavigationDom() {
  const screens = ["menu", "play", "singleplayer", "multiplayer", "lan", "game"]
    .map((screen) => createNavigationElement({ screen }));
  const screensByName = new Map(screens.map((screen) => [screen.dataset.screen, screen]));
  const elements = new Map([
    ["#game-over", createNavigationElement()],
    ["#play-again", createNavigationElement()],
    ["#game-over-back", createNavigationElement()],
    ["#pause-game", createNavigationElement()],
    [".console-layout", createNavigationElement()],
    ["#pause-overlay", createNavigationElement()],
    ["#resume-game", createNavigationElement()],
    ["#press-start", createNavigationElement()],
    ["#title-manual", createNavigationElement()],
    ["#restart-game", createNavigationElement()],
    ["#quit-game", createNavigationElement()]
  ]);
  elements.get("#pause-overlay").hidden = true;
  const documentHandlers = new Map();
  const windowHandlers = new Map();
  const document = {
    activeElement: null,
    visibilityState: "visible",
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-screen]") return screens;
      return [];
    },
    addEventListener(type, handler) {
      documentHandlers.set(type, handler);
    }
  };
  const window = {
    addEventListener(type, handler) {
      windowHandlers.set(type, handler);
    }
  };
  return { document, documentHandlers, elements, screensByName, window, windowHandlers };
}

function installNavigationGlobals(t) {
  const dom = createNavigationDom();
  replaceGlobal(t, "document", dom.document);
  replaceGlobal(t, "window", dom.window);
  replaceGlobal(t, "requestAnimationFrame", (callback) => {
    callback();
    return 1;
  });
  return dom;
}

function createTestNavigation({ gameScreen = {}, ...options } = {}) {
  return createNavigation({
    attract: { start() {}, stop() {} },
    gameScreen: {
      getContext: () => ({ kind: "singleplayer" }),
      getStatus: () => "playing",
      handleKey() {},
      performAction() { return true; },
      refreshLayout() {},
      ...gameScreen
    },
    profileUi: {
      getKeybindings: () => ({}),
      handleBindingKey: () => false,
      renderOptions() {}
    },
    restart() {},
    quitGame() {},
    pauseGame() {},
    resumeGame() {},
    onAudioEvent() {},
    onScreenChange() {},
    ...options
  });
}

test("title screen keyboard actions are explicit and do not use selection keys", () => {
  assert.equal(getTitleScreenAction("Enter"), "start");
  assert.equal(getTitleScreenAction("KeyR"), "records");
  assert.equal(getTitleScreenAction("KeyH"), "manual");
  assert.equal(getTitleScreenAction("KeyO"), "options");

  for (const code of ["Space", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"]) {
    assert.equal(getTitleScreenAction(code), null);
  }
});

test("multiplayer menu routes have explicit back destinations", () => {
  assert.equal(getBackScreen("play"), "menu");
  assert.equal(getBackScreen("singleplayer"), "play");
  assert.equal(getBackScreen("multiplayer"), "play");
  assert.equal(getBackScreen("lan"), "multiplayer");
  assert.equal(getBackScreen("lan-host"), "lan");
  assert.equal(getBackScreen("lan-join"), "lan");
  assert.equal(getBackScreen("records"), "menu");
  assert.equal(getBackScreen("options"), "menu");
  assert.equal(getBackScreen("missing"), null);
});

test("menu navigation ignores controls inside hidden LAN steps", () => {
  const visibleAction = { closest: () => null };
  const hiddenAction = { closest: () => ({ hidden: true }) };
  const backButton = { closest: () => null };
  const container = {
    querySelectorAll() {
      return [visibleAction, hiddenAction, backButton];
    }
  };

  assert.deepEqual(getMenuButtons(container), [visibleAction, backButton]);
});

test("multiplayer navigation shell exposes LAN roles while ONLINE stays disabled", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="press-start"[^>]+data-nav="play"/);
  for (const screen of ["play", "singleplayer", "multiplayer", "lan", "lan-host", "lan-join"]) {
    assert.match(html, new RegExp(`data-screen="${screen}"`), screen);
  }
  assert.match(html, /data-nav="singleplayer"/);
  assert.match(html, /data-nav="multiplayer"/);
  assert.match(html, /data-nav="lan"/);
  assert.match(html, /data-nav="lan-host"/);
  assert.match(html, /data-nav="lan-join"/);
  for (const id of [
    "lan-host-mode",
    "lan-create-invite",
    "lan-host-offer-qr",
    "lan-copy-offer",
    "lan-host-next",
    "lan-host-answer",
    "lan-scan-answer",
    "lan-accept-answer",
    "lan-start-match",
    "lan-join-offer",
    "lan-scan-offer",
    "lan-create-answer",
    "lan-join-answer-qr",
    "lan-copy-answer",
    "opponent-field",
    "peer-state",
    "versus-feed"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<button[^>]+disabled[^>]+aria-disabled="true"[^>]+tabindex="-1"[^>]*>\s*<span>Online<\/span><b>WIP<\/b>/i);
  assert.doesNotMatch(html, /<button[^>]+disabled[^>]+data-nav="lan(?:-host|-join)?"/i);
  assert.doesNotMatch(html, /id="lan-host-offer"/);
  assert.doesNotMatch(html, /id="lan-join-answer"/);
  assert.doesNotMatch(html, /<textarea[^>]+id="lan-(?:host|join)-/i);
});

test("title and manual input hints use medium-specific primary controls", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /data-input-hint="keyboard">PRESS ENTER TO START<\/span>/);
  assert.match(html, /data-input-hint="touch">PRESS START<\/span>/);
  assert.match(html, /data-input-hint="keyboard"><kbd data-manual-key-alias="Enter" data-manual-key-alias-action="sculpt"><\/kbd><kbd data-manual-keybinding="sculpt"><\/kbd>/);
  assert.match(html, /manual-lab-quick-list[^>]+data-input-hint="keyboard"[\s\S]*?<kbd data-manual-keybinding="sculpt"><\/kbd><small data-i18n="manual\.lab\.quick\.sculpt"/);
  assert.match(html, /data-manual-action="sculpt"[^>]*><kbd data-manual-keybinding="sculpt"><\/kbd>/);
  assert.match(html, /manual-controls-card[^>]+data-input-hint="keyboard"[\s\S]*?data-manual-keybinding="cursorRight"/);
  assert.match(html, /data-input-hint="controller">PRESS START<\/span>/);
  assert.match(html, /data-input-hint="controller">D-PAD \/ STICK SELECT · A \/ CROSS CONFIRM · B \/ CIRCLE BACK<\/span>/);
  assert.match(html, /data-input-hint="controller"><kbd>LB<\/kbd><kbd>RB<\/kbd>/);
  assert.match(html, /manual-lab-quick-list[^>]+data-input-hint="controller"[\s\S]*?<kbd data-controller-game-action="sculpt">RIGHT FACE<\/kbd>/);
  assert.match(html, /data-controller-game-action="hardDrop">BOTTOM FACE<\/kbd>/);
  assert.match(html, /manual-controls-card[^>]+data-input-hint="controller"[\s\S]*?manual\.controls\.controller\.title/);
});

test("input mode initializes from pointer layout and switches on meaningful input types", () => {
  assert.equal(getInitialInputMode(() => ({ matches: false })), "keyboard");
  assert.equal(getInitialInputMode(() => ({ matches: true })), "touch");

  const windowHandlers = new Map();
  const documentHandlers = new Map();
  const root = { dataset: {}, contains: (target) => target?.owner === "root" };
  const manual = { contains: (target) => target?.owner === "manual" };
  const documentObject = {
    documentElement: { dataset: {} },
    addEventListener: (type, handler) => documentHandlers.set(type, handler),
    removeEventListener: (type) => documentHandlers.delete(type)
  };
  const windowObject = {
    addEventListener: (type, handler) => windowHandlers.set(type, handler),
    removeEventListener: (type) => windowHandlers.delete(type)
  };
  const inputMode = createInputMode({
    root,
    manual,
    documentObject,
    windowObject,
    matchMedia: () => ({ matches: false })
  });

  assert.equal(inputMode.getMode(), "keyboard");
  assert.equal(root.dataset.inputMode, "keyboard");
  inputMode.setMode("controller");
  assert.equal(documentObject.documentElement.dataset.inputMode, "controller");

  const manualButton = { owner: "manual" };
  documentHandlers.get("pointerdown")({
    pointerType: "touch",
    target: { closest: () => manualButton }
  });
  assert.equal(inputMode.getMode(), "touch");

  inputMode.setMode("controller");
  documentHandlers.get("pointerdown")({
    pointerType: "mouse",
    target: { closest: () => ({ owner: "root" }) }
  });
  assert.equal(inputMode.getMode(), "controller");
  windowHandlers.get("keydown")({ code: "KeyA" });
  assert.equal(inputMode.getMode(), "keyboard");

  inputMode.destroy();
  assert.equal(windowHandlers.size, 0);
  assert.equal(documentHandlers.size, 0);
});

test("manual controller actions stay in the practice lab and become DOM navigation elsewhere", () => {
  for (const actionId of ["cursorUp", "cursorLeft", "cursorDown", "cursorRight", "focusPrevious", "focusNext", "sculpt", "hardDrop"]) {
    assert.equal(getManualControllerIntent(1, actionId), "practice", actionId);
  }
  assert.equal(getManualControllerIntent(0, "cursorLeft"), "previous");
  assert.equal(getManualControllerIntent(2, "focusNext"), "next");
  assert.equal(getManualControllerIntent(0, "sculpt"), "activate");
  assert.equal(getManualControllerIntent(2, "hardDrop"), "back");
  assert.equal(getManualControllerIntent(0, "hardDrop", {
    controllerType: "xbox",
    physicalFace: true
  }), "activate");
  assert.equal(getManualControllerIntent(0, "hardDrop", {
    controllerType: "nintendo",
    physicalFace: true
  }), "back");
});

test("runtime input-mode CSS can override coarse-pointer hint fallbacks", () => {
  const css = readFileSync(new URL("../styles/controls/touch-controls.css", import.meta.url), "utf8");
  assert.match(css, /:root\[data-input-mode="controller"\][^{]+\[data-input-hint="keyboard"\]/);
  assert.match(css, /:root\[data-input-mode="controller"\] \.focus-nav\[data-input-hint="controller"\]\s*\{\s*display:\s*flex/);
  assert.match(css, /:root\[data-input-mode="controller"\] \.startup-manual \.manual-controls-card\[data-input-hint="controller"\]\s*\{\s*display:\s*block/);
});

test("title start prompt hides non-keyboard hints before input mode initializes", () => {
  const css = readFileSync(new URL("../styles/screens/attract.css", import.meta.url), "utf8");
  assert.match(css, /\.start-button \[data-input-hint="touch"\],\s*\.start-button \[data-input-hint="controller"\]\s*\{\s*display:\s*none;/);
});

test("title start prompt blinks by default but stops when a secondary item is selected", () => {
  const css = readFileSync(new URL("../styles/screens/attract.css", import.meta.url), "utf8");
  assert.match(css, /\.start-button span\s*\{[^}]*animation:\s*start-blink 1\.05s steps\(1, end\) infinite;/s);
  assert.match(css, /#menu-screen:focus-within \.start-button:not\(:focus\) span\s*\{\s*animation:\s*none;/);
});

test("multiplayer menus never pause one peer and exit back to LAN", () => {
  assert.equal(shouldPauseGameSimulation({ kind: "singleplayer" }), true);
  assert.equal(shouldPauseGameSimulation({ kind: "multiplayer" }), false);
  assert.equal(getGameExitScreen({ kind: "singleplayer" }), "singleplayer");
  assert.equal(getGameExitScreen({ kind: "multiplayer" }), "lan");
});

test("leaving the game screen clears a multiplayer match menu before the next match", (t) => {
  const dom = installNavigationGlobals(t);
  const performedActions = [];
  const navigation = createTestNavigation({
    gameScreen: {
      getContext: () => ({ kind: "multiplayer" }),
      performAction(actionId) {
        performedActions.push(actionId);
        return true;
      }
    }
  });

  navigation.showScreen("game");
  dom.windowHandlers.get("keydown")({
    code: "Escape",
    repeat: false,
    target: { matches: () => false },
    preventDefault() {}
  });
  assert.equal(dom.elements.get("#pause-overlay").hidden, false);
  assert.equal(dom.elements.get(".console-layout").dataset.gameState, "paused");

  navigation.showScreen("lan");
  assert.equal(dom.elements.get("#pause-overlay").hidden, true);
  assert.equal(dom.elements.get(".console-layout").dataset.gameState, "playing");

  navigation.showScreen("game");
  assert.equal(navigation.performControllerAction("focusNext"), true);
  assert.equal(navigation.performControllerAction("hardDrop", {
    controllerType: "xbox",
    physicalFace: true
  }), true);
  assert.deepEqual(performedActions, ["focusNext", "hardDrop"]);
});

test("controller-family face buttons preserve familiar menu confirm/back routing", (t) => {
  const dom = installNavigationGlobals(t);
  const menuAction = createNavigationElement();
  let activations = 0;
  menuAction.click = () => { activations += 1; };
  dom.screensByName.get("lan").querySelectorAll = () => [menuAction];
  const navigation = createTestNavigation();

  navigation.showScreen("lan");
  dom.document.activeElement = menuAction;
  assert.equal(navigation.performControllerAction("hardDrop", {
    controllerType: "xbox",
    physicalFace: true
  }), true);
  assert.equal(activations, 1);

  assert.equal(navigation.performControllerAction("sculpt", {
    controllerType: "xbox",
    physicalFace: true
  }), true);
  assert.equal(dom.screensByName.get("multiplayer").hidden, false);
  assert.equal(dom.screensByName.get("lan").hidden, true);

  navigation.showScreen("lan");
  dom.document.activeElement = menuAction;
  assert.equal(navigation.performControllerAction("sculpt", {
    controllerType: "nintendo",
    physicalFace: true
  }), true);
  assert.equal(activations, 2);

  assert.equal(navigation.performControllerAction("hardDrop", {
    controllerType: "nintendo",
    physicalFace: true
  }), true);
  assert.equal(dom.screensByName.get("multiplayer").hidden, false);
  assert.equal(dom.screensByName.get("lan").hidden, true);
});

test("controller Start covers title, pause/resume, multiplayer match menu, and game over", (t) => {
  const dom = installNavigationGlobals(t);
  let status = "playing";
  let context = { kind: "singleplayer" };
  let titleStarts = 0;
  let playAgain = 0;
  let pauses = 0;
  let resumes = 0;
  dom.elements.get("#press-start").click = () => { titleStarts += 1; };
  dom.elements.get("#play-again").click = () => { playAgain += 1; };
  const navigation = createTestNavigation({
    gameScreen: {
      getContext: () => context,
      getStatus: () => status
    },
    pauseGame() { pauses += 1; },
    resumeGame() { resumes += 1; }
  });

  assert.equal(navigation.performControllerStart(), true);
  assert.equal(titleStarts, 1);

  navigation.showScreen("game");
  assert.equal(navigation.performControllerStart(), true);
  assert.equal(dom.elements.get("#pause-overlay").hidden, false);
  assert.equal(pauses, 1);
  assert.equal(navigation.performControllerStart(), true);
  assert.equal(dom.elements.get("#pause-overlay").hidden, true);
  assert.equal(resumes, 1);

  context = { kind: "multiplayer" };
  assert.equal(navigation.performControllerStart(), true);
  assert.equal(dom.elements.get("#pause-overlay").hidden, false);
  assert.equal(pauses, 1, "multiplayer match menu must not pause simulation");
  assert.equal(navigation.performControllerStart(), true);
  assert.equal(dom.elements.get("#pause-overlay").hidden, true);
  assert.equal(resumes, 1, "multiplayer match menu must not resume an unpaused simulation");

  status = "gameover";
  assert.equal(navigation.performControllerStart(), true);
  assert.equal(playAgain, 1);
});

test("VS result and battle event copy is local-player aware", () => {
  assert.equal(getVersusResultLabel({ type: "winner", winnerId: "a" }, "a"), "WIN");
  assert.equal(getVersusResultLabel({ type: "winner", winnerId: "b" }, "a"), "LOSE");
  assert.equal(getVersusResultLabel({ type: "draw" }, "a"), "DRAW");
  assert.equal(getVersusEventLabel({ type: "ATTACK_GENERATED", playerId: "a", rows: 2 }, "a"), "ATTACK +2");
  assert.equal(getVersusEventLabel({ type: "GARBAGE_SENT", sourcePlayerId: "a", packet: { rows: 2 } }, "a"), "SENT 2");
  assert.equal(getVersusEventLabel({ type: "GARBAGE_CANCELLED", playerId: "a", rows: 1 }, "a"), "CANCEL 1");
  assert.equal(getVersusEventLabel({ type: "ATTACK_GENERATED", playerId: "b", rows: 4 }, "a"), null);
});

test("LAN lobby status exposes failures without stranding the signaling screen", () => {
  assert.match(getLanStatusText({ phase: "offer-ready", error: null }), /INVITE READY/);
  assert.match(getLanStatusText({ phase: "ready-to-start", error: null }), /START WHEN YOU'RE READY/);
  assert.match(getLanStatusText({ phase: "failed", error: "bad answer" }), /CONNECTION FAILED.*bad answer/i);
});

test("sculpt action follows projected legal targets", () => {
  const view = {
    focusedPiece: {
      id: "focus"
    },
    sculpt: {
      carve: { targets: [{ x: 0, y: 0 }] },
      fill: { targets: [{ x: 2, y: 0 }] }
    }
  };

  assert.equal(getSculptAction(view, { x: 0, y: 0 }), "CARVE");
  assert.equal(getSculptAction(view, { x: 2, y: 0 }), "FILL");
  assert.equal(getSculptAction(view, { x: 3, y: 0 }), null);

  view.sculpt.fill.targets = [];
  assert.equal(getSculptAction(view, { x: 2, y: 0 }), null);

  view.sculpt.carve.targets = [];
  assert.equal(getSculptAction(view, { x: 0, y: 0 }), null);
});

test("game input translation uses configured bindings with Enter as sculpt fallback", () => {
  const bindings = {
    focusPrevious: "KeyQ",
    focusNext: "KeyE",
    cursorUp: "KeyW",
    cursorLeft: "KeyA",
    cursorDown: "KeyS",
    cursorRight: "KeyD",
    sculpt: "Space",
    hardDrop: "ArrowDown"
  };

  assert.equal(getGameInputAction("KeyQ", bindings), "focusPrevious");
  assert.equal(getGameInputAction("ArrowDown", bindings), "hardDrop");
  assert.equal(getGameInputAction("Space", bindings), "sculpt");
  assert.equal(getGameInputAction("Enter", bindings), "sculpt");
  assert.equal(getGameInputAction("KeyR", bindings), null);
});

test("keyboard binding labels are derived from KeyboardEvent codes", () => {
  assert.equal(formatKeyLabel("KeyR"), "R");
  assert.equal(formatKeyLabel("Digit7"), "7");
  assert.equal(formatKeyLabel("ArrowLeft"), "LEFT");
  assert.equal(formatKeyLabel("Space"), "SPACE");
  assert.equal(formatKeyLabel("ShiftRight"), "R SHIFT");
});

test("responsive shell scales up when roomy and always fits within both viewport axes", () => {
  assert.equal(getResponsiveShellScale({
    availableWidth: 700,
    availableHeight: 900,
    shellWidth: 576,
    shellHeight: 680
  }), 1.12);

  assert.equal(getResponsiveShellScale({
    availableWidth: 700,
    availableHeight: 500,
    shellWidth: 576,
    shellHeight: 680
  }), 500 / 680);

  assert.equal(getResponsiveShellScale({
    availableWidth: 288,
    availableHeight: 900,
    shellWidth: 576,
    shellHeight: 680
  }), 0.5);

  assert.equal(getResponsiveShellScale({
    availableWidth: 288,
    availableHeight: 272,
    shellWidth: 576,
    shellHeight: 680
  }), 0.4);
});

// On-screen controls and pointer behavior.

test("on-screen gameplay actions validate data attributes and only repeat cursor movement", () => {
  const control = {
    disabled: false,
    dataset: { gameAction: "cursorLeft" }
  };
  const target = { closest: () => control };
  const root = { contains: (candidate) => candidate === control };

  assert.equal(getOnScreenGameAction(target, root), "cursorLeft");
  assert.equal(isGameplayActionId("hardDrop"), true);
  assert.equal(isGameplayActionId("pause"), false);
  assert.equal(isRepeatingGameAction("cursorLeft"), true);
  assert.equal(isRepeatingGameAction("hardDrop"), false);

  control.dataset.gameAction = "pause";
  assert.equal(getOnScreenGameAction(target, root), null);
});

test("on-screen pointer input exposes a pressed state and feature-detected haptics", () => {
  const button = createPointerControl("hardDrop");
  const { handlers, root } = createPointerRoot(button.control);
  const actions = [];
  const haptics = [];
  const input = createOnScreenGameInput({
    root,
    performAction(actionId) {
      actions.push(actionId);
      return true;
    },
    vibrate(duration) {
      haptics.push(duration);
    }
  });
  let prevented = false;

  handlers.get("pointerdown")(touchPointerEvent(7, button.control, {
    isPrimary: true,
    preventDefault() { prevented = true; }
  }));

  assert.deepEqual(actions, ["hardDrop"]);
  assert.deepEqual(haptics, [8]);
  assert.equal(prevented, true);
  assert.equal(button.pressed.has("is-pressed"), true);

  handlers.get("pointerup")({ pointerId: 7 });
  assert.equal(button.pressed.has("is-pressed"), false);
  input.destroy();
});

test("on-screen input keeps simultaneous touch pointers independent", () => {
  const left = createPointerControl("hardDrop");
  const right = createPointerControl("sculpt");
  const { handlers, root } = createPointerRoot(left.control, right.control);
  const actions = [];
  const input = createOnScreenGameInput({
    root,
    performAction(actionId) {
      actions.push(actionId);
      return true;
    },
    vibrate: null
  });

  handlers.get("pointerdown")(touchPointerEvent(1, left.control));
  handlers.get("pointerdown")(touchPointerEvent(2, right.control));
  assert.deepEqual(actions, ["hardDrop", "sculpt"]);
  assert.equal(left.pressed.has("is-pressed"), true);
  assert.equal(right.pressed.has("is-pressed"), true);

  handlers.get("pointerup")({ pointerId: 1 });
  assert.equal(left.pressed.has("is-pressed"), false);
  assert.equal(right.pressed.has("is-pressed"), true);
  handlers.get("pointercancel")({ pointerId: 2 });
  assert.equal(right.pressed.has("is-pressed"), false);
  input.destroy();
});

test("haptic feedback is optional and never required for controls", () => {
  assert.equal(triggerHapticFeedback(null), false);
  assert.equal(triggerHapticFeedback(() => { throw new Error("unsupported"); }), false);
  assert.equal(triggerHapticFeedback(() => true), true);
});

// Startup manual logic, not markup or styling details.

test("startup manual locale follows browser language with an English fallback", () => {
  assert.equal(resolveLocale(["ja-JP", "en-US"]), "ja");
  assert.equal(resolveLocale(["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLocale(["fr-FR"]), "en");

  const japanese = createI18n({ languages: ["ja"] });
  const english = createI18n({ languages: ["en"] });
  assert.equal(japanese.locale, "ja");
  assert.notEqual(japanese.t("manual.title"), english.t("manual.title"));
  assert.match(japanese.t("orientation.title"), /スマホ.*横持ち.*非対応/);
  assert.match(english.t("orientation.copy"), /portrait/i);
  assert.match(english.t("manual.lab.cell", { x: 2, y: 3, action: "CUT" }), /2.*3.*CUT/);
  assert.equal(english.t("manual.controls.controller.title"), "CONTROLLER");
  assert.equal(japanese.t("manual.controls.controller.title"), "コントローラー");
  assert.match(english.t("manual.lab.controllerHint"), /controller/i);
  assert.match(japanese.t("manual.lab.controllerHint"), /コントローラー/);
});

test("startup manual is automatically claimed only once per local storage", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };

  assert.equal(claimStartupManualVisit(storage), true);
  assert.equal(claimStartupManualVisit(storage), false);
});

test("interactive focus lab teaches cut, fill, focus switching, and drop without game state", () => {
  const initial = createManualDemoState();
  assert.equal(initial.focusedIndex, 0);
  assert.equal(getManualDemoTarget(initial), "cut");

  const cut = performManualDemoAction(initial, "sculpt");
  assert.equal(cut.lastAction, "cut");
  assert.equal(cut.scrap, 3);
  assert.equal(cut.pieces[0].cells.length, 3);
  assert.equal(getManualDemoTarget(cut), "fill");

  const filled = performManualDemoAction(cut, "sculpt");
  assert.equal(filled.lastAction, "fill");
  assert.equal(filled.scrap, 1);
  assert.equal(filled.pieces[0].cells.length, 4);

  const switched = performManualDemoAction(filled, "focusNext");
  assert.equal(switched.focusedIndex, 1);
  assert.equal(switched.lastAction, "focus");

  const dropped = performManualDemoAction(switched, "hardDrop");
  assert.equal(dropped.pieces[1].locked, true);
  assert.equal(dropped.pieces[1].origin.y, 4);
  assert.equal(dropped.focusedIndex, 0);
  assert.equal(dropped.lastAction, "drop");
});
