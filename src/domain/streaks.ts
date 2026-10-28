export interface QualifyingSubmission {
  submissionId: number;
  submittedAt: number; // Unix timestamp in ms
  verdict?: string;
  problemName?: string;
}

export interface DayActivity {
  date: string; // YYYY-MM-DD
  count: number;
  problemNames: string[];
}

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  longestStreakLast365: number;
  longestStreakLast30: number;
  totalActiveDays: number;
  activeDaysLast365: number;
  last365DaysCount: number;
  timeZone: string;
  activeToday: boolean;
  activeYesterday: boolean;
  activityDefinition: 'accepted' | 'all';
  isHistoryComplete: boolean;
  isCalculating: boolean;
  activityByDate: Record<string, DayActivity>;
  heatmapDays: Array<{ date: string; count: number; active: boolean; intensity: number; level: number }>;
}

export type StreakSummary = StreakResult;

export interface StreakOptions {
  timeZone?: string;
  nowMs?: number;
  activityDefinition?: 'accepted' | 'all';
  isHistoryComplete?: boolean;
  isCalculating?: boolean;
}

/** Format a timestamp into YYYY-MM-DD in the specified timezone using standard Intl APIs. */
export function formatCalendarDayInTimezone(timestampMs: number, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date(timestampMs));
  } catch {
    // If timezone is invalid or unsupported, fallback safely to UTC
    return new Date(timestampMs).toISOString().slice(0, 10);
  }
}

/** Get reference today and yesterday dates in the target timezone. */
export function getRelativeDaysInTimezone(nowMs: number, timeZone: string): { today: string; yesterday: string } {
  const today = formatCalendarDayInTimezone(nowMs, timeZone);
  const yesterday = formatCalendarDayInTimezone(nowMs - 24 * 60 * 60 * 1000, timeZone);
  return { today, yesterday };
}

/** Advance a YYYY-MM-DD date string by a number of days in calendar order. */
export function shiftDayString(dateStr: string, daysOffset: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + daysOffset));
  return date.toISOString().slice(0, 10);
}

/** Calculate the difference in calendar days between two YYYY-MM-DD strings (dateB - dateA). */
export function diffDays(dateA: string, dateB: string): number {
  const [yA, mA, dA] = dateA.split('-').map(Number);
  const [yB, mB, dB] = dateB.split('-').map(Number);
  const utcA = Date.UTC(yA, mA - 1, dA);
  const utcB = Date.UTC(yB, mB - 1, dB);
  return Math.round((utcB - utcA) / (24 * 60 * 60 * 1000));
}

/** Group sorted active days into contiguous daily chains. */
export function getContiguousDayChains(sortedDays: string[]): Array<{ start: string; end: string; length: number }> {
  if (sortedDays.length === 0) return [];
  const chains: Array<{ start: string; end: string; length: number }> = [];
  let currentStart = sortedDays[0];
  let currentEnd = sortedDays[0];
  let currentLength = 1;

  for (let i = 1; i < sortedDays.length; i++) {
    const day = sortedDays[i];
    if (diffDays(currentEnd, day) === 1) {
      currentEnd = day;
      currentLength += 1;
    } else {
      chains.push({ start: currentStart, end: currentEnd, length: currentLength });
      currentStart = day;
      currentEnd = day;
      currentLength = 1;
    }
  }
  chains.push({ start: currentStart, end: currentEnd, length: currentLength });
  return chains;
}

/** Calculate the longest streak that intersects or falls within a specific date window [startDay, endDay]. */
export function calculateLongestStreakInWindow(
  sortedDays: string[],
  startDay: string,
  endDay: string
): number {
  const chains = getContiguousDayChains(sortedDays);
  let maxOverlap = 0;
  for (const chain of chains) {
    const overlapStart = chain.start > startDay ? chain.start : startDay;
    const overlapEnd = chain.end < endDay ? chain.end : endDay;
    if (overlapStart <= overlapEnd) {
      const overlapDays = diffDays(overlapStart, overlapEnd) + 1;
      if (overlapDays > maxOverlap) maxOverlap = overlapDays;
    }
  }
  return maxOverlap;
}

