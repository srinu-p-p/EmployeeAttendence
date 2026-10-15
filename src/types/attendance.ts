export type Status = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'WFH' | 'ON_DUTY';
export type PresenceStatus = 'PRESENT' | 'WFH' | 'ON_DUTY';

export interface Employee {
  emp_code: string;
  name: string;
  email: string;
  department: string;
  shift_start: string; // HH:MM IST
  shift_end: string;   // HH:MM IST
  joined_on: string;   // YYYY-MM-DD
  created_at: number;  // Epoch ms
}

export interface HistoryChange {
  from: any;
  to: any;
}

export interface HistoryEntry {
  at: number; // Epoch ms
  by: string;
  reason: string;
  changes: Record<string, HistoryChange>;
}

export interface AttendanceRecord {
  emp_code: string;
  date: string; // YYYY-MM-DD IST
  status: Status;
  punch_in: number | null;  // Epoch ms
  punch_out: number | null; // Epoch ms
  work_hours: number | null;
  late_minutes: number;
  overtime_minutes: number;
  half_day: boolean;
  history: HistoryEntry[];
}

export interface EmployeeMonthly {
  emp_code: string;
  month: string;
  working_days: number;
  present_days: number;
  leave_days: number;
  late_count: number;
  total_late_minutes: number;
  total_overtime_minutes: number;
  attendance_pct: number | null;
}

export interface DepartmentSummaryItem {
  department: string;
  headcount: number;
  present_days: number;
  avg_work_hours: number | null;
  late_count: number;
  total_late_minutes: number;
  leave_count: number;
  on_duty_count: number;
}

export interface LeaderboardItem {
  rank: number;
  emp_code: string;
  name: string;
  department: string;
  total_late_minutes: number;
  late_count: number;
}

export interface TrendItem {
  date: string;
  is_working_day: boolean;
  headcount: number;
  present_count: number;
  late_count: number;
  attendance_rate: number | null;
  moving_avg_7d: number | null;
}
