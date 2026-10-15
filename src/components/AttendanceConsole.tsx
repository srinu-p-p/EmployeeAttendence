import React, { useState } from 'react';
import {
  Employee,
  AttendanceRecord,
  Status,
  PresenceStatus,
} from '../types/attendance';
import {
  getAttendanceDate,
  getShiftWindow,
  computeLateMinutes,
  computeOvertimeMinutes,
  computeWorkHours,
  isHalfDay,
  toIstDate,
  istDateTimeToEpochMs,
} from '../lib/attendanceEngine';
import {
  LogIn,
  LogOut,
  Edit3,
  Search,
  Filter,
  History,
  AlertCircle,
  CheckCircle,
  Calendar,
  Clock,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface Props {
  employees: Employee[];
  logs: AttendanceRecord[];
  onAddLog: (record: AttendanceRecord) => void;
  onUpdateLog: (record: AttendanceRecord) => void;
}

export const AttendanceConsole: React.FC<Props> = ({
  employees,
  logs,
  onAddLog,
  onUpdateLog,
}) => {
  // Filters & Pagination
  const [empFilter, setEmpFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Punch In State
  const [punchInEmp, setPunchInEmp] = useState('EMP0001');
  const [punchInStatus, setPunchInStatus] = useState<PresenceStatus>('PRESENT');
  const [punchInDate, setPunchInDate] = useState('2026-07-15');
  const [punchInTime, setPunchInTime] = useState('09:42');

  // Punch Out State
  const [punchOutEmp, setPunchOutEmp] = useState('EMP0006');
  const [punchOutDate, setPunchOutDate] = useState('2026-07-07');
  const [punchOutTime, setPunchOutTime] = useState('18:45');

  // Regularize Modal State
  const [regularizeLog, setRegularizeLog] = useState<AttendanceRecord | null>(null);
  const [regStatus, setRegStatus] = useState<Status>('PRESENT');
  const [regPunchInDate, setRegPunchInDate] = useState('');
  const [regPunchInTime, setRegPunchInTime] = useState('');
  const [regPunchOutDate, setRegPunchOutDate] = useState('');
  const [regPunchOutTime, setRegPunchOutTime] = useState('');
  const [regReason, setRegReason] = useState('Biometric scanner timeout during shift entry');
  const [regBy, setRegBy] = useState('hr.admin');
  const [regError, setRegError] = useState<string | null>(null);

  // History Inspector Modal State
  const [inspectHistoryLog, setInspectHistoryLog] = useState<AttendanceRecord | null>(null);

  // Message alert
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  // Handle Punch In
  const handlePunchIn = (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find((x) => x.emp_code === punchInEmp);
    if (!emp) {
      showMsg(`Employee ${punchInEmp} not found`, 'error');
      return;
    }

    const punchMs = istDateTimeToEpochMs(punchInDate, punchInTime, 0);
    const attDate = getAttendanceDate(punchMs, emp.shift_start, emp.shift_end);

    // Concurrency / Duplicate check on (emp_code, date)
    const exists = logs.some((l) => l.emp_code === punchInEmp && l.date === attDate);
    if (exists) {
      showMsg(
        `HTTP 409 Conflict: Attendance record already exists for ${punchInEmp} on ${attDate}`,
        'error'
      );
      return;
    }

    const { startMs } = getShiftWindow(attDate, emp.shift_start, emp.shift_end);
    const lateMinutes = computeLateMinutes(punchMs, startMs);

    const newRecord: AttendanceRecord = {
      emp_code: punchInEmp,
      date: attDate,
      status: punchInStatus,
      punch_in: punchMs,
      punch_out: null,
      work_hours: null,
      late_minutes: lateMinutes,
      overtime_minutes: 0,
      half_day: false,
      history: [],
    };

    onAddLog(newRecord);
    showMsg(
      `HTTP 201 Created: Punched in ${emp.name} (${punchInEmp}) for attendance day ${attDate}. Late: ${lateMinutes}m.`,
      'success'
    );
  };

  // Handle Punch Out
  const handlePunchOut = (e: React.FormEvent) => {
    e.preventDefault();
    const emp = employees.find((x) => x.emp_code === punchOutEmp);
    if (!emp) {
      showMsg(`Employee ${punchOutEmp} not found`, 'error');
      return;
    }

    const punchOutMs = istDateTimeToEpochMs(punchOutDate, punchOutTime, 0);

    // Find candidate punch-in (punch_in <= punchOutMs, most recent)
    const candidates = logs
      .filter((l) => l.emp_code === punchOutEmp && l.punch_in !== null && l.punch_in <= punchOutMs)
      .sort((a, b) => (b.punch_in || 0) - (a.punch_in || 0));

    if (candidates.length === 0) {
      showMsg(`HTTP 404 Not Found: No punch-in found for ${punchOutEmp} before punch-out`, 'error');
      return;
    }

    const candidate = candidates[0];
    if (candidate.punch_out !== null) {
      showMsg(`HTTP 409 Conflict: Record on ${candidate.date} is already punched out`, 'error');
      return;
    }

    const punchInMs = candidate.punch_in!;
    if (punchOutMs <= punchInMs) {
      showMsg(`HTTP 422 Unprocessable Entity: punch_out must be strictly after punch_in`, 'error');
      return;
    }

    const diffSec = Math.floor((punchOutMs - punchInMs) / 1000);
    if (diffSec > 86400) {
      showMsg(
        `HTTP 422 Unprocessable Entity: punch_out cannot be more than 24 hours after punch_in`,
        'error'
      );
      return;
    }

    const { endMs } = getShiftWindow(candidate.date, emp.shift_start, emp.shift_end);
    const overtimeMins = computeOvertimeMinutes(punchOutMs, endMs);
    const workHours = computeWorkHours(punchInMs, punchOutMs);
    const half = isHalfDay(workHours);

    const updated: AttendanceRecord = {
      ...candidate,
      punch_out: punchOutMs,
      work_hours: workHours,
      overtime_minutes: overtimeMins,
      half_day: half,
    };

    onUpdateLog(updated);
    showMsg(
      `HTTP 200 OK: Punched out ${emp.name} for ${candidate.date}. Work: ${workHours}h, Overtime: ${overtimeMins}m, Half-day: ${half}.`,
      'success'
    );
  };

  // Open Regularize Modal
  const openRegularize = (log: AttendanceRecord) => {
    setRegularizeLog(log);
    setRegStatus(log.status);
    setRegError(null);
    if (log.punch_in) {
      const ist = toIstDate(log.punch_in);
      setRegPunchInDate(ist.dateStr);
      setRegPunchInTime(ist.timeStr);
    } else {
      setRegPunchInDate('');
      setRegPunchInTime('');
    }

    if (log.punch_out) {
      const ist = toIstDate(log.punch_out);
      setRegPunchOutDate(ist.dateStr);
      setRegPunchOutTime(ist.timeStr);
    } else {
      setRegPunchOutDate('');
      setRegPunchOutTime('');
    }
  };

  // Save Regularization
  const handleSaveRegularize = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regularizeLog) return;
    setRegError(null);

    const emp = employees.find((x) => x.emp_code === regularizeLog.emp_code);
    if (!emp) {
      setRegError(`Employee ${regularizeLog.emp_code} not found`);
      return;
    }

    if (regReason.trim().length < 5) {
      setRegError('Reason must be at least 5 characters');
      return;
    }

    let targetPunchIn: number | null = null;
    let targetPunchOut: number | null = null;
    let targetWorkHours: number | null = null;
    let targetLateMins = 0;
    let targetOvertimeMins = 0;
    let targetHalfDay = false;

    if (['ABSENT', 'LEAVE'].includes(regStatus)) {
      if ((regPunchInDate && regPunchInTime) || (regPunchOutDate && regPunchOutTime)) {
        setRegError(`punch_in and punch_out cannot be supplied when status is ${regStatus}`);
        return;
      }
      targetPunchIn = null;
      targetPunchOut = null;
      targetWorkHours = null;
      targetLateMins = 0;
      targetOvertimeMins = 0;
      targetHalfDay = false;
    } else {
      // Presence status requires punch_in
      if (regPunchInDate && regPunchInTime) {
        targetPunchIn = istDateTimeToEpochMs(regPunchInDate, regPunchInTime, 0);
      } else {
        targetPunchIn = regularizeLog.punch_in;
      }

      if (!targetPunchIn) {
        setRegError('A presence status requires punch_in');
        return;
      }

      // punch_in must stay on the record's attendance date per R1
      const calcDate = getAttendanceDate(targetPunchIn, emp.shift_start, emp.shift_end);
      if (calcDate !== regularizeLog.date) {
        setRegError(
          `punch_in maps to attendance date '${calcDate}', but record date is '${regularizeLog.date}' (violates R1)`
        );
        return;
      }

      const { startMs, endMs } = getShiftWindow(regularizeLog.date, emp.shift_start, emp.shift_end);
      targetLateMins = computeLateMinutes(targetPunchIn, startMs);

      if (regPunchOutDate && regPunchOutTime) {
        targetPunchOut = istDateTimeToEpochMs(regPunchOutDate, regPunchOutTime, 0);
      } else {
        targetPunchOut = regularizeLog.punch_out;
      }

      if (targetPunchOut) {
        if (targetPunchOut <= targetPunchIn) {
          setRegError('punch_out must be strictly after punch_in');
          return;
        }
        if ((targetPunchOut - targetPunchIn) / 1000 > 86400) {
          setRegError('punch_out cannot be more than 24 hours after punch_in');
          return;
        }
        targetWorkHours = computeWorkHours(targetPunchIn, targetPunchOut);
        targetOvertimeMins = computeOvertimeMinutes(targetPunchOut, endMs);
        targetHalfDay = isHalfDay(targetWorkHours);
      } else {
        targetWorkHours = null;
        targetOvertimeMins = 0;
        targetHalfDay = false;
      }
    }

    // Build diffs
    const changes: Record<string, { from: any; to: any }> = {};

    if (regStatus !== regularizeLog.status) {
      changes['status'] = { from: regularizeLog.status, to: regStatus };
    }
    if (targetPunchIn !== regularizeLog.punch_in) {
      changes['punch_in'] = { from: regularizeLog.punch_in, to: targetPunchIn };
    }
    if (targetPunchOut !== regularizeLog.punch_out) {
      changes['punch_out'] = { from: regularizeLog.punch_out, to: targetPunchOut };
    }
    if (targetWorkHours !== regularizeLog.work_hours) {
      changes['work_hours'] = { from: regularizeLog.work_hours, to: targetWorkHours };
    }
    if (targetLateMins !== regularizeLog.late_minutes) {
      changes['late_minutes'] = { from: regularizeLog.late_minutes, to: targetLateMins };
    }
    if (targetOvertimeMins !== regularizeLog.overtime_minutes) {
      changes['overtime_minutes'] = { from: regularizeLog.overtime_minutes, to: targetOvertimeMins };
    }
    if (targetHalfDay !== regularizeLog.half_day) {
      changes['half_day'] = { from: regularizeLog.half_day, to: targetHalfDay };
    }

    if (Object.keys(changes).length === 0) {
      setRegError('HTTP 422: Request made no actual changes to the attendance record');
      return;
    }

    const now = Date.now();
    const historyEntry = {
      at: now,
      by: regBy,
      reason: regReason,
      changes,
    };

    const updatedRecord: AttendanceRecord = {
      ...regularizeLog,
      status: regStatus,
      punch_in: targetPunchIn,
      punch_out: targetPunchOut,
      work_hours: targetWorkHours,
      late_minutes: targetLateMins,
      overtime_minutes: targetOvertimeMins,
      half_day: targetHalfDay,
      history: [...(regularizeLog.history || []), historyEntry],
    };

    onUpdateLog(updatedRecord);
    setRegularizeLog(null);
    showMsg(
      `HTTP 200 OK: Regularized record for ${regularizeLog.emp_code} on ${regularizeLog.date}. Added history entry.`,
      'success'
    );
  };

  // Filter & Paginate Logs
  const filteredLogs = logs
    .filter((l) => {
      if (empFilter && !l.emp_code.toLowerCase().includes(empFilter.toLowerCase())) return false;
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false;
      if (dateFrom && l.date < dateFrom) return false;
      if (dateTo && l.date > dateTo) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.emp_code.localeCompare(b.emp_code);
    });

  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;
  const paginatedLogs = filteredLogs.slice((page - 1) * pageSize, page * pageSize);

  const getStatusBadge = (status: Status) => {
    switch (status) {
      case 'PRESENT':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-800/60';
      case 'WFH':
        return 'bg-blue-950/80 text-blue-300 border-blue-800/60';
      case 'ON_DUTY':
        return 'bg-purple-950/80 text-purple-300 border-purple-800/60';
      case 'LEAVE':
        return 'bg-amber-950/80 text-amber-300 border-amber-800/60';
      case 'ABSENT':
        return 'bg-rose-950/80 text-rose-300 border-rose-800/60';
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {message && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-sm font-medium border shadow-lg transition-all ${
            message.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-200 border-emerald-700'
              : 'bg-rose-950/90 text-rose-200 border-rose-700'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-slate-400 hover:text-white text-xs px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Action Cards: Punch In and Punch Out */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Punch In Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <LogIn className="w-5 h-5" />
              <span>POST /attendance/punch-in</span>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              Rules R1, R2
            </span>
          </div>

          <form onSubmit={handlePunchIn} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Employee</label>
                <select
                  value={punchInEmp}
                  onChange={(e) => setPunchInEmp(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500"
                >
                  {employees.map((e) => (
                    <option key={e.emp_code} value={e.emp_code}>
                      {e.emp_code} - {e.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Status</label>
                <select
                  value={punchInStatus}
                  onChange={(e) => setPunchInStatus(e.target.value as PresenceStatus)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="PRESENT">PRESENT</option>
                  <option value="WFH">WFH</option>
                  <option value="ON_DUTY">ON_DUTY</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Calendar Date (IST)</label>
                <input
                  type="date"
                  value={punchInDate}
                  onChange={(e) => setPunchInDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Punch Time (HH:MM IST)</label>
                <input
                  type="time"
                  value={punchInTime}
                  onChange={(e) => setPunchInTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow"
            >
              <LogIn className="w-4 h-4" />
              Execute Punch In
            </button>
          </form>
        </div>

        {/* Punch Out Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold">
              <LogOut className="w-5 h-5" />
              <span>POST /attendance/punch-out</span>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              Rules R3, R4, R5
            </span>
          </div>

          <form onSubmit={handlePunchOut} className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Employee to Punch Out</label>
              <select
                value={punchOutEmp}
                onChange={(e) => setPunchOutEmp(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-cyan-500"
              >
                {employees.map((e) => (
                  <option key={e.emp_code} value={e.emp_code}>
                    {e.emp_code} - {e.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Calendar Date (IST)</label>
                <input
                  type="date"
                  value={punchOutDate}
                  onChange={(e) => setPunchOutDate(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Punch Time (HH:MM IST)</label>
                <input
                  type="time"
                  value={punchOutTime}
                  onChange={(e) => setPunchOutTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full mt-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow"
            >
              <LogOut className="w-4 h-4" />
              Execute Punch Out
            </button>
          </form>
        </div>
      </div>

      {/* Filter and List Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-white">Attendance Logs</h3>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {filteredLogs.length} Records
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by emp code..."
                value={empFilter}
                onChange={(e) => {
                  setEmpFilter(e.target.value);
                  setPage(1);
                }}
                className="bg-slate-800 border border-slate-700 text-white rounded-lg pl-8 pr-3 py-1.5 w-40 text-xs focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="PRESENT">PRESENT</option>
              <option value="WFH">WFH</option>
              <option value="ON_DUTY">ON_DUTY</option>
              <option value="ABSENT">ABSENT</option>
              <option value="LEAVE">LEAVE</option>
            </select>

            <input
              type="date"
              placeholder="From"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs"
            />
            <span className="text-slate-500">-</span>
            <input
              type="date"
              placeholder="To"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Attendance Table */}
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-800/80 text-slate-300 border-b border-slate-700">
                <th className="py-2.5 px-3 font-semibold">Emp Code</th>
                <th className="py-2.5 px-3 font-semibold">Attendance Date</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">Punch In (IST)</th>
                <th className="py-2.5 px-3 font-semibold">Punch Out (IST)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Work Hours</th>
                <th className="py-2.5 px-3 font-semibold text-right">Late Min</th>
                <th className="py-2.5 px-3 font-semibold text-right">OT Min</th>
                <th className="py-2.5 px-3 font-semibold text-center">Audit History</th>
                <th className="py-2.5 px-3 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {paginatedLogs.map((log) => {
                const inIst = log.punch_in ? toIstDate(log.punch_in) : null;
                const outIst = log.punch_out ? toIstDate(log.punch_out) : null;
                const historyCount = log.history?.length || 0;

                return (
                  <tr key={`${log.emp_code}-${log.date}`} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-3 font-bold text-white">{log.emp_code}</td>
                    <td className="py-3 px-3 text-slate-300">{log.date}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-sans font-medium border ${getStatusBadge(
                          log.status
                        )}`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      {inIst ? (
                        <span>
                          {inIst.timeStr}{' '}
                          <span className="text-[10px] text-slate-500 font-sans">({inIst.dateStr})</span>
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      {outIst ? (
                        <span>
                          {outIst.timeStr}{' '}
                          <span className="text-[10px] text-slate-500 font-sans">({outIst.dateStr})</span>
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {log.work_hours !== null ? (
                        <span className="font-bold text-slate-100">
                          {log.work_hours}h{' '}
                          {log.half_day && (
                            <span className="text-[10px] text-amber-400 font-sans bg-amber-950/60 px-1 py-0.5 rounded">
                              Half
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {log.late_minutes > 0 ? (
                        <span className="text-amber-400 font-semibold">{log.late_minutes}m</span>
                      ) : (
                        <span className="text-slate-500">0m</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {log.overtime_minutes > 0 ? (
                        <span className="text-emerald-400 font-semibold">{log.overtime_minutes}m</span>
                      ) : (
                        <span className="text-slate-500">0m</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {historyCount > 0 ? (
                        <button
                          onClick={() => setInspectHistoryLog(log)}
                          className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[11px] font-sans hover:bg-indigo-900 transition-colors inline-flex items-center gap-1"
                        >
                          <History className="w-3 h-3" />
                          {historyCount} edit{historyCount > 1 ? 's' : ''}
                        </button>
                      ) : (
                        <span className="text-slate-600 font-sans text-[11px]">0</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => openRegularize(log)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-sans border border-slate-700 transition-colors inline-flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                        Regularize
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paginatedLogs.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-500">
                    No attendance records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Showing {(page - 1) * pageSize + 1} to{' '}
            {Math.min(page * pageSize, filteredLogs.length)} of {filteredLogs.length} items
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded bg-slate-800 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded bg-slate-800 border border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Regularize Modal */}
      {regularizeLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-white font-semibold">
                <Edit3 className="w-5 h-5 text-indigo-400" />
                <span>Regularize Attendance (PATCH)</span>
              </div>
              <button
                onClick={() => setRegularizeLog(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-950/70 rounded-lg text-xs space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Employee:</span>
                <span className="text-white">{regularizeLog.emp_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Attendance Date:</span>
                <span className="text-indigo-300 font-bold">{regularizeLog.date}</span>
              </div>
            </div>

            {regError && (
              <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{regError}</span>
              </div>
            )}

            <form onSubmit={handleSaveRegularize} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 block mb-1 font-medium">Status</label>
                <select
                  value={regStatus}
                  onChange={(e) => setRegStatus(e.target.value as Status)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2"
                >
                  <option value="PRESENT">PRESENT</option>
                  <option value="WFH">WFH</option>
                  <option value="ON_DUTY">ON_DUTY</option>
                  <option value="ABSENT">ABSENT (Clears Punch Times)</option>
                  <option value="LEAVE">LEAVE (Clears Punch Times)</option>
                </select>
              </div>

              {!['ABSENT', 'LEAVE'].includes(regStatus) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-400 block mb-1">Punch In Date</label>
                      <input
                        type="date"
                        value={regPunchInDate}
                        onChange={(e) => setRegPunchInDate(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Punch In Time (HH:MM)</label>
                      <input
                        type="time"
                        value={regPunchInTime}
                        onChange={(e) => setRegPunchInTime(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-slate-400 block mb-1">Punch Out Date</label>
                      <input
                        type="date"
                        value={regPunchOutDate}
                        onChange={(e) => setRegPunchOutDate(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Punch Out Time (HH:MM)</label>
                      <input
                        type="time"
                        value={regPunchOutTime}
                        onChange={(e) => setRegPunchOutTime(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-2.5 py-1.5"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="text-slate-300 block mb-1 font-medium">
                  Reason for Regularization (min 5 chars)
                </label>
                <input
                  type="text"
                  required
                  value={regReason}
                  onChange={(e) => setRegReason(e.target.value)}
                  placeholder="e.g. Biometric device malfunction at entry gate"
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-medium">Regularized By</label>
                <input
                  type="text"
                  required
                  value={regBy}
                  onChange={(e) => setRegBy(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRegularizeLog(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow"
                >
                  Apply & Append Audit Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Inspector Modal */}
      {inspectHistoryLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-white font-semibold">
                <History className="w-5 h-5 text-indigo-400" />
                <span>Audit Trail History ({inspectHistoryLog.emp_code} - {inspectHistoryLog.date})</span>
              </div>
              <button
                onClick={() => setInspectHistoryLog(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {inspectHistoryLog.history?.map((entry, idx) => {
                const atIst = toIstDate(entry.at);
                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-semibold text-indigo-300">Edited by: {entry.by}</span>
                      <span className="font-mono text-[11px]">
                        {atIst.dateStr} {atIst.timeStr} IST
                      </span>
                    </div>

                    <div className="text-slate-200">
                      <span className="text-slate-400">Reason:</span> &ldquo;{entry.reason}&rdquo;
                    </div>

                    <div className="pt-2 border-t border-slate-800/80">
                      <span className="text-slate-400 block mb-1 font-semibold">Fields Changed:</span>
                      <div className="space-y-1 font-mono">
                        {Object.entries(entry.changes).map(([fKey, diff]) => {
                          const formatVal = (v: any) => {
                            if (v === null || v === undefined) return 'null';
                            if (typeof v === 'number' && v > 100000000000) {
                              const d = toIstDate(v);
                              return `${d.dateStr} ${d.timeStr}`;
                            }
                            return String(v);
                          };
                          return (
                            <div
                              key={fKey}
                              className="flex items-center gap-2 p-1.5 rounded bg-slate-900 border border-slate-800/60"
                            >
                              <span className="text-indigo-400 font-semibold">{fKey}:</span>
                              <span className="text-rose-400 line-through">
                                {formatVal(diff.from)}
                              </span>
                              <span className="text-slate-500">&rarr;</span>
                              <span className="text-emerald-400">{formatVal(diff.to)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => setInspectHistoryLog(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
