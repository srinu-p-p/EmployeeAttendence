import {
  Employee,
  AttendanceRecord,
  EmployeeMonthly,
  DepartmentSummaryItem,
  LeaderboardItem,
  TrendItem,
  PresenceStatus,
  Status,
} from '../types/attendance';

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    emp_code: 'EMP0001',
    name: 'Asha Rao',
    email: 'asha@example.com',
    department: 'Engineering',
    shift_start: '09:30',
    shift_end: '18:30',
    joined_on: '2026-01-05',
    created_at: 1767587400000,
  },
  {
    emp_code: 'EMP0002',
    name: 'Vikram Seth',
    email: 'vikram@example.com',
    department: 'Engineering',
    shift_start: '09:30',
    shift_end: '18:30',
    joined_on: '2026-02-01',
    created_at: 1769910600000,
  },
  {
    emp_code: 'EMP0003',
    name: 'Pooja Patel',
    email: 'pooja@example.com',
    department: 'Engineering',
    shift_start: '09:30',
    shift_end: '18:30',
    joined_on: '2026-03-15',
    created_at: 1773549000000,
  },
  {
    emp_code: 'EMP0004',
    name: 'Rohan Mehra',
    email: 'rohan@example.com',
    department: 'Marketing',
    shift_start: '09:30',
    shift_end: '18:30',
    joined_on: '2026-04-01',
    created_at: 1775017800000,
  },
  {
    emp_code: 'EMP0005',
    name: 'Kavita Nair',
    email: 'kavita@example.com',
    department: 'Operations',
    shift_start: '22:00',
    shift_end: '06:00',
    joined_on: '2026-05-10',
    created_at: 1778428800000,
  },
  {
    emp_code: 'EMP0006',
    name: 'Dev Sharma',
    email: 'dev@example.com',
    department: 'Engineering',
    shift_start: '09:30',
    shift_end: '18:30',
    joined_on: '2026-06-01',
    created_at: 1780288200000,
  },
];

export const INITIAL_LOGS: AttendanceRecord[] = [
  {
    emp_code: 'EMP0001',
    date: '2026-07-06',
    status: 'PRESENT',
    punch_in: 1783310280000, // 09:28 IST
    punch_out: 1783343100000, // 18:35 IST
    work_hours: 9.12,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: false,
    history: [],
  },
  {
    emp_code: 'EMP0003',
    date: '2026-07-06',
    status: 'PRESENT',
    punch_in: 1783312500000, // 10:05 IST
    punch_out: 1783345200000, // 19:10 IST
    work_hours: 9.08,
    late_minutes: 35,
    overtime_minutes: 40,
    half_day: false,
    history: [],
  },
  {
    emp_code: 'EMP0006',
    date: '2026-07-07',
    status: 'PRESENT',
    punch_in: 1783397100000, // 09:35 IST
    punch_out: null,
    work_hours: null,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: false,
    history: [],
  },
  {
    emp_code: 'EMP0004',
    date: '2026-07-07',
    status: 'WFH',
    punch_in: 1783396800000, // 09:30 IST
    punch_out: 1783409400000, // 13:00 IST (3.5h)
    work_hours: 3.5,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: true,
    history: [],
  },
  {
    emp_code: 'EMP0004',
    date: '2026-07-08',
    status: 'ABSENT',
    punch_in: null,
    punch_out: null,
    work_hours: null,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: false,
    history: [],
  },
  {
    emp_code: 'EMP0003',
    date: '2026-07-08',
    status: 'LEAVE',
    punch_in: null,
    punch_out: null,
    work_hours: null,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: false,
    history: [],
  },
  {
    emp_code: 'EMP0005',
    date: '2026-07-06',
    status: 'PRESENT',
    punch_in: 1783355100000, // 21:55 IST
    punch_out: 1783386600000, // 06:40 IST next day
    work_hours: 8.75,
    late_minutes: 0,
    overtime_minutes: 40,
    half_day: false,
    history: [],
  },
  {
    emp_code: 'EMP0001',
    date: '2026-07-07',
    status: 'PRESENT',
    punch_in: 1783396680000, // 09:28 IST
    punch_out: 1783429200000, // 18:30 IST
    work_hours: 9.03,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: false,
    history: [
      {
        at: 1783486800000,
        by: 'hr.admin',
        reason: 'biometric glitch',
        changes: {
          punch_in: { from: 1783398900000, to: 1783396680000 },
          late_minutes: { from: 35, to: 0 },
          work_hours: { from: 8.42, to: 9.03 },
        },
      },
    ],
  },
  {
    emp_code: 'EMP0002',
    date: '2026-07-14',
    status: 'PRESENT',
    punch_in: 1784001720000, // 09:32 IST
    punch_out: 1784034060000, // 18:31 IST
    work_hours: 8.98,
    late_minutes: 0,
    overtime_minutes: 0,
    half_day: false,
    history: [],
  },
];

