export const SHELL_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidShellVarName(name?: string | null): name is string {
  const trimmed = String(name ?? '').trim();
  return Boolean(trimmed) && SHELL_VAR_NAME_PATTERN.test(trimmed);
}

export function escapeShellSingleQuotedValue(value: string): string {
  return String(value).split("'").join(`'"'"'`);
}

export function buildShellVarsSyncScript(
  previousVars: Record<string, string> = {},
  nextVars: Record<string, string> = {}
): string {
  const previousEntries = Object.entries(previousVars).filter(([key]) => isValidShellVarName(key));
  const nextEntries = Object.entries(nextVars).filter(([key]) => isValidShellVarName(key));
  const nextMap = new Map(nextEntries);
  const commands: string[] = [];

  previousEntries.forEach(([key]) => {
    if (!nextMap.has(key)) {
      commands.push(`unset ${key}`);
    }
  });

  nextEntries.forEach(([key, value]) => {
    if (previousVars[key] === value) return;
    commands.push(`export ${key}='${escapeShellSingleQuotedValue(value)}'`);
  });

  return commands.join('\n').trim();
}
