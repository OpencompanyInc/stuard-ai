// Safe expression parser — now sourced from @stuardai/workflow-core/runtime so
// the desktop and VM engines share one implementation. Re-exported here to keep
// existing `./expression-parser` import paths working.
export { SafeExpressionEvaluator, evaluateSafe } from '@stuardai/workflow-core/runtime';
