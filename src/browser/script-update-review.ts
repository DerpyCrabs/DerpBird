import type { UserScriptMetadata } from './user-scripts';

/** Describe both API and URL scope changes before saving any downloaded code. */
export function describeScriptUpdate(before: UserScriptMetadata, after: UserScriptMetadata): string {
  const changes: string[] = [];
  for (const [label, oldValues, newValues] of [
    ['@grant', before.grants, after.grants],
    ['@match', before.matches, after.matches],
    ['@include', before.includes, after.includes],
    ['@connect', before.connects, after.connects],
    ['@require', before.requires, after.requires],
    ['@resource', before.resources.map(r => `${r.name}: ${r.url}`), after.resources.map(r => `${r.name}: ${r.url}`)],
  ] as const) {
    const added = newValues.filter(value => !oldValues.includes(value));
    if (added.length) changes.push(`${label}: ${added.join(', ')}`);
  }
  const removedExclusions = [...before.excludes.filter(value => !after.excludes.includes(value)), ...before.excludeMatches.filter(value => !after.excludeMatches.includes(value))];
  if (removedExclusions.length) changes.push(`Removed exclusions: ${removedExclusions.join(', ')}`);
  if (before.noFrames && !after.noFrames) changes.push('Frame execution enabled');
  if (before.grantNone !== after.grantNone) changes.push(after.grantNone ? 'Changed to @grant none' : 'Script permissions enabled; @sandbox determines the execution world');
  if (before.runAt !== after.runAt) changes.push(`@run-at: ${before.runAt} → ${after.runAt}`);
  const sandbox = (metadata: UserScriptMetadata) => metadata.entries.find(entry => entry.key === 'sandbox')?.value || 'default';
  if (sandbox(before) !== sandbox(after)) changes.push(`@sandbox: ${sandbox(before)} → ${sandbox(after)}`);
  const requestRules = (metadata: UserScriptMetadata) => metadata.entries.filter(entry => entry.key === 'webRequest').map(entry => entry.value);
  if (JSON.stringify(requestRules(before)) !== JSON.stringify(requestRules(after))) changes.push('Changed @webRequest interception rules');
  const contexts = (metadata: UserScriptMetadata) => metadata.entries.filter(entry => entry.key === 'run-in').map(entry => entry.value).sort();
  const oldContexts = contexts(before), newContexts = contexts(after);
  if (JSON.stringify(oldContexts) !== JSON.stringify(newContexts)) changes.push(`@run-in: ${oldContexts.join(', ') || 'all tabs'} → ${newContexts.join(', ') || 'all tabs'}`);
  return `Version ${before.version || '—'} → ${after.version || '—'}. ${changes.length ? 'Permission changes: ' + changes.join('; ') : 'No new permissions or match scopes.'} Review the source before saving.`;
}
