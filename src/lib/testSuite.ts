import {
  roundHalfUp,
  computeLateMinutes,
  computeOvertimeMinutes,
  computeWorkHours,
  isHalfDay,
  getAttendanceDate,
  istDateTimeToEpochMs,
  INITIAL_EMPLOYEES,
  INITIAL_LOGS,
} from './attendanceEngine';
import {
  calculateEmployeeMonthly,
  calculateDepartmentSummary,
  calculateLateLeaderboard,
  calculateDepartmentTrend,
} from './attendanceAnalytics';

export interface TestCaseResult {
  id: string;
  rule: string;
  title: string;
  description: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: string;
}

export function runComplianceTests(): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  // --- Test 1: R1 Overnight shift mapping ---
  // Shift 22:00 - 06:00. Punch-in on 2026-07-07 at 01:15 IST (which is < shift_end 06:00).
  // Must map to 2026-07-06!
  const overnightPunchMs = istDateTimeToEpochMs('2026-07-07', '01:15', 0);
  const r1Date = getAttendanceDate(overnightPunchMs, '22:00', '06:00');
  results.push({
    id: 'T1-R1',
    rule: 'R1',
    title: 'Overnight Shift Midnight Crossing',
    description: 'Punch-in at 01:15 IST for 22:00-06:00 shift must map to previous day (2026-07-06).',
    passed: r1Date === '2026-07-06',
    expected: '2026-07-06',
    actual: r1Date,
  });

  // --- Test 2: R2 Grace period boundary ---
  // Shift starts 09:30.
  // 09:40:00 -> 0 min late
  // 09:40:01 -> 10 min late
  // 10:15:59 -> 45 min late
  const startMs = istDateTimeToEpochMs('2026-07-06', '09:30', 0);
  const t2_exactGrace = istDateTimeToEpochMs('2026-07-06', '09:40', 0);
  const t2_oneSecLate = istDateTimeToEpochMs('2026-07-06', '09:40', 1);
  const t2_fortyFiveLate = istDateTimeToEpochMs('2026-07-06', '10:15', 59);

  const lateExact = computeLateMinutes(t2_exactGrace, startMs);
  const lateOneSec = computeLateMinutes(t2_oneSecLate, startMs);
  const late45 = computeLateMinutes(t2_fortyFiveLate, startMs);

  const r2Passed = lateExact === 0 && lateOneSec === 10 && late45 === 45;
  results.push({
    id: 'T2-R2',
    rule: 'R2',
    title: 'Late Minutes & 10:00 Grace Period',
    description: '09:40:00 -> 0m; 09:40:01 -> 10m (measured from shift start); 10:15:59 -> 45m.',
    passed: r2Passed,
    expected: '0 min, 10 min, 45 min',
    actual: `${lateExact} min, ${lateOneSec} min, ${late45} min`,
  });

  // --- Test 3: R3 Overtime boundary ---
  // Shift end: 18:30.
  // 18:59 (29 min OT) -> 0 OT
  // 19:00 (30 min OT) -> 30 OT
  // 19:40 (70 min OT) -> 70 OT
  const endMs = istDateTimeToEpochMs('2026-07-06', '18:30', 0);
  const t3_29min = istDateTimeToEpochMs('2026-07-06', '18:59', 0);
  const t3_30min = istDateTimeToEpochMs('2026-07-06', '19:00', 0);
  const t3_70min = istDateTimeToEpochMs('2026-07-06', '19:40', 0);

  const ot29 = computeOvertimeMinutes(t3_29min, endMs);
  const ot30 = computeOvertimeMinutes(t3_30min, endMs);
  const ot70 = computeOvertimeMinutes(t3_70min, endMs);

  const r3Passed = ot29 === 0 && ot30 === 30 && ot70 === 70;
  results.push({
    id: 'T3-R3',
    rule: 'R3',
    title: 'Overtime Threshold (>= 30 Minutes)',
    description: '29 min extra -> 0 overtime; 30 min -> 30 min; 70 min -> 70 min.',
    passed: r3Passed,
    expected: '0 min, 30 min, 70 min',
    actual: `${ot29} min, ${ot30} min, ${ot70} min`,
  });

  // --- Test 4: R4 Work hours arithmetic half-up rounding ---
  // Test value that banker's rounding fails: 14850 seconds = 4.125 hours
  // Banker's rounding rounds to even: 4.12. Half-up must round to 4.13!
  const pin4 = istDateTimeToEpochMs('2026-07-06', '09:00', 0);
  const pout4 = pin4 + 14850 * 1000;
  const wh4 = computeWorkHours(pin4, pout4);
  results.push({
    id: 'T4-R4',
    rule: 'R4',
    title: "Work Hours Decimal Half-Up Rounding",
    description: "14850 seconds (4.125h) must round to 4.13, not banker's 4.12.",
    passed: wh4 === 4.13,
    expected: '4.13',
    actual: String(wh4),
  });

  // --- Test 5: R5 Half-day threshold ---
  // Work hours < 4.50 -> half_day = true
  const hdTrue = isHalfDay(4.49);
  const hdFalse = isHalfDay(4.50);
  results.push({
    id: 'T5-R5',
    rule: 'R5',
    title: 'Half Day Cutoff (< 4.50 Hours)',
    description: '4.49 hours triggers half_day=true; 4.50 hours is full day (half_day=false).',
    passed: hdTrue === true && hdFalse === false,
    expected: '4.49h: true, 4.50h: false',
    actual: `4.49h: ${hdTrue}, 4.50h: ${hdFalse}`,
  });

  // --- Test 6: R7 Working days for mid-month hire ---
  // Employee Pooja Patel (EMP0003) joined on 2026-03-15.
  // March 2026 has 31 days. From March 15 to March 31, count Mon-Fri.
  // March 15 was Sunday. Working days from 16 to 31 = 12 working days.
  const monthly = calculateEmployeeMonthly('EMP0003', '2026-03', INITIAL_EMPLOYEES, []);
  const workingDays = monthly?.working_days;
  results.push({
    id: 'T6-R7',
    rule: 'R7',
    title: 'Mid-Month Hire Working Days Proration',
    description: 'EMP0003 joined on 2026-03-15. Working days in March 2026 starting from March 15 = 12 days.',
    passed: workingDays === 12,
    expected: '12 working days',
    actual: `${workingDays} working days`,
  });

  // --- Test 7: R9 Headcount for zero-log employees ---
  // Engineering has 4 employees (Asha, Vikram, Pooja, Dev).
  // Dev joined on 2026-06-01. In July 2026 (2026-07), Engineering headcount must be 4, even if zero logs.
  const deptSummary = calculateDepartmentSummary('2026-07', 'Engineering', INITIAL_EMPLOYEES, INITIAL_LOGS);
  const engHeadcount = deptSummary.find((d) => d.department === 'Engineering')?.headcount;
  results.push({
    id: 'T7-R9',
    rule: 'R9',
    title: 'Headcount Includes Staff With Zero Logs',
    description: 'Engineering department must show headcount=4 in July 2026 including zero-log members.',
    passed: engHeadcount === 4,
    expected: 'Headcount = 4',
    actual: `Headcount = ${engHeadcount}`,
  });

  // --- Test 8: Competition ranking with tie-breaking ---
  // Suppose two employees have identical 35 late minutes.
  // Ranks should be 1, 1, 3 (not 1, 2, 3 or 1, 1, 2).
  // And limit=1 should return BOTH tied candidates at rank 1!
  const tiedLogs = [
    {
      emp_code: 'EMP0001',
      date: '2026-07-06',
      status: 'PRESENT' as const,
      punch_in: 0,
      punch_out: 0,
      work_hours: 8,
      late_minutes: 40,
      overtime_minutes: 0,
      half_day: false,
      history: [],
    },
    {
      emp_code: 'EMP0002',
      date: '2026-07-06',
      status: 'PRESENT' as const,
      punch_in: 0,
      punch_out: 0,
      work_hours: 8,
      late_minutes: 40,
      overtime_minutes: 0,
      half_day: false,
      history: [],
    },
    {
      emp_code: 'EMP0003',
      date: '2026-07-06',
      status: 'PRESENT' as const,
      punch_in: 0,
      punch_out: 0,
      work_hours: 8,
      late_minutes: 20,
      overtime_minutes: 0,
      half_day: false,
      history: [],
    },
  ];
  const leaderboard = calculateLateLeaderboard('2026-07', 1, undefined, INITIAL_EMPLOYEES, tiedLogs);
  const ranks = leaderboard.map((l) => l.rank);
  // Both tied at rank 1, so with limit=1 both qualify (length 2, ranks [1, 1])
  const tiePassed = leaderboard.length === 2 && ranks[0] === 1 && ranks[1] === 1;
  results.push({
    id: 'T8-Ties',
    rule: 'Ranking',
    title: 'Competition Ranking with Cutoff Tie Handling',
    description: 'Two employees tied for 1st place with limit=1 must both be returned (ranks [1, 1]).',
    passed: tiePassed,
    expected: '2 items with ranks [1, 1]',
    actual: `${leaderboard.length} items with ranks [${ranks.join(', ')}]`,
  });

  // --- Test 9: R8 Rate rounding (4 decimals half-up) ---
  const rawRate = 1 / 3; // 0.333333333... -> 0.3333
  const roundedRate = roundHalfUp(rawRate, 4);
  const rawHalfUpRate = 0.12345; // -> 0.1235
  const roundedHalfUp = roundHalfUp(rawHalfUpRate, 4);
  const ratePassed = roundedRate === 0.3333 && roundedHalfUp === 0.1235;
  results.push({
    id: 'T9-R8',
    rule: 'R8',
    title: 'Attendance Rate 4-Decimal Rounding',
    description: '1/3 rounds to 0.3333; 0.12345 rounds to 0.1235 (half-up).',
    passed: ratePassed,
    expected: '0.3333 and 0.1235',
    actual: `${roundedRate} and ${roundedHalfUp}`,
  });

  // --- Test 10: 7-Day Moving Average in Trend ---
  // Trend for Operations across 3 days:
  const trend = calculateDepartmentTrend('Operations', '2026-07-06', '2026-07-08', INITIAL_EMPLOYEES, INITIAL_LOGS);
  const trendOk = !('error' in trend) && trend.length === 3;
  results.push({
    id: 'T10-Trend',
    rule: 'Trend',
    title: 'Calendar Densification & Trend Range',
    description: 'Requested range of 3 days yields exactly 3 densified daily entries.',
    passed: trendOk,
    expected: '3 daily entries',
    actual: !('error' in trend) ? `${trend.length} daily entries` : 'Error',
  });

  return results;
}
