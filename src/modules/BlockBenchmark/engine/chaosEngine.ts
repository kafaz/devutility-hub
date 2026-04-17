import { generateId } from '../../../utils';
import type { ChaosFault, ChaosInjection } from '../types';

export function replaceFaultVars(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => params[name] ?? `{{${name}}}`);
}

export function buildInjection(
  fault: ChaosFault,
  nodeIds: string[],
  paramValues: Record<string, string>,
  durationSec: number
): ChaosInjection {
  return {
    id: generateId(),
    faultId: fault.id,
    faultName: fault.name,
    nodeIds,
    paramValues,
    durationSec,
    status: 'pending',
    log: '',
  };
}

export function buildRecoveryCommand(
  fault: ChaosFault,
  paramValues: Record<string, string>
): string | null {
  if (!fault.recoveryCmdTemplate) return null;
  return replaceFaultVars(fault.recoveryCmdTemplate, paramValues);
}

export function buildDelayedRecoveryScript(
  fault: ChaosFault,
  paramValues: Record<string, string>,
  durationSec: number,
  injectionId: string
): string | null {
  const recovery = buildRecoveryCommand(fault, paramValues);
  if (!recovery) return null;
  return `nohup bash -c 'sleep ${durationSec} && ${recovery}' > /tmp/chaos_recovery_${injectionId}.log 2>&1 &`;
}
