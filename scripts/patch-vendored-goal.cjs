/* Patch script: inject the GoalTransitionGuard seam into the vendored dsh-goal lib/index.js.
   Run AFTER restoring the pristine copy (see patch-restore.sh / manual copy). */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'vendor', '@deepseek-ai', 'dsh-goal', 'lib', 'index.js');
const exportMarker =
  'export { GOAL_CHANGE_VERSION, GoalError, GoalId, GoalService, GoalService as default, applyGoalProjection, decodeGoalChange, foldGoal, goalChangeRef };';

let code = fs.readFileSync(file, 'utf8');
if (code.includes('verification-seam (GoalTransitionGuard, sync pre-commit)')) {
  throw new Error('already patched; restore pristine first');
}

// ── 1) commitSnapshot: sync guard + permitRef attribution ─────────────────────
const headOriginal = `\t\tcommitSnapshot(agent, cache, operation, goal, roundsStarted, createdAt, updatedAt, activation) {
\t\t\tconst change = {
\t\t\t\tkind: "goal/change",
\t\t\t\tversion: 1,
\t\t\t\toperation,
\t\t\t\tgoal,
\t\t\t\troundsStarted,
\t\t\t\tcreatedAt,
\t\t\t\tupdatedAt
\t\t\t};`;
const headPatched = `\t\tcommitSnapshot(agent, cache, operation, goal, roundsStarted, createdAt, updatedAt, activation) {
\t\t\tconst permitRef = operation === "complete" ? dispatchTransitionGuards(agent, goal) : void 0;
\t\t\tconst change = {
\t\t\t\tkind: "goal/change",
\t\t\t\tversion: 1,
\t\t\t\toperation,
\t\t\t\tgoal,
\t\t\t\troundsStarted,
\t\t\t\tcreatedAt,
\t\t\t\tupdatedAt,
\t\t\t\t...(permitRef === void 0 ? {} : { permitRef })
\t\t\t};`;
if (!code.includes(headOriginal)) throw new Error('commitSnapshot head not found');
code = code.replace(headOriginal, headPatched);

// ── 2) decoder: accept optional permitRef (attribution is upstream scope) ─────
const lineIndex = code.split('\n').findIndex((line) => line.includes('goal snapshot change must have exactly'));
if (lineIndex < 0) throw new Error('decoder strict-keys line not found');
const lines = code.split('\n');
lines[lineIndex] =
  '\t\tconst __changeKeys = Object.keys(value).sort().join(","); const __snapshotKeys = allowed.sort().join(","); const __permitKeys = [...allowed, "permitRef"].sort().join(","); if (__changeKeys !== __snapshotKeys && __changeKeys !== __permitKeys) throw new Error(`goal snapshot change must have exactly ${allowed.sort().join(",")} fields`);';
code = lines.join('\n');

const snapshotReturn =
  '\treturn {\n\t\tkind: "goal/change",\n\t\tversion: 1,\n\t\toperation: value["operation"],\n\t\tgoal: decodeSnapshot(value["goal"]),\n\t\troundsStarted: nonNegativeInteger(value["roundsStarted"], "roundsStarted"),\n\t\tcreatedAt,\n\t\tupdatedAt\n\t};';
const snapshotReturnPermit =
  '\treturn {\n\t\tkind: "goal/change",\n\t\tversion: 1,\n\t\toperation: value["operation"],\n\t\tgoal: decodeSnapshot(value["goal"]),\n\t\troundsStarted: nonNegativeInteger(value["roundsStarted"], "roundsStarted"),\n\t\tcreatedAt,\n\t\tupdatedAt,\n\t\t...("permitRef" in value ? { permitRef: value["permitRef"] } : {})\n\t};';
if (!code.includes(snapshotReturn)) throw new Error('snapshot return object not found');
code = code.replace(snapshotReturn, snapshotReturnPermit);

// ── 3) seam registry (process-global; GoalService is a host singleton) ────────
if (!code.includes(exportMarker)) throw new Error('export tail not found');
const seam = `
//#region verification-seam (GoalTransitionGuard, sync pre-commit)
// 进程级单例 guard 注册表（GoalService 为 host 单例；ctx.get 代理不破坏注册/分发一致性）。向后兼容：无 guards → 放行。
const GOAL_TRANSITION_GUARDS = [];
function dispatchTransitionGuards(agent, nextGoal) {
  if (GOAL_TRANSITION_GUARDS.length === 0) return void 0;
  const request = {
    agent,
    operation: 'complete',
    goalId: nextGoal.id,
    currentRevision: nextGoal.revision - 1
  };
  for (const guard of GOAL_TRANSITION_GUARDS) {
    let verdict;
    try {
      verdict = guard(request);
    } catch (error) {
      throw new GoalError('goal transition guard threw: ' + (error && error.message ? error.message : String(error)), 'GOAL_TRANSITION_GUARD_ERROR');
    }
    if (verdict && verdict.kind === 'deny') {
      throw new GoalError(verdict.reason || 'goal completion rejected by transition guard', 'GOAL_TRANSITION_DENIED');
    }
    if (verdict && verdict.kind === 'allow' && typeof verdict.permitRef === 'string') {
      return verdict.permitRef;
    }
  }
  return void 0;
}
GoalService.prototype.registerTransitionGuard = function registerTransitionGuard(guard) {
  if (typeof guard !== 'function') throw new TypeError('transition guard must be a function');
  GOAL_TRANSITION_GUARDS.push(guard);
  return () => {
    const index = GOAL_TRANSITION_GUARDS.indexOf(guard);
    if (index >= 0) GOAL_TRANSITION_GUARDS.splice(index, 1);
  };
};
//#endregion
`;
code = code.replace(exportMarker, exportMarker + '\n' + seam);

fs.writeFileSync(file, code, 'utf8');
console.log('patched vendored dsh-goal (guard + decoder + attribution)');
