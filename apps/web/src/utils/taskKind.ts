import type { TaskKind } from '@nora/core';
import type { IconName } from '../components/Icon.tsx';

/** Icon + accent color per task category — used everywhere a task's kind is shown
 * as a colored badge (task list, calendar timeline, the "Adaugă task" chips). */
const KIND_ICON: Record<TaskKind, IconName> = {
  appointment: 'calendar',
  call: 'phone',
  payment: 'card',
  shopping: 'bag',
  travel: 'car',
  document: 'file',
  generic: 'spark',
};

const KIND_COLOR: Record<TaskKind, string> = {
  appointment: 'blue',
  call: 'cyan',
  payment: 'warning',
  shopping: 'pink',
  travel: 'success',
  document: 'purple',
  generic: 'neutral',
};

export function kindIcon(kind: TaskKind): IconName {
  return KIND_ICON[kind] ?? 'spark';
}

export function kindColorClass(kind: TaskKind): string {
  return `kind-${KIND_COLOR[kind] ?? 'neutral'}`;
}
