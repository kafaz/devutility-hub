import { generateId } from '../../../utils';
import type { BusinessExecution, BusinessTemplate, StepResult } from '../types';

export function replaceTemplateVars(
  cmd: string,
  globalVars: Record<string, string>,
  perNodeVars: Record<string, string>,
  sharedVars: Record<string, string>,
  nodeMeta: { name: string; ip: string }
): string {
  let result = cmd;

  // {{var}} -> global or perNode
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (perNodeVars[name] !== undefined) return perNodeVars[name];
    if (globalVars[name] !== undefined) return globalVars[name];
    return `{{${name}}}`; // leave unresolved for validation
  });

  // $capture.x -> sharedVars
  result = result.replace(/\$capture\.(\w+)/g, (_match, name) => {
    return sharedVars[name] ?? `$capture.${name}`;
  });

  // $node.name / $node.ip
  result = result.replace(/\$node\.name/g, nodeMeta.name);
  result = result.replace(/\$node\.ip/g, nodeMeta.ip);

  return result;
}

export function validateExecutionVars(
  template: BusinessTemplate,
  varValues: BusinessExecution['varValues'],
  nodeIds: string[]
): string | null {
  for (const v of template.variables) {
    if (!v.required) continue;
    if (v.scope === 'global') {
      if (!varValues.global[v.name]) return `全局变量 "${v.label}" 必填`;
    } else {
      for (const nid of nodeIds) {
        if (!varValues.perNode[nid]?.[v.name]) {
          return `节点 ${nid} 的变量 "${v.label}" 必填`;
        }
      }
    }
  }
  return null;
}

export function makeExecution(
  template: BusinessTemplate,
  nodeIds: string[],
  varValues: BusinessExecution['varValues']
): BusinessExecution {
  return {
    id: generateId(),
    templateId: template.id,
    templateName: template.name,
    nodeIds,
    varValues,
    status: 'pending',
    sharedVars: {},
    stepResults: Object.fromEntries(nodeIds.map((nid) => [nid, []])),
    startedAt: Date.now(),
  };
}
