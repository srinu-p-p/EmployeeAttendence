import {
  Employee,
  AttendanceRecord,
  EmployeeMonthly,
  DepartmentSummaryItem,
  LeaderboardItem,
  TrendItem,
} from '../types/attendance';
import {
  roundHalfUp,
  isWorkingDay,
} from './attendanceEngine';

export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function calculateEmployeeMonthly(
  empCode: string,
  monthStr: string, // YYYY-MM
  employees: Employee[],
  logs: AttendanceRecord[]
): EmployeeMonthly | null {
  const emp = employees.find((e) => e.emp_code === empCode);
  if (!emp) return null;

  const [year, month] = monthStr.split('-').map(Number);
  const totalDays = getDaysInMonth(year, month);
  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${String(totalDays).padStart(2, '0')}`;

  const effStartDate = emp.joined_on > startDateStr ? emp.joined_on : startDateStr;

  // Count working days
  let workingDays = 0;
  const [sy, sm, sd] = effStartDate.split('-').map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(year, month - 1, totalDays));

  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day >= 1 && day <= 5) {
      workingDays++;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Filter logs
  const monthLogs = logs.filter(
    (l) => l.emp_code === empCode && l.date >= startDateStr && l.date <= endDateStr
  );

  let leaveDays = 0;
  let lateCount = 0;
  let totalLateMinutes = 0;
  let totalOvertimeMinutes = 0;
  let presentDays = 0;

  for (const log of monthLogs) {
    if (log.status === 'LEAVE') {
      leaveDays++;
    }
    if (log.late_minutes > 0) {
      lateCount++;
    }
    totalLateMinutes += log.late_minutes || 0;
    totalOvertimeMinutes += log.overtime_minutes || 0;

    const isMonFri = isWorkingDay(log.date);
    if (['PRESENT', 'WFH', 'ON_DUTY'].includes(log.status) && isMonFri) {
      presentDays += log.half_day ? 0.5 : 1.0;
    }
  }

  let attendancePct: number | null = null;
  if (workingDays > 0) {
    attendancePct = roundHalfUp((presentDays / workingDays) * 100, 2);
  }

  return {
    emp_code: empCode,
    month: monthStr,
    working_days: workingDays,
    present_days: roundHalfUp(presentDays, 2) || 0,
    leave_days: leaveDays,
    late_count: lateCount,
    total_late_minutes: totalLateMinutes,
    total_overtime_minutes: totalOvertimeMinutes,
    attendance_pct: attendancePct,
  };
}

export function calculateDepartmentSummary(
  monthStr: string,
  departmentFilter: string | undefined,
  employees: Employee[],
  logs: AttendanceRecord[]
): DepartmentSummaryItem[] {
  const [year, month] = monthStr.split('-').map(Number);
  const totalDays = getDaysInMonth(year, month);
  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${String(totalDays).padStart(2, '0')}`;

  // Unique departments
  const allDepts = Array.from(new Set(employees.map((e) => e.department))).sort();
  const targetDepts = departmentFilter ? [departmentFilter] : allDepts;

  const result: DepartmentSummaryItem[] = [];

  for (const dept of targetDepts) {
    // R9: Headcount includes employees who joined on or before last day of month
    const activeEmps = employees.filter(
      (e) => e.department === dept && e.joined_on <= endDateStr
    );
    const headcount = activeEmps.length;
    if (headcount === 0) continue;

    const empCodes = new Set(activeEmps.map((e) => e.emp_code));
    const deptLogs = logs.filter(
      (l) => empCodes.has(l.emp_code) && l.date >= startDateStr && l.date <= endDateStr
    );

    let presentDays = 0;
    let lateCount = 0;
    let totalLateMinutes = 0;
    let leaveCount = 0;
    let onDutyCount = 0;
    const workHoursList: number[] = [];

    for (const log of deptLogs) {
      const isMonFri = isWorkingDay(log.date);
      if (['PRESENT', 'WFH', 'ON_DUTY'].includes(log.status) && isMonFri) {
        presentDays += log.half_day ? 0.5 : 1.0;
      }

      if (log.late_minutes > 0) {
        lateCount++;
      }
      totalLateMinutes += log.late_minutes || 0;

      if (log.status === 'LEAVE') {
        leaveCount++;
      }
      if (log.status === 'ON_DUTY') {
        onDutyCount++;
      }

      if (['PRESENT', 'WFH', 'ON_DUTY'].includes(log.status) && log.work_hours !== null) {
        workHoursList.push(log.work_hours);
      }
    }

    let avgWorkHours: number | null = null;
    if (workHoursList.length > 0) {
      const sum = workHoursList.reduce((a, b) => a + b, 0);
      avgWorkHours = roundHalfUp(sum / workHoursList.length, 2);
    }

    result.push({
      department: dept,
      headcount,
      present_days: roundHalfUp(presentDays, 2) || 0,
      avg_work_hours: avgWorkHours,
      late_count: lateCount,
      total_late_minutes: totalLateMinutes,
      leave_count: leaveCount,
      on_duty_count: onDutyCount,
    });
  }

  return result.sort((a, b) => a.department.localeCompare(b.department));
}

