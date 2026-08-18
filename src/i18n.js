const MESSAGES = Object.freeze({
  en: Object.freeze({
    "menu.manual": "MANUAL",
    "pause.howToPlay": "How to Play",
    "focus.resource.cut": "CUT LEFT",
    "focus.resource.scrap": "SCRAP",
    "focus.resource.fill": "FILL COST",
    "manual.title": "HOW TO PLAY",
    "manual.close": "Close manual",
    "manual.page.core.title": "1. HOW TO PLAY",
    "manual.page.core.lead": "Choose a piece, choose a cell, reshape the piece, then drop it.",
    "manual.step.focus.title": "CHOOSE A PIECE",
    "manual.step.focus.copy": "Switch between the falling pieces. The selected piece appears larger in FOCUS.",
    "manual.step.cursor.title": "CHOOSE A CELL",
    "manual.step.cursor.copy": "Move the cursor in FOCUS. Amber means remove, green means add, and pale means no change.",
    "manual.step.sculpt.title": "RESHAPE THE PIECE",
    "manual.step.sculpt.copy": "SCULPT removes a filled cell and gives 1 SCRAP, or spends 2 SCRAP to fill a dashed cell.",
    "manual.step.drop.title": "DROP THE PIECE",
    "manual.step.drop.copy": "Drop the selected piece to the bottom. Fill a complete horizontal row to clear it.",
    "manual.focus-note.title": "HOW TO READ FOCUS",
    "manual.focus-note.copy": "FOCUS shows the piece you are editing.",
    "manual.focus-note.solid": "Filled cells can be removed with CUT.",
    "manual.focus-note.dashed": "Dashed cells can be added with FILL for 2 SCRAP.",
    "manual.focus-note.resource": "CUT shows edits left. SCRAP shows available material.",
    "manual.page.lab.title": "2. PRACTICE",
    "manual.page.lab.lead": "Practice selecting, reshaping, and dropping pieces here. This does not affect your game.",
    "manual.lab.quick.title": "CONTROLS",
    "manual.lab.quick.focus": "SELECT PIECE",
    "manual.lab.quick.cursor": "MOVE",
    "manual.lab.quick.sculpt": "RESHAPE",
    "manual.lab.quick.drop": "DROP PIECE",
    "manual.lab.field": "FIELD",
    "manual.lab.focus": "FOCUS",
    "manual.lab.cut": "CUT",
    "manual.lab.scrap": "SCRAP",
    "manual.lab.target": "TARGET",
    "manual.lab.keyboardHint": "You can also click the keys below to practice.",
    "manual.lab.touchHint": "Use the controls below to practice.",
    "manual.lab.prev": "Previous focus",
    "manual.lab.next": "Next focus",
    "manual.lab.prevShort": "PREVIOUS",
    "manual.lab.nextShort": "NEXT",
    "manual.lab.up": "Cursor up",
    "manual.lab.left": "Cursor left",
    "manual.lab.down": "Cursor down",
    "manual.lab.right": "Cursor right",
    "manual.lab.sculpt": "Reshape the piece",
    "manual.lab.drop": "Drop the piece",
    "manual.lab.sculptShort": "RESHAPE",
    "manual.lab.dropShort": "DROP",
    "manual.lab.reset": "START OVER",
    "manual.lab.status.ready": "This filled cell can be removed.",
    "manual.lab.status.focus": "Selected the other piece.",
    "manual.lab.status.cursor": "Moved the cursor. Amber removes a cell; green adds one.",
    "manual.lab.status.cut": "Removed 1 cell. Gained 1 SCRAP.",
    "manual.lab.status.fill": "Added 1 cell. Used 2 SCRAP.",
    "manual.lab.status.invalid": "This cell cannot be changed.",
    "manual.lab.status.drop": "Dropped the piece to the bottom. Selected the next piece.",
    "manual.lab.status.allDropped": "Both practice pieces have been dropped. Start over to practice again.",
    "manual.lab.status.reset": "Practice restarted.",
    "manual.lab.cell": "Focus cell {x}, {y}: {action}",
    "manual.action.cut": "CUT",
    "manual.action.fill": "FILL",
    "manual.action.none": "no edit",
    "manual.page.controls.title": "3. CONTROL LIST",
    "manual.page.controls.lead": "Use these controls while playing.",
    "manual.controls.keyboard.title": "KEYBOARD",
    "manual.controls.keyboard.focus": "Select the previous / next piece",
    "manual.controls.keyboard.cursor": "Move the cursor",
    "manual.controls.keyboard.sculpt": "Reshape the selected cell",
    "manual.controls.keyboard.drop": "Drop the selected piece to the bottom",
    "manual.controls.keyboard.pause": "Pause / resume",
    "manual.controls.touch.title": "TOUCH CONTROLS",
    "manual.controls.touch.focus": "Select the next piece",
    "manual.controls.touch.cursor": "Move the cursor",
    "manual.controls.touch.sculpt": "Reshape the selected cell",
    "manual.controls.touch.drop": "Drop the selected piece to the bottom",
    "manual.controls.touch.pause": "Pause / resume",
    "manual.pagination.label": "Manual sections",
    "manual.pagination.core": "PLAY",
    "manual.pagination.lab": "PRACTICE",
    "manual.pagination.controls": "CONTROL LIST",
    "manual.nav.previous": "PREVIOUS",
    "manual.nav.next": "NEXT PAGE",
    "manual.nav.done": "START GAME",
    "manual.nav.close": "CLOSE MANUAL",
    "manual.nav.doneHint": "Close this guide and continue to game select.",
    "manual.nav.closeHint": "Return to where you opened the manual."
  }),
  ja: Object.freeze({
    "menu.manual": "MANUAL",
    "pause.howToPlay": "遊び方を見る",
    "focus.resource.cut": "CUT 残り",
    "focus.resource.scrap": "SCRAP 所持",
    "focus.resource.fill": "FILL コスト",
    "manual.title": "遊び方",
    "manual.close": "マニュアルを閉じる",
    "manual.page.core.title": "1. 基本の遊び方",
    "manual.page.core.lead": "ピースを選ぶ → マスを選ぶ → 形を変える → 落とす、の順に操作します。",
    "manual.step.focus.title": "操作するピースを選ぶ",
    "manual.step.focus.copy": "落下中のピースを切り替えます。選んだピースは FOCUS に大きく表示されます。",
    "manual.step.cursor.title": "加工するマスを選ぶ",
    "manual.step.cursor.copy": "FOCUS 内のカーソルを動かします。橙は削る、緑は埋める、淡色は変更できないマスです。",
    "manual.step.sculpt.title": "ピースを加工する",
    "manual.step.sculpt.copy": "塗りつぶされたマスを削ると素材が1増えます。点線のマスは素材を2使って埋められます。",
    "manual.step.drop.title": "ピースを落とす",
    "manual.step.drop.copy": "選んだピースを一番下まで落とします。横一列をすべて埋めると、その列が消えます。",
    "manual.focus-note.title": "FOCUS の見方",
    "manual.focus-note.copy": "FOCUS には、加工中のピースが表示されます。",
    "manual.focus-note.solid": "塗りつぶされたマス：削れます（CUT）。",
    "manual.focus-note.dashed": "点線のマス：素材を2使って埋められます（FILL）。",
    "manual.focus-note.resource": "CUT は残り加工回数、SCRAP は使える素材数です。",
    "manual.page.lab.title": "2. 操作を練習",
    "manual.page.lab.lead": "ここでは、ピースの選択・加工・落下を練習できます。ゲームには影響しません。",
    "manual.lab.quick.title": "操作キー",
    "manual.lab.quick.focus": "ピース選択",
    "manual.lab.quick.cursor": "マス移動",
    "manual.lab.quick.sculpt": "加工",
    "manual.lab.quick.drop": "落とす",
    "manual.lab.field": "FIELD",
    "manual.lab.focus": "FOCUS",
    "manual.lab.cut": "CUT",
    "manual.lab.scrap": "SCRAP",
    "manual.lab.target": "TARGET",
    "manual.lab.keyboardHint": "下のキー表示をクリックしても練習できます。",
    "manual.lab.touchHint": "画面下の操作ボタンで練習できます。",
    "manual.lab.prev": "前の FOCUS",
    "manual.lab.next": "次の FOCUS",
    "manual.lab.prevShort": "前",
    "manual.lab.nextShort": "次",
    "manual.lab.up": "カーソルを上へ",
    "manual.lab.left": "カーソルを左へ",
    "manual.lab.down": "カーソルを下へ",
    "manual.lab.right": "カーソルを右へ",
    "manual.lab.sculpt": "マスを加工",
    "manual.lab.drop": "ピースを落とす",
    "manual.lab.sculptShort": "加工",
    "manual.lab.dropShort": "落とす",
    "manual.lab.reset": "練習をやり直す",
    "manual.lab.status.ready": "この塗りつぶしマスは削れます。",
    "manual.lab.status.focus": "操作するピースを切り替えました。",
    "manual.lab.status.cursor": "カーソルを移動しました。橙は削る、緑は埋める操作です。",
    "manual.lab.status.cut": "1マス削りました。素材が1増えました。",
    "manual.lab.status.fill": "1マス埋めました。素材を2使いました。",
    "manual.lab.status.invalid": "このマスでは加工できません。",
    "manual.lab.status.drop": "ピースを一番下まで落としました。次のピースを選びました。",
    "manual.lab.status.allDropped": "2つの練習用ピースを落としました。「練習をやり直す」でもう一度試せます。",
    "manual.lab.status.reset": "練習を最初からやり直します。",
    "manual.lab.cell": "FOCUS マス {x}, {y}：{action}",
    "manual.action.cut": "CUT",
    "manual.action.fill": "FILL",
    "manual.action.none": "操作なし",
    "manual.page.controls.title": "3. 操作一覧",
    "manual.page.controls.lead": "ゲーム中に使うキーです。",
    "manual.controls.keyboard.title": "キーボード",
    "manual.controls.keyboard.focus": "前 / 次のピースを選ぶ",
    "manual.controls.keyboard.cursor": "加工するマスを選ぶ",
    "manual.controls.keyboard.sculpt": "選んだマスを加工する",
    "manual.controls.keyboard.drop": "選んだピースを一番下まで落とす",
    "manual.controls.keyboard.pause": "一時停止 / 再開",
    "manual.controls.touch.title": "タッチ操作",
    "manual.controls.touch.focus": "次のピースを選ぶ",
    "manual.controls.touch.cursor": "加工するマスを選ぶ",
    "manual.controls.touch.sculpt": "選んだマスを加工する",
    "manual.controls.touch.drop": "選んだピースを一番下まで落とす",
    "manual.controls.touch.pause": "一時停止 / 再開",
    "manual.pagination.label": "マニュアルのセクション",
    "manual.pagination.core": "遊び方",
    "manual.pagination.lab": "練習",
    "manual.pagination.controls": "操作一覧",
    "manual.nav.previous": "前のページ",
    "manual.nav.next": "次のページ",
    "manual.nav.done": "ゲームを始める",
    "manual.nav.close": "マニュアルを閉じる",
    "manual.nav.doneHint": "ガイドを閉じて、ゲーム選択へ進みます。",
    "manual.nav.closeHint": "マニュアルを開いた画面へ戻ります。"
  })
});

function browserLanguages() {
  if (!globalThis.navigator) return [];
  if (Array.isArray(globalThis.navigator.languages) && globalThis.navigator.languages.length > 0) {
    return globalThis.navigator.languages;
  }
  return globalThis.navigator.language ? [globalThis.navigator.language] : [];
}

export function resolveLocale(languages = []) {
  for (const language of languages) {
    const base = String(language || "").toLowerCase().split(/[-_]/)[0];
    if (base === "ja") return "ja";
    if (base === "en") return "en";
  }
  return "en";
}

function interpolate(message, values) {
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  ));
}

export function createI18n({ languages = browserLanguages() } = {}) {
  const locale = resolveLocale(languages);

  function t(key, values = {}) {
    const message = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
    return interpolate(message, values);
  }

  function apply(root = document) {
    if (root === document && document.documentElement) document.documentElement.lang = locale;
    for (const element of root.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    }
  }

  return Object.freeze({ locale, t, apply });
}
