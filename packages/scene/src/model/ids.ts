// Deterministic id generation. A monotonic counter (not Math.random) keeps tests
// reproducible and ids stable within a document/session.
let counter = 0;

export function nextId(prefix = 'sh'): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}`;
}

/** Reset the counter (tests only). */
export function resetIds(seed = 0): void {
  counter = seed;
}
