/** Correct the preserved JS default-null inference at the typed migration boundary. */
export function historyAsOf<T>(state: T, options: { d: string; start?: number; replaceId?: string | null; strict?: boolean }): T;
export function workoutsOn(state: unknown, day: string): unknown[];
export function backfillStart(day: string, time?: string): number;
export function backfillEnd(active: unknown): number;
export function sessionHistory<T>(state: T): T;
export function insertChronological(workouts: unknown[], workout: unknown): unknown[];
export function completeBackfill(workouts: unknown[], active: unknown, workout: unknown, now?: number): unknown[];
export function markAllSetsDone(entries: unknown[]): unknown[];
