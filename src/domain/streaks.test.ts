import { describe, expect, it } from 'vitest';
import {
  calculateStreaks,
  formatCalendarDayInTimezone,
  shiftDayString,
  type QualifyingSubmission,
} from './streaks';

describe('Codeforces streak tracking and timezone calculations', () => {
  const baseNow = Date.UTC(2026, 9, 28, 12, 0, 0); // 2026-10-28 12:00 UTC

  it('calculates active consecutive streaks', () => {
    const submissions: QualifyingSubmission[] = [
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 26, 10, 0, 0), verdict: 'OK' },
      { submissionId: 102, submittedAt: Date.UTC(2026, 9, 27, 10, 0, 0), verdict: 'OK' },
      { submissionId: 103, submittedAt: Date.UTC(2026, 9, 28, 9, 0, 0), verdict: 'OK' },
    ];

    const result = calculateStreaks(submissions, 'UTC', baseNow);
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
    expect(result.totalActiveDays).toBe(3);
    expect(result.activeToday).toBe(true);
    expect(result.activeYesterday).toBe(true);
  });

  it('keeps streak alive if submitted yesterday but not yet today', () => {
    const submissions: QualifyingSubmission[] = [
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 26, 10, 0, 0), verdict: 'OK' },
      { submissionId: 102, submittedAt: Date.UTC(2026, 9, 27, 10, 0, 0), verdict: 'OK' },
      // None today (2026-10-28)
    ];

    const result = calculateStreaks(submissions, 'UTC', baseNow);
    // Solved yesterday, so today's streak is still 2 (user has until end of today to submit)
    expect(result.currentStreak).toBe(2);
    expect(result.longestStreak).toBe(2);
    expect(result.activeToday).toBe(false);
    expect(result.activeYesterday).toBe(true);
  });

  it('reports current streak as 0 when last activity was before yesterday', () => {
    const submissions: QualifyingSubmission[] = [
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 25, 10, 0, 0), verdict: 'OK' },
      { submissionId: 102, submittedAt: Date.UTC(2026, 9, 26, 10, 0, 0), verdict: 'OK' },
      // No activity on 2026-10-27 (yesterday) or 2026-10-28 (today)
    ];

    const result = calculateStreaks(submissions, 'UTC', baseNow);
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(2);
    expect(result.activeToday).toBe(false);
    expect(result.activeYesterday).toBe(false);
  });

  it('handles broken streaks properly', () => {
    const submissions: QualifyingSubmission[] = [
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 20, 10, 0, 0), verdict: 'OK' },
      { submissionId: 102, submittedAt: Date.UTC(2026, 9, 21, 10, 0, 0), verdict: 'OK' },
      // Gap between 21 and 28
      { submissionId: 103, submittedAt: Date.UTC(2026, 9, 28, 9, 0, 0), verdict: 'OK' },
    ];

    const result = calculateStreaks(submissions, 'UTC', baseNow);
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(2);
    expect(result.totalActiveDays).toBe(3);
    expect(result.activeToday).toBe(true);
  });

  it('counts multiple accepted submissions on one day as a single active day', () => {
    const submissions: QualifyingSubmission[] = [
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 28, 8, 0, 0), verdict: 'OK', problemName: 'A' },
      { submissionId: 102, submittedAt: Date.UTC(2026, 9, 28, 9, 0, 0), verdict: 'OK', problemName: 'B' },
      { submissionId: 103, submittedAt: Date.UTC(2026, 9, 28, 10, 0, 0), verdict: 'OK', problemName: 'C' },
    ];

    const result = calculateStreaks(submissions, 'UTC', baseNow);
    expect(result.currentStreak).toBe(1);
    expect(result.totalActiveDays).toBe(1);
    expect(result.activityByDate['2026-10-28'].count).toBe(3);
    expect(result.activityByDate['2026-10-28'].problemNames).toEqual(['A', 'B', 'C']);
  });

  it('deduplicates duplicate submission IDs and distinguishes solving vs all-activity definitions', () => {
    const submissions: QualifyingSubmission[] = [
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 28, 8, 0, 0), verdict: 'OK' },
      { submissionId: 101, submittedAt: Date.UTC(2026, 9, 28, 8, 0, 0), verdict: 'OK' }, // Duplicate
      { submissionId: 102, submittedAt: Date.UTC(2026, 9, 27, 9, 0, 0), verdict: 'WRONG_ANSWER' }, // Non-OK
    ];

    // In 'accepted' mode (solving streak), non-OK submission is ignored
    const solvingResult = calculateStreaks(submissions, { timeZone: 'UTC', nowMs: baseNow, activityDefinition: 'accepted' });
    expect(solvingResult.currentStreak).toBe(1); // Only today's OK
    expect(solvingResult.activityByDate['2026-10-28'].count).toBe(1);
    expect(solvingResult.activityByDate['2026-10-27']).toBeUndefined();

    // In 'all' mode (Codeforces profile parity), WRONG_ANSWER counts as daily activity
    const profileResult = calculateStreaks(submissions, { timeZone: 'UTC', nowMs: baseNow, activityDefinition: 'all' });
    expect(profileResult.currentStreak).toBe(2); // Yesterday WA + Today OK
    expect(profileResult.activityByDate['2026-10-27'].count).toBe(1);
    expect(profileResult.activityByDate['2026-10-28'].count).toBe(1);
  });

  it('calculates all-time (42d), last year (28d), and last month (7d) streaks accurately', () => {
    const todayStr = '2026-10-28';
    const submissions: QualifyingSubmission[] = [];
    let subId = 1;

    // 1. All-time streak of 42 days occurred 500 days ago (outside 365d window)
    for (let i = 0; i < 42; i++) {
      const dateStr = shiftDayString(todayStr, -500 + i);
      const [y, m, d] = dateStr.split('-').map(Number);
      submissions.push({
        submissionId: subId++,
        submittedAt: Date.UTC(y, m - 1, d, 12, 0, 0),
        verdict: 'OK',
      });
    }

    // 2. Best streak in the last year of 28 days occurred 100 days ago
    for (let i = 0; i < 28; i++) {
      const dateStr = shiftDayString(todayStr, -100 + i);
      const [y, m, d] = dateStr.split('-').map(Number);
      submissions.push({
        submissionId: subId++,
        submittedAt: Date.UTC(y, m - 1, d, 12, 0, 0),
        verdict: 'OK',
      });
    }

    // 3. Current ongoing streak of 7 days in the last month ending today
    for (let i = 0; i < 7; i++) {
      const dateStr = shiftDayString(todayStr, -6 + i);
      const [y, m, d] = dateStr.split('-').map(Number);
      submissions.push({
        submissionId: subId++,
        submittedAt: Date.UTC(y, m - 1, d, 12, 0, 0),
        verdict: 'OK',
      });
    }

    const result = calculateStreaks(submissions, { timeZone: 'UTC', nowMs: baseNow });
    expect(result.longestStreak).toBe(42);
    expect(result.longestStreakLast365).toBe(28);
    expect(result.longestStreakLast30).toBe(7);
    expect(result.currentStreak).toBe(7);
    expect(result.activeToday).toBe(true);
  });

  it('accurately handles UTC and local date boundary timezone transitions', () => {
    // 2026-10-27 at 23:30 UTC is:
    // - 2026-10-27 in UTC
    // - 2026-10-28 at 05:00 in Asia/Kolkata (UTC+5:30)
    const ts = Date.UTC(2026, 9, 27, 23, 30, 0);

    expect(formatCalendarDayInTimezone(ts, 'UTC')).toBe('2026-10-27');
    expect(formatCalendarDayInTimezone(ts, 'Asia/Kolkata')).toBe('2026-10-28');
    expect(formatCalendarDayInTimezone(ts, 'America/New_York')).toBe('2026-10-27');

    const submissions: QualifyingSubmission[] = [
      { submissionId: 201, submittedAt: ts, verdict: 'OK' },
    ];

    // In Asia/Kolkata at baseNow (2026-10-28 17:30 IST), submission is on 2026-10-28
    const kolkataResult = calculateStreaks(submissions, 'Asia/Kolkata', baseNow);
    expect(kolkataResult.activityByDate['2026-10-28']).toBeDefined();
    expect(kolkataResult.activityByDate['2026-10-27']).toBeUndefined();
    expect(kolkataResult.currentStreak).toBe(1);
    expect(kolkataResult.activeToday).toBe(true);

    // In UTC at baseNow (2026-10-28 12:00 UTC), submission was yesterday (2026-10-27)
    const utcResult = calculateStreaks(submissions, 'UTC', baseNow);
    expect(utcResult.activityByDate['2026-10-27']).toBeDefined();
    expect(utcResult.activityByDate['2026-10-28']).toBeUndefined();
    expect(utcResult.currentStreak).toBe(1); // Still alive from yesterday
    expect(utcResult.activeToday).toBe(false);
    expect(utcResult.activeYesterday).toBe(true);
  });

  it('counts contest-queued submissions as qualifying Codeforces activity', () => {
    // A submission solved during a contest, queued locally for upload
    const contestSubmission: QualifyingSubmission = {
      submissionId: 301,
      submittedAt: Date.UTC(2026, 9, 28, 10, 0, 0),
      verdict: 'OK',
      problemName: 'A_ContestProblem',
    };

    const result = calculateStreaks([contestSubmission], 'UTC', baseNow);
    expect(result.currentStreak).toBe(1);
    expect(result.totalActiveDays).toBe(1);
  });

  it('handles empty or incomplete historical data flags gracefully', () => {
    const emptyResult = calculateStreaks([], {
      timeZone: 'UTC',
      nowMs: baseNow,
      isHistoryComplete: false,
      isCalculating: true,
    });
    expect(emptyResult.currentStreak).toBe(0);
    expect(emptyResult.longestStreak).toBe(0);
    expect(emptyResult.longestStreakLast365).toBe(0);
    expect(emptyResult.longestStreakLast30).toBe(0);
    expect(emptyResult.totalActiveDays).toBe(0);
    expect(emptyResult.activeDaysLast365).toBe(0);
    expect(emptyResult.heatmapDays.length).toBe(365);
    expect(emptyResult.isHistoryComplete).toBe(false);
    expect(emptyResult.isCalculating).toBe(true);
  });
});
