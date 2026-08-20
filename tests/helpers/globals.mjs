export function replaceGlobal(t, name, value) {
  const hadOwn = Object.hasOwn(globalThis, name);
  const previous = globalThis[name];
  globalThis[name] = value;
  t.after(() => {
    if (!hadOwn) delete globalThis[name];
    else globalThis[name] = previous;
  });
}