/** Compute Codeforces activity streak metrics given a collection of submissions. */
export function calculateStreaks(
  submissions: QualifyingSubmission[],
  optionsOrTimezone?: string | StreakOptions,
  legacyNowMs?: number
): StreakResult {
  const options: StreakOptions = typeof optionsOrTimezone === 'string'
    ? { timeZone: optionsOrTimezone, nowMs: legacyNowMs }
    : (optionsOrTimezone || {});

  const timeZone = options.timeZone || getDefaultTimezone();
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : (legacyNowMs || Date.now());
  const activityDefinition = options.activityDefinition || 'accepted';
  const isHistoryComplete = options.isHistoryComplete ?? true;
  const isCalculating = options.isCalculating ?? false;

  const activityByDate: Record<string, DayActivity> = {};
  const seenSubmissionIds = new Set<number>();

  // Filter, deduplicate, and group by calendar day in the target timezone
  for (const sub of submissions) {
    if (!sub || typeof sub.submittedAt !== 'number' || isNaN(sub.submittedAt)) continue;
    // In 'accepted' mode (solving streak), count only Accepted / OK verdicts
    if (activityDefinition === 'accepted' && sub.verdict && sub.verdict !== 'OK') continue;
    if (seenSubmissionIds.has(sub.submissionId)) continue;
    seenSubmissionIds.add(sub.submissionId);

    const dateKey = formatCalendarDayInTimezone(sub.submittedAt, timeZone);
    if (!activityByDate[dateKey]) {
      activityByDate[dateKey] = { date: dateKey, count: 0, problemNames: [] };
    }
    activityByDate[dateKey].count += 1;
    if (sub.problemName && !activityByDate[dateKey].problemNames.includes(sub.problemName)) {
      activityByDate[dateKey].problemNames.push(sub.problemName);
    }
  }

  const sortedDays = Object.keys(activityByDate).sort((a, b) => a.localeCompare(b));
  const totalActiveDays = sortedDays.length;

  // Calculate contiguous chains
  const chains = getContiguousDayChains(sortedDays);
  const longestStreak = chains.reduce((max, c) => Math.max(max, c.length), 0);

  // Calculate reference days
  const { today, yesterday } = getRelativeDaysInTimezone(nowMs, timeZone);
  const activeToday = Boolean(activityByDate[today]);
  const activeYesterday = Boolean(activityByDate[yesterday]);

  // Calculate current streak
  let currentStreak = 0;
  if (activeToday) {
    // Solved today: count today and walk backward
    currentStreak = 1;
    let checkDay = yesterday;
    while (activityByDate[checkDay]) {
      currentStreak += 1;
      checkDay = shiftDayString(checkDay, -1);
    }
  } else if (activeYesterday) {
    // Solved yesterday: streak is still active today (user has until end of today to submit)
    currentStreak = 1;
    let checkDay = shiftDayString(yesterday, -1);
    while (activityByDate[checkDay]) {
      currentStreak += 1;
      checkDay = shiftDayString(checkDay, -1);
    }
  }

  // Calculate window streaks: Last 365 Days and Last 30 Days
  const start365 = shiftDayString(today, -364);
  const start30 = shiftDayString(today, -29);
  const longestStreakLast365 = calculateLongestStreakInWindow(sortedDays, start365, today);
  const longestStreakLast30 = calculateLongestStreakInWindow(sortedDays, start30, today);

  // Calculate 365-day activity heatmap ending today
  const heatmapDays: StreakResult['heatmapDays'] = [];
  let activeDaysLast365 = 0;
  let last365DaysCount = 0;

  for (let i = 364; i >= 0; i--) {
    const dayKey = shiftDayString(today, -i);
    const dayData = activityByDate[dayKey];
    const count = dayData ? dayData.count : 0;
    const active = count > 0;
    if (active) {
      activeDaysLast365 += 1;
      last365DaysCount += count;
    }

    // Intensity levels from 0 to 4 for heatmap coloring
    const intensity = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
    heatmapDays.push({ date: dayKey, count, active, intensity, level: intensity });
  }

  return {
    currentStreak,
    longestStreak,
    longestStreakLast365,
    longestStreakLast30,
    totalActiveDays,
    activeDaysLast365,
    last365DaysCount,
    timeZone,
    activeToday,
    activeYesterday,
    activityDefinition,
    isHistoryComplete,
    isCalculating,
    activityByDate,
    heatmapDays,
  };
}

export function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const getBrowserTimezone = getDefaultTimezone;
