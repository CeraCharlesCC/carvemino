import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_KEYBINDINGS, GAMEPLAY_ACTIONS } from "../src/config.js";
import { createI18n, resolveLocale } from "../src/i18n.js";
import { getGameInputAction } from "../src/ui/game-screen.js";
import {
  createOnScreenGameInput,
  getOnScreenGameAction,
  isGameplayActionId,
  isRepeatingGameAction,
  triggerHapticFeedback
} from "../src/ui/game-input.js";
import { getResponsiveShellScale } from "../src/ui/responsive-shell.js";
import {
  claimStartupManualVisit,
  createManualDemoState,
  getManualDemoTarget,
  performManualDemoAction
} from "../src/ui/startup-manual.js";
import { getSculptAction, getTitleScreenAction } from "../src/ui/ui.js";

test("title screen keyboard actions are explicit and do not use selection keys", () => {
  assert.equal(getTitleScreenAction("Enter"), "start");
  assert.equal(getTitleScreenAction("KeyR"), "records");
  assert.equal(getTitleScreenAction("KeyH"), "manual");
  assert.equal(getTitleScreenAction("KeyO"), "options");

  for (const code of ["Space", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"]) {
    assert.equal(getTitleScreenAction(code), null);
  }
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

test("gameplay action metadata owns labels and default keybindings", () => {
  assert.deepEqual(
    Object.fromEntries(GAMEPLAY_ACTIONS.map(({ id, defaultKeybinding }) => [id, defaultKeybinding])),
    DEFAULT_KEYBINDINGS
  );
  assert(GAMEPLAY_ACTIONS.every(({ id, label }) => id && label));
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
  const handlers = new Map();
  const pressedClasses = new Set();
  const control = {
    disabled: false,
    dataset: { gameAction: "hardDrop" },
    classList: {
      add: (value) => pressedClasses.add(value),
      remove: (value) => pressedClasses.delete(value)
    },
    setPointerCapture() {}
  };
  const target = { closest: () => control };
  const root = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type) => handlers.delete(type),
    contains: (candidate) => candidate === control
  };
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

  handlers.get("pointerdown")({
    isPrimary: true,
    pointerType: "touch",
    pointerId: 7,
    target,
    preventDefault() { prevented = true; }
  });

  assert.deepEqual(actions, ["hardDrop"]);
  assert.deepEqual(haptics, [8]);
  assert.equal(prevented, true);
  assert.equal(pressedClasses.has("is-pressed"), true);

  handlers.get("pointerup")({ pointerId: 7 });
  assert.equal(pressedClasses.has("is-pressed"), false);
  input.destroy();
});

test("on-screen input keeps simultaneous touch pointers independent", () => {
  const handlers = new Map();
  const makeControl = (actionId) => {
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
  };
  const left = makeControl("hardDrop");
  const right = makeControl("sculpt");
  const root = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type) => handlers.delete(type),
    contains: (candidate) => candidate === left.control || candidate === right.control
  };
  const actions = [];
  const input = createOnScreenGameInput({
    root,
    performAction(actionId) {
      actions.push(actionId);
      return true;
    },
    vibrate: null
  });
  const eventFor = (pointerId, control) => ({
    isPrimary: pointerId === 1,
    pointerType: "touch",
    pointerId,
    target: { closest: () => control },
    preventDefault() {}
  });

  handlers.get("pointerdown")(eventFor(1, left.control));
  handlers.get("pointerdown")(eventFor(2, right.control));
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

test("controller markup covers tablet rails, phone deck, and pause access", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markup, /tablet-control-rail-left[\s\S]*data-game-action="focusPrevious"/);
  assert.match(markup, /tablet-control-rail-right[\s\S]*data-game-action="focusNext"/);
  assert.match(markup, /game-control-surface[\s\S]*data-game-action="hardDrop"/);
  assert.match(markup, /game-control-surface[\s\S]*data-game-action="sculpt"/);
  assert.equal((markup.match(/data-pause-game/g) || []).length, 2);
  assert.doesNotMatch(styles, /data-active-screen="game"\]\s+\.game-control-surface/);
  assert.doesNotMatch(styles, /data-active-screen="game"\]\s+\.tablet-control-rail/);
  assert.match(styles, /\.drop-button\s*\{[\s\S]*?top:\s*var\(--deck-action-stagger\)/);
  assert.match(styles, /\.sculpt-button\s*\{[\s\S]*?top:\s*calc\(0px\s*-\s*var\(--deck-action-stagger\)\)/);
  assert.match(styles, /orientation:\s*portrait[\s\S]*?\.console-layout\s*\{[\s\S]*?height:\s*100%[\s\S]*?display:\s*flex/);
  assert.match(styles, /orientation:\s*portrait[\s\S]*?\.game-control-surface\s*\{[\s\S]*?margin:\s*auto\s+0\s+0/);
  assert.match(styles, /\.rail-drop-button\s*\{\s*grid-area:\s*2\s*\/\s*1/);
  assert.match(styles, /\.rail-sculpt-button\s*\{\s*grid-area:\s*1\s*\/\s*2/);
});

test("input hints follow the visible keyboard, handheld, and tablet-rail controls", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markup, /data-input-hint="keyboard">WASD \/ ARROWS SELECT/);
  assert.match(markup, /data-input-hint="touch">D-PAD SELECT/);
  assert.match(markup, /data-input-hint="handheld"><kbd>SELECT<\/kbd><span>CYCLE FOCUS/);
  assert.match(markup, /data-input-hint="tablet-rail"><kbd>−<\/kbd><span>&lt; FOCUS &gt;<\/span><kbd>\+/);
  assert.match(markup, /pause-hint" data-input-hint="keyboard">ESC RESUME/);
  assert.match(markup, /pause-hint" data-input-hint="touch">START RESUME/);

  assert.match(styles, /\[data-input-hint="touch"\],[\s\S]*?\[data-input-hint="tablet-rail"\][\s\S]*?display:\s*none/);
  assert.match(styles, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\[data-input-hint="keyboard"\]\s*\{\s*display:\s*none[\s\S]*?\.menu-footer \[data-input-hint="touch"\]\s*\{\s*display:\s*inline/);
  assert.match(styles, /orientation:\s*portrait[\s\S]*?\.focus-nav\[data-input-hint="handheld"\]\s*\{\s*display:\s*flex/);
  assert.match(styles, /orientation:\s*landscape[\s\S]*?min-width:\s*900px[\s\S]*?min-height:\s*600px[\s\S]*?\.focus-nav\[data-input-hint="tablet-rail"\]\s*\{\s*display:\s*flex/);
});

test("startup manual locale follows browser language with an English fallback", () => {
  assert.equal(resolveLocale(["ja-JP", "en-US"]), "ja");
  assert.equal(resolveLocale(["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLocale(["fr-FR"]), "en");

  const japanese = createI18n({ languages: ["ja"] });
  const english = createI18n({ languages: ["en"] });
  assert.equal(japanese.locale, "ja");
  assert.equal(japanese.t("menu.manual"), "MANUAL");
  assert.equal(japanese.t("manual.title"), "遊び方");
  assert.equal(english.t("manual.title"), "HOW TO PLAY");
  assert.equal(japanese.t("manual.step.drop.copy"), "選んだピースを一番下まで落とします。横一列をすべて埋めると、その列が消えます。");
  assert.equal(japanese.t("manual.page.controls.lead"), "ゲーム中に使うキーです。");
  assert.equal(english.t("manual.lab.cell", { x: 2, y: 3, action: "CUT" }), "Focus cell 2, 3: CUT");
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

test("startup manual uses the cabinet display and physical Pad on touch devices", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../src/ui/navigation.js", import.meta.url), "utf8");
  const manual = readFileSync(new URL("../src/ui/startup-manual.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8");

  assert.match(markup, /id="title-manual"[^>]*data-open-manual[^>]*aria-keyshortcuts="H"/);
  assert.match(markup, /id="pause-how-to-play"[^>]*data-open-manual/);
  assert.match(markup, /<dialog class="startup-manual" id="startup-manual"/);
  assert.match(markup, /manual-step-title-row[\s\S]*manual-inline-keys/);
  assert.match(markup, /class="manual-lab-quick-card"/);
  assert.match(markup, /manual\.focus-note\.solid/);
  assert.doesNotMatch(markup, /OPERATOR TIP|CORE LOOP|FOCUS LAB/);
  assert.doesNotMatch(styles, /manual-operator-tip/);
  assert.equal((markup.match(/data-manual-page-target=/g) || []).length, 3);
  assert.match(markup, /data-manual-page="1"[\s\S]*id="manual-field-grid"[\s\S]*id="manual-focus-grid"/);
  assert.match(markup, /data-input-hint="keyboard"[\s\S]*data-manual-action="focusPrevious"/);
  assert.match(markup, /class="manual-physical-pad-hint" data-input-hint="touch"/);
  assert.doesNotMatch(markup, /manual-touch-pad/);
  assert.match(styles, /\.manual-book\s*\{[\s\S]*repeating-linear-gradient[\s\S]*linear-gradient/);
  assert.match(styles, /\.startup-manual \.manual-physical-pad-hint\[data-input-hint="touch"\][\s\S]*display:\s*block/);
  assert.match(styles, /\.manual-book-footer button\.is-start-action[\s\S]*background:\s*var\(--manual-ink\)/);
  assert.match(styles, /\.manual-pagination button\[aria-current="page"\]/);
  assert.match(styles, /--manual-screen-top[\s\S]*--manual-screen-height/);
  assert.match(manual, /usesPhysicalPad\(\)[\s\S]*dialog\.show\(\)/);
  assert.match(manual, /function handleGameAction\(actionId\)[\s\S]*perform\(actionId\)/);
  assert.match(manual, /paginationButtons[\s\S]*aria-current/);
  assert.match(ui, /startupManual\?\.handleGameAction\(actionId\)/);
  assert.match(ui, /startupManual\?\.open\(\{ returnFocus, mode: "reference" \}\)/);
  assert.match(ui, /if \(claimStartupManualVisit\(\)\) startupManual\.open\(\{ mode: "startup" \}\)/);
  assert.match(navigation, /document\.querySelector\("#startup-manual"\)\?\.open/);
  assert.match(navigation, /KeyH[\s\S]*data-open-manual/);
});

test("affordance improvements clarify resources", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const attract = readFileSync(new URL("../src/ui/attract.js", import.meta.url), "utf8");
  const gameScreen = readFileSync(new URL("../src/ui/game-screen.js", import.meta.url), "utf8");

  assert.match(attract, /setInterval\([\s\S]*2500\)/);
  assert.match(attract, /SCULPT A SOLID CELL • GAIN 1 SCRAP/);
  assert.match(attract, /SCULPT A DASHED EDGE • SPEND 2 SCRAP/);
  assert.match(attract, /HARD DROP TO LOCK IT • COMPLETE ROWS/);
  assert.match(markup, /data-i18n="focus\.resource\.cut">CUT LEFT/);
});