// --- Math & Date Helpers ---

// IST offset in ms: +5:30 = 5.5 * 3600 * 1000 = 19,800,000 ms
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export function roundHalfUp(val: number | null, decimals: number = 2): number | null {
  if (val === null || val === undefined || isNaN(val)) return null;
  const factor = Math.pow(10, decimals);
  // Arithmetic half-up rounding: Math.floor(v * factor + 0.5) / factor
  const sign = val < 0 ? -1 : 1;
  const absVal = Math.abs(val);
  const rounded = sign * (Math.floor(absVal * factor + 0.5 + Number.EPSILON) / factor);
  return Number(rounded.toFixed(decimals));
}

export function toIstDate(epochMs: number): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  dateStr: string;
  timeStr: string;
} {
  const istTime = new Date(epochMs + IST_OFFSET_MS);
  const year = istTime.getUTCFullYear();
  const month = istTime.getUTCMonth() + 1;
  const day = istTime.getUTCDate();
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const seconds = istTime.getUTCSeconds();

  const pad = (n: number) => n.toString().padStart(2, '0');
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hours)}:${pad(minutes)}`;
  return { year, month, day, hours, minutes, seconds, dateStr, timeStr };
}

export function istDateTimeToEpochMs(dateStr: string, timeStr: string, second: number = 0): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  const utcDate = Date.UTC(y, m - 1, d, h, min, second) - IST_OFFSET_MS;
  return utcDate;
}

export function getAttendanceDate(punchInMs: number, shiftStart: string, shiftEnd: string): string {
  const ist = toIstDate(punchInMs);
  const isOvernight = shiftEnd <= shiftStart;
  const punchTimeStr = `${String(ist.hours).padStart(2, '0')}:${String(ist.minutes).padStart(2, '0')}:${String(ist.seconds).padStart(2, '0')}`;
  const shiftEndStr = `${shiftEnd}:00`;

  if (isOvernight && punchTimeStr < shiftEndStr) {
    // Belong to previous day's shift
    const prevDate = new Date(punchInMs + IST_OFFSET_MS - 86400000);
    const y = prevDate.getUTCFullYear();
    const m = String(prevDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(prevDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return ist.dateStr;
}

export function getShiftWindow(dateStr: string, shiftStart: string, shiftEnd: string): { startMs: number; endMs: number } {
  const startMs = istDateTimeToEpochMs(dateStr, shiftStart, 0);
  const isOvernight = shiftEnd <= shiftStart;
  let endMs: number;
  if (isOvernight) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d) + 86400000);
    const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
    endMs = istDateTimeToEpochMs(nextDayStr, shiftEnd, 0);
  } else {
    endMs = istDateTimeToEpochMs(dateStr, shiftEnd, 0);
  }
  return { startMs, endMs };
}

export function computeLateMinutes(punchInMs: number, shiftStartMs: number): number {
  // Grace period 10 minutes (600s = 600,000ms). Late only if strictly > 600,000 ms after start
  const diffMs = punchInMs - shiftStartMs;
  if (diffMs > 600000) {
    return Math.floor(diffMs / 60000);
  }
  return 0;
}

export function computeOvertimeMinutes(punchOutMs: number, shiftEndMs: number): number {
  // Overtime >= 30 min (1800s = 1,800,000ms)
  const diffMs = punchOutMs - shiftEndMs;
  if (diffMs >= 1800000) {
    return Math.floor(diffMs / 60000);
  }
  return 0;
}

export function computeWorkHours(punchInMs: number, punchOutMs: number): number {
  const diffSeconds = Math.floor((punchOutMs - punchInMs) / 1000);
  const hours = diffSeconds / 3600;
  return roundHalfUp(hours, 2) || 0;
}

export function isHalfDay(workHours: number): boolean {
  return workHours < 4.5;
}

export function isWorkingDay(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  return day >= 1 && day <= 5;
}
