import { toZoned } from '@nora/core';
import { deviceTimezone } from '../services/api.ts';
import { getState } from '../state/store.ts';

export const userTz = () => getState().profile?.timezone ?? deviceTimezone();
export const todayLocal = () => toZoned(new Date(), userTz()).date;
export const nowLocal = () => toZoned(new Date(), userTz());
