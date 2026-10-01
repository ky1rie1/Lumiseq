import type { ParameterDefinition } from './parameterDefinitions';

/** A hovered slider must not steal navigation from focused UI controls. */
export function shouldNudgeHoveredParameter(
  event: Pick<KeyboardEvent,'key'|'defaultPrevented'|'ctrlKey'|'metaKey'|'altKey'|'isComposing'>,
  focusedTag: string|null, ownRange = false, editable = false,
): boolean {
  return !event.defaultPrevented && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey
    && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)
    && (ownRange || (!editable && !['input','textarea','select','button','a','summary'].includes(focusedTag?.toLowerCase() ?? '')));
}

export function nudgeParameter(value: number, param: ParameterDefinition, key: string, fine = false): number {
  const direction = key === 'ArrowRight' || key === 'ArrowUp' ? 1
    : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
  if (!direction) return value;
  const step = fine ? param.fineStep : param.step;
  return Number(Math.min(param.max, Math.max(param.min, value + direction * step)).toFixed(4));
}
