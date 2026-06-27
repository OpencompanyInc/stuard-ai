/**
 * stateCodeGenerator - Generates runtime JavaScript from visual state variables
 * and tool action configurations. This code is injected into the custom UI's JS
 * to provide React-like state management and no-code tool calling.
 */

import type { UIStateVariable, UIToolAction } from '../types';

/**
 * Generate runtime JS that declares useState variables and tool action handlers
 * from the visual configuration. This is prepended to the user's custom JS.
 */
export function generateStateAndToolJs(
  stateVariables: UIStateVariable[],
  toolActions: UIToolAction[],
): string {
  if (stateVariables.length === 0 && toolActions.length === 0) return '';

  const lines: string[] = [];
  lines.push('// ═══ Auto-generated state & tool actions (from State panel) ═══');
  lines.push('');

  // State variable declarations using useVar (preview) or useState (runtime)
  if (stateVariables.length > 0) {
    lines.push('// State variables');
    for (const v of stateVariables) {
      const defaultStr = JSON.stringify(v.defaultValue);
      // useVar is available in both preview (stub) and runtime (real IPC)
      lines.push(`var [${v.name}, set_${v.name}] = useVar('${v.name}', ${defaultStr});`);
    }
    lines.push('');
  }

  // Tool action handler functions
  if (toolActions.length > 0) {
    lines.push('// Tool action handlers');
    for (const action of toolActions) {
      const fnName = `action_${action.id}`;
      lines.push(`async function ${fnName}() {`);

      // Set loading var if configured
      if (action.loadingVar) {
        lines.push(`  set_${action.loadingVar}(true);`);
      }
      // Clear error var if configured
      if (action.errorVar) {
        lines.push(`  set_${action.errorVar}('');`);
      }

      lines.push('  try {');

      // Build args, replacing $state.varName references with actual variable values
      const argEntries = Object.entries(action.args);
      if (argEntries.length > 0) {
        lines.push('    var __args = {};');
        for (const [key, value] of argEntries) {
          const strVal = String(value ?? '');
          if (strVal.startsWith('$state.')) {
            const varName = strVal.slice(7);
            lines.push(`    __args['${key}'] = ${varName};`);
          } else {
            lines.push(`    __args['${key}'] = ${JSON.stringify(value)};`);
          }
        }
        lines.push(`    var __result = await stuard.callTool('${action.toolName}', __args);`);
      } else {
        lines.push(`    var __result = await stuard.callTool('${action.toolName}', {});`);
      }

      // Store result in state variable if configured
      if (action.resultVar) {
        lines.push(`    if (__result && __result.ok !== false) {`);
        lines.push(`      set_${action.resultVar}(__result.result !== undefined ? __result.result : __result);`);
        lines.push('    }');
      }

      lines.push('  } catch (__err) {');
      if (action.errorVar) {
        lines.push(`    set_${action.errorVar}(String(__err && __err.message ? __err.message : __err));`);
      }
      lines.push('    console.error("[Action] ' + action.name + ' failed:", __err);');
      lines.push('  } finally {');
      if (action.loadingVar) {
        lines.push(`    set_${action.loadingVar}(false);`);
      }
      lines.push('  }');
      lines.push('}');
      lines.push('');
    }

    // Wire up triggers
    const onLoadActions = toolActions.filter(a => a.trigger === 'load');
    if (onLoadActions.length > 0) {
      lines.push('// Auto-run on load');
      lines.push('setTimeout(function() {');
      for (const a of onLoadActions) {
        lines.push(`  action_${a.id}();`);
      }
      lines.push('}, 100);');
      lines.push('');
    }

    // Wire click triggers to elements by ID
    const clickActions = toolActions.filter(a => a.trigger === 'click' && a.triggerConfig?.elementId);
    if (clickActions.length > 0) {
      lines.push('// Wire click triggers to elements');
      lines.push('setTimeout(function() {');
      for (const a of clickActions) {
        const elId = a.triggerConfig!.elementId!;
        const fnName = `action_${a.id}`;
        lines.push(`  var __el_${a.id} = document.getElementById('${elId}');`);
        lines.push(`  if (__el_${a.id}) {`);
        lines.push(`    __el_${a.id}.addEventListener('click', function(e) {`);
        lines.push(`      e.preventDefault(); e.stopPropagation();`);
        lines.push(`      ${fnName}();`);
        lines.push('    });');
        lines.push('  } else {');
        lines.push(`    console.warn('[ToolAction] Element #${elId} not found for action ${a.name}');`);
        lines.push('  }');
      }
      lines.push('}, 150);');
      lines.push('');
    }

    // Wire stateChange triggers
    const stateChangeActions = toolActions.filter(a => a.trigger === 'stateChange' && a.triggerConfig?.stateVar);
    if (stateChangeActions.length > 0) {
      lines.push('// Wire stateChange triggers');
      for (const a of stateChangeActions) {
        const varName = a.triggerConfig!.stateVar!;
        const fnName = `action_${a.id}`;
        const debounce = a.triggerConfig?.debounceMs || 300;
        lines.push(`(function() {`);
        lines.push(`  var __timer_${a.id} = null;`);
        lines.push(`  if (!window.__varListeners) window.__varListeners = {};`);
        lines.push(`  if (!window.__varListeners['${varName}']) window.__varListeners['${varName}'] = [];`);
        lines.push(`  window.__varListeners['${varName}'].push(function() {`);
        lines.push(`    clearTimeout(__timer_${a.id});`);
        lines.push(`    __timer_${a.id} = setTimeout(function() { ${fnName}(); }, ${debounce});`);
        lines.push('  });');
        lines.push('})();');
      }
      lines.push('');
    }

    // Expose action functions on window for HTML onclick bindings
    lines.push('// Expose action functions for HTML onclick bindings');
    for (const action of toolActions) {
      lines.push(`window.action_${action.id} = action_${action.id};`);
    }
    lines.push('');
  }

  lines.push('// ═══ End auto-generated code ═══');
  lines.push('');

  return lines.join('\n');
}
