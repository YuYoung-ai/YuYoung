/************************************************************
 * undo.js — Undo/Redo 스택 (EDITOR_SYSTEM)
 * ----------------------------------------------------------
 * 값 스냅샷 기반. 편집 = 모델 패치 → 스냅샷 기록 → Ctrl+Z 복원.
 ************************************************************/
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function createUndo(limit = 50) {
  let past = [], future = [], present = null;
  return {
    init(state) { present = clone(state); past = []; future = []; },
    record(state) {
      const s = clone(state);
      if (present != null && eq(s, present)) return;
      if (present != null) past.push(present);
      if (past.length > limit) past.shift();
      present = s; future = [];
    },
    undo() { if (!past.length) return null; future.unshift(present); present = past.pop(); return clone(present); },
    redo() { if (!future.length) return null; past.push(present); present = future.shift(); return clone(present); },
    canUndo() { return past.length > 0; },
    canRedo() { return future.length > 0; },
  };
}
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
