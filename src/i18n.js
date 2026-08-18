const MESSAGES = Object.freeze({
  en: Object.freeze({
    "manual.kicker": "CARVEMINO SYSTEM 94 // FIELD GUIDE",
    "manual.title": "OPERATOR'S MANUAL",
    "manual.close": "Close manual",
    "manual.page.core.title": "01 // CORE LOOP",
    "manual.page.core.lead": "Shape the falling pieces before you commit them to the field.",
    "manual.step.focus.title": "FOCUS",
    "manual.step.focus.copy": "Choose the active piece you want to edit. The FIELD marks it, and the FOCUS window enlarges that piece.",
    "manual.step.cursor.title": "AIM",
    "manual.step.cursor.copy": "Move the sculpt cursor inside FOCUS. Its outline changes to show what the selected cell will do.",
    "manual.step.sculpt.title": "CUT / FILL",
    "manual.step.sculpt.copy": "Sculpt an occupied cell to CUT it and gain scrap. Sculpt an editable empty cell to FILL it by spending scrap.",
    "manual.step.drop.title": "DROP",
    "manual.step.drop.copy": "When the shape is ready, hard-drop the focused piece. Complete horizontal rows to clear them.",
    "manual.focus-note.title": "READING THE FOCUS WINDOW",
    "manual.focus-note.copy": "Solid cells belong to the focused piece. Dashed empty targets can be filled. The cursor is amber on CUT, green on FILL, and pale when no edit is available.",
    "manual.page.lab.title": "02 // FOCUS LAB",
    "manual.page.lab.lead": "This tiny replica is safe to operate. It does not affect the real game.",
    "manual.lab.field": "FIELD",
    "manual.lab.focus": "FOCUS",
    "manual.lab.cut": "CUT",
    "manual.lab.scrap": "SCRAP",
    "manual.lab.target": "TARGET",
    "manual.lab.keyboardHint": "Use the real default keys here: Q / E focus, WASD cursor, Z or Enter sculpt, Space drop.",
    "manual.lab.touchHint": "Use the cabinet Pad below to operate this lab: D-PAD cursor, SELECT focus, A sculpt, B drop.",
    "manual.lab.prev": "Previous focus",
    "manual.lab.next": "Next focus",
    "manual.lab.up": "Cursor up",
    "manual.lab.left": "Cursor left",
    "manual.lab.down": "Cursor down",
    "manual.lab.right": "Cursor right",
    "manual.lab.sculpt": "Sculpt",
    "manual.lab.drop": "Drop",
    "manual.lab.reset": "RESET LAB",
    "manual.lab.status.ready": "Cursor is on a solid cell: SCULPT will CUT it.",
    "manual.lab.status.focus": "Focus changed. FIELD and FOCUS now point to the other active piece.",
    "manual.lab.status.cursor": "Cursor moved. Watch TARGET change between CUT, FILL, and --.",
    "manual.lab.status.cut": "CUT: one cell removed; scrap increased by 1.",
    "manual.lab.status.fill": "FILL: one editable cell added; 2 scrap spent.",
    "manual.lab.status.invalid": "No sculpt action is available on this cell.",
    "manual.lab.status.drop": "DROP: the focused piece is committed at the bottom. Focus moved to the next editable piece.",
    "manual.lab.status.allDropped": "Both practice pieces are committed. Reset the lab to try again.",
    "manual.lab.status.reset": "Lab reset. Try cutting, filling, changing focus, then dropping.",
    "manual.lab.cell": "Focus cell {x}, {y}: {action}",
    "manual.action.cut": "CUT",
    "manual.action.fill": "FILL",
    "manual.action.none": "no edit",
    "manual.page.controls.title": "03 // CONTROLS",
    "manual.page.controls.lead": "The manual follows the same input hints as the cabinet, so this page changes with your device.",
    "manual.controls.keyboard.title": "KEYBOARD",
    "manual.controls.keyboard.focus": "Q / E — previous / next focus",
    "manual.controls.keyboard.cursor": "W A S D — move sculpt cursor",
    "manual.controls.keyboard.sculpt": "Z or ENTER — sculpt selected cell",
    "manual.controls.keyboard.drop": "SPACE — hard drop focused piece",
    "manual.controls.keyboard.pause": "ESC — pause / resume",
    "manual.controls.touch.title": "TOUCH CONTROLS",
    "manual.controls.touch.focus": "SELECT — cycle focus (wide tablet rails expose PREV / NEXT)",
    "manual.controls.touch.cursor": "D-PAD — move sculpt cursor",
    "manual.controls.touch.sculpt": "A / SCULPT — sculpt selected cell",
    "manual.controls.touch.drop": "B / DROP — hard drop focused piece",
    "manual.controls.touch.pause": "START — pause / resume",
    "manual.controls.tip.title": "OPERATOR TIP",
    "manual.controls.tip.copy": "FOCUS is your workbench. Check CUT, SCRAP, and the cursor color there before committing a piece to the FIELD.",
    "manual.nav.previous": "PREVIOUS",
    "manual.nav.next": "NEXT PAGE",
    "manual.nav.done": "START PLAY"
  }),
  ja: Object.freeze({
    "manual.kicker": "CARVEMINO SYSTEM 94 // フィールドガイド",
    "manual.title": "操作マニュアル",
    "manual.close": "マニュアルを閉じる",
    "manual.page.core.title": "01 // 基本ループ",
    "manual.page.core.lead": "落下中のピースを加工してから、フィールドへ確定します。",
    "manual.step.focus.title": "FOCUS",
    "manual.step.focus.copy": "加工したいアクティブピースを選びます。FIELD 側で対象が示され、FOCUS ウィンドウにはそのピースが拡大表示されます。",
    "manual.step.cursor.title": "狙う",
    "manual.step.cursor.copy": "FOCUS 内で加工カーソルを動かします。カーソルの色で、そのマスに対して可能な操作が分かります。",
    "manual.step.sculpt.title": "CUT / FILL",
    "manual.step.sculpt.copy": "ピースのあるマスを SCULPT すると CUT して scrap を獲得。編集可能な空きマスなら scrap を消費して FILL します。",
    "manual.step.drop.title": "DROP",
    "manual.step.drop.copy": "形ができたら、FOCUS 中のピースをハードドロップ。横一列を埋めるとラインが消えます。",
    "manual.focus-note.title": "FOCUS ウィンドウの見方",
    "manual.focus-note.copy": "塗りつぶしマスが現在のピース、点線の空きマスが FILL 候補です。カーソルは CUT なら橙、FILL なら緑、操作不可なら淡色になります。",
    "manual.page.lab.title": "02 // FOCUS LAB",
    "manual.page.lab.lead": "下のミニ画面は自由に操作できます。本番ゲームの状態には影響しません。",
    "manual.lab.field": "FIELD",
    "manual.lab.focus": "FOCUS",
    "manual.lab.cut": "CUT",
    "manual.lab.scrap": "SCRAP",
    "manual.lab.target": "TARGET",
    "manual.lab.keyboardHint": "本番の初期キーをそのまま試せます：Q / E で FOCUS、WASD でカーソル、Z または Enter で SCULPT、Space で DROP。",
    "manual.lab.touchHint": "筐体下部の実PadでこのLABを操作します：D-PADでカーソル、SELECTでFOCUS、AでSCULPT、BでDROP。",
    "manual.lab.prev": "前の FOCUS",
    "manual.lab.next": "次の FOCUS",
    "manual.lab.up": "カーソルを上へ",
    "manual.lab.left": "カーソルを左へ",
    "manual.lab.down": "カーソルを下へ",
    "manual.lab.right": "カーソルを右へ",
    "manual.lab.sculpt": "SCULPT",
    "manual.lab.drop": "DROP",
    "manual.lab.reset": "LAB をリセット",
    "manual.lab.status.ready": "カーソルはピース上です。SCULPT すると CUT します。",
    "manual.lab.status.focus": "FOCUS を切り替えました。FIELD と FOCUS が別のアクティブピースを指しています。",
    "manual.lab.status.cursor": "カーソルを移動しました。TARGET が CUT / FILL / -- に変わるのを確認してください。",
    "manual.lab.status.cut": "CUT：1マス削り、scrap が1増えました。",
    "manual.lab.status.fill": "FILL：編集可能な1マスを追加し、scrap を2消費しました。",
    "manual.lab.status.invalid": "このマスでは加工できません。",
    "manual.lab.status.drop": "DROP：FOCUS 中のピースを最下部に確定しました。次の編集可能なピースへ FOCUS が移ります。",
    "manual.lab.status.allDropped": "練習用ピースを両方確定しました。RESET でもう一度試せます。",
    "manual.lab.status.reset": "LAB をリセットしました。CUT、FILL、FOCUS 切替、DROP を試してください。",
    "manual.lab.cell": "FOCUS マス {x}, {y}：{action}",
    "manual.action.cut": "CUT",
    "manual.action.fill": "FILL",
    "manual.action.none": "操作なし",
    "manual.page.controls.title": "03 // 操作方法",
    "manual.page.controls.lead": "このマニュアルも筐体と同じ入力ヒントを使うため、端末に合わせて表示が切り替わります。",
    "manual.controls.keyboard.title": "キーボード",
    "manual.controls.keyboard.focus": "Q / E — 前 / 次の FOCUS",
    "manual.controls.keyboard.cursor": "W A S D — 加工カーソル移動",
    "manual.controls.keyboard.sculpt": "Z または ENTER — 選択マスを SCULPT",
    "manual.controls.keyboard.drop": "SPACE — FOCUS 中のピースをハードドロップ",
    "manual.controls.keyboard.pause": "ESC — ポーズ / 再開",
    "manual.controls.touch.title": "タッチ操作",
    "manual.controls.touch.focus": "SELECT — FOCUS 切替（横長タブレットのレールでは PREV / NEXT）",
    "manual.controls.touch.cursor": "D-PAD — 加工カーソル移動",
    "manual.controls.touch.sculpt": "A / SCULPT — 選択マスを SCULPT",
    "manual.controls.touch.drop": "B / DROP — FOCUS 中のピースをハードドロップ",
    "manual.controls.touch.pause": "START — ポーズ / 再開",
    "manual.controls.tip.title": "OPERATOR TIP",
    "manual.controls.tip.copy": "FOCUS は加工台です。FIELD に確定する前に、CUT、SCRAP、カーソル色をここで確認すると安全です。",
    "manual.nav.previous": "前のページ",
    "manual.nav.next": "次のページ",
    "manual.nav.done": "ゲームを始める"
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