export function calculateLateLeaderboard(
  monthStr: string,
  limit: number = 10,
  departmentFilter: string | undefined,
  employees: Employee[],
  logs: AttendanceRecord[]
): LeaderboardItem[] {
  const [year, month] = monthStr.split('-').map(Number);
  const totalDays = getDaysInMonth(year, month);
  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${String(totalDays).padStart(2, '0')}`;

  const empMap = new Map(employees.map((e) => [e.emp_code, e]));

  // Aggregate late minutes by employee
  const aggregates = new Map<string, { totalLate: number; lateCount: number }>();

  for (const log of logs) {
    if (log.date < startDateStr || log.date > endDateStr) continue;
    const emp = empMap.get(log.emp_code);
    if (!emp) continue;
    if (departmentFilter && emp.department !== departmentFilter) continue;

    const curr = aggregates.get(log.emp_code) || { totalLate: 0, lateCount: 0 };
    if (log.late_minutes > 0) {
      curr.lateCount++;
      curr.totalLate += log.late_minutes;
    }
    aggregates.set(log.emp_code, curr);
  }

  // Filter only total_late_minutes > 0
  const rows: { emp_code: string; name: string; department: string; total_late_minutes: number; late_count: number }[] = [];
  for (const [empCode, data] of aggregates.entries()) {
    if (data.totalLate > 0) {
      const emp = empMap.get(empCode)!;
      rows.push({
        emp_code: empCode,
        name: emp.name,
        department: emp.department,
        total_late_minutes: data.totalLate,
        late_count: data.lateCount,
      });
    }
  }

  // Order of rows: total_late_minutes descending, then emp_code ascending
  rows.sort((a, b) => {
    if (b.total_late_minutes !== a.total_late_minutes) {
      return b.total_late_minutes - a.total_late_minutes;
    }
    return a.emp_code.localeCompare(b.emp_code);
  });

  // Standard competition ranking (1, 2, 2, 4)
  const rankedItems: LeaderboardItem[] = [];
  let prevMinutes: number | null = null;
  let prevRank = 1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let rank = 1;
    if (i === 0) {
      rank = 1;
    } else if (row.total_late_minutes === prevMinutes) {
      rank = prevRank;
    } else {
      rank = i + 1;
    }

    prevMinutes = row.total_late_minutes;
    prevRank = rank;

    // limit applies AFTER ranking: rank <= limit
    if (rank <= limit) {
      rankedItems.push({
        rank,
        emp_code: row.emp_code,
        name: row.name,
        department: row.department,
        total_late_minutes: row.total_late_minutes,
        late_count: row.late_count,
      });
    }
  }

  return rankedItems;
}

export function calculateDepartmentTrend(
  department: string,
  fromDateStr: string,
  toDateStr: string,
  employees: Employee[],
  logs: AttendanceRecord[]
): TrendItem[] | { error: string; code: number } {
  const deptEmps = employees.filter((e) => e.department === department);
  if (deptEmps.length === 0) {
    return { error: `Department '${department}' not found`, code: 404 };
  }

  const [sy, sm, sd] = fromDateStr.split('-').map(Number);
  const [ey, em, ed] = toDateStr.split('-').map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));

  if (cur > end) {
    return { error: "'to' must be greater than or equal to 'from'", code: 422 };
  }

  const daysDiff = Math.round((end.getTime() - cur.getTime()) / 86400000) + 1;
  if (daysDiff > 92) {
    return { error: 'Date range cannot exceed 92 days', code: 422 };
  }

  const deptCodes = new Set(deptEmps.map((e) => e.emp_code));
  const items: TrendItem[] = [];
  const ratesHistory: (number | null)[] = [];

  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayOfWeek = cur.getUTCDay();
    const isWorkDay = dayOfWeek >= 1 && dayOfWeek <= 5;

    // Headcount: department employees with joined_on <= dateStr
    const headcount = deptEmps.filter((e) => e.joined_on <= dateStr).length;

    // Logs for this date and department
    const dayLogs = logs.filter((l) => deptCodes.has(l.emp_code) && l.date === dateStr);

    let presentCount = 0;
    let lateCount = 0;

    for (const log of dayLogs) {
      if (['PRESENT', 'WFH', 'ON_DUTY'].includes(log.status)) {
        presentCount += log.half_day ? 0.5 : 1.0;
      }
      if (log.late_minutes > 0) {
        lateCount++;
      }
    }

    // attendance_rate: present_count / headcount, 4 decimals half-up, ONLY on working days with headcount > 0
    let attendanceRate: number | null = null;
    if (isWorkDay && headcount > 0) {
      attendanceRate = roundHalfUp(presentCount / headcount, 4);
    }

    ratesHistory.push(attendanceRate);

    // 7-day moving average among current and up to 6 preceding rows inside the requested range
    const window = ratesHistory.slice(-7).filter((r): r is number => r !== null);
    let movingAvg7d: number | null = null;
    if (window.length > 0) {
      const sum = window.reduce((a, b) => a + b, 0);
      movingAvg7d = roundHalfUp(sum / window.length, 4);
    }

    items.push({
      date: dateStr,
      is_working_day: isWorkDay,
      headcount,
      present_count: roundHalfUp(presentCount, 2) || 0,
      late_count: lateCount,
      attendance_rate: attendanceRate,
      moving_avg_7d: movingAvg7d,
    });

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return items;
}
