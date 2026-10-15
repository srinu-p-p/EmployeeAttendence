import React, { useState } from 'react';
import {
  Employee,
  AttendanceRecord,
  EmployeeMonthly,
  DepartmentSummaryItem,
  LeaderboardItem,
  TrendItem,
} from '../types/attendance';
import {
  calculateEmployeeMonthly,
  calculateDepartmentSummary,
  calculateLateLeaderboard,
  calculateDepartmentTrend,
} from '../lib/attendanceAnalytics';
import {
  Users,
  Building2,
  Trophy,
  TrendingUp,
  Clock,
  Calendar,
  AlertTriangle,
  Award,
  CheckCircle2,
} from 'lucide-react';

interface Props {
  employees: Employee[];
  logs: AttendanceRecord[];
}

export const DashboardAnalytics: React.FC<Props> = ({ employees, logs }) => {
  const [selectedMonth, setSelectedMonth] = useState('2026-07');
  const [selectedEmp, setSelectedEmp] = useState('EMP0001');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [leaderboardLimit, setLeaderboardLimit] = useState(10);
  const [trendDept, setTrendDept] = useState('Engineering');
  const [trendFrom, setTrendFrom] = useState('2026-07-01');
  const [trendTo, setTrendTo] = useState('2026-07-15');

  // Calculations
  const monthlyData: EmployeeMonthly | null = calculateEmployeeMonthly(
    selectedEmp,
    selectedMonth,
    employees,
    logs
  );

  const deptSummaries: DepartmentSummaryItem[] = calculateDepartmentSummary(
    selectedMonth,
    deptFilter === 'ALL' ? undefined : deptFilter,
    employees,
    logs
  );

  const leaderboard: LeaderboardItem[] = calculateLateLeaderboard(
    selectedMonth,
    leaderboardLimit,
    deptFilter === 'ALL' ? undefined : deptFilter,
    employees,
    logs
  );

  const trendResult = calculateDepartmentTrend(trendDept, trendFrom, trendTo, employees, logs);
  const trendItems: TrendItem[] = Array.isArray(trendResult) ? trendResult : [];

  const departments = Array.from(new Set(employees.map((e) => e.department))).sort();
  const selectedEmpObj = employees.find((e) => e.emp_code === selectedEmp);

  return (
    <div className="space-y-8">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-indigo-400" />
          <span className="text-sm font-semibold text-slate-300">Reporting Month:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="2026-07">2026-07 (July 2026 - Primary)</option>
            <option value="2026-06">2026-06 (June 2026)</option>
            <option value="2026-05">2026-05 (May 2026)</option>
            <option value="2026-03">2026-03 (March 2026 - Mid Hire)</option>
            <option value="2026-01">2026-01 (January 2026)</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <Building2 className="w-5 h-5 text-emerald-400" />
          <span className="text-sm font-semibold text-slate-300">Department Scope:</span>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid: 1. Employee Monthly Card & 2. Department Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Employee Monthly Focus */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-white">Employee Monthly Summary</h3>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                Rule R7
              </span>
            </div>

            <div className="mt-4">
              <label className="text-xs text-slate-400 block mb-1">Select Employee:</label>
              <select
                value={selectedEmp}
                onChange={(e) => setSelectedEmp(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {employees.map((e) => (
                  <option key={e.emp_code} value={e.emp_code}>
                    {e.emp_code} - {e.name} ({e.department})
                  </option>
                ))}
              </select>
            </div>

            {selectedEmpObj && (
              <div className="mt-3 p-3 bg-slate-950/70 border border-slate-800/70 rounded-lg text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Shift Times:</span>
                  <span className="text-slate-200 font-mono">
                    {selectedEmpObj.shift_start} - {selectedEmpObj.shift_end} IST{' '}
                    {selectedEmpObj.shift_end <= selectedEmpObj.shift_start && (
                      <span className="text-amber-400 font-sans">(Overnight)</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Joined On:</span>
                  <span className="text-slate-200 font-mono">{selectedEmpObj.joined_on}</span>
                </div>
              </div>
            )}

            {monthlyData && (
              <div className="mt-5 space-y-3">
                <div className="p-4 bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-900/40 rounded-xl text-center">
                  <span className="text-xs font-medium text-indigo-300 uppercase tracking-wider">
                    Attendance Percentage
                  </span>
                  <div className="text-3xl font-bold text-white mt-1">
                    {monthlyData.attendance_pct !== null ? `${monthlyData.attendance_pct}%` : 'N/A'}
                  </div>
                  <span className="text-xs text-slate-400 mt-1 block">
                    {monthlyData.present_days} present / {monthlyData.working_days} working days
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800">
                    <span className="text-slate-400 block">Working Days</span>
                    <span className="text-base font-semibold text-white font-mono">
                      {monthlyData.working_days}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800">
                    <span className="text-slate-400 block">Present Days</span>
                    <span className="text-base font-semibold text-emerald-400 font-mono">
                      {monthlyData.present_days}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800">
                    <span className="text-slate-400 block">Leave Days</span>
                    <span className="text-base font-semibold text-blue-400 font-mono">
                      {monthlyData.leave_days}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800">
                    <span className="text-slate-400 block">Late Count</span>
                    <span className="text-base font-semibold text-amber-400 font-mono">
                      {monthlyData.late_count}
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs p-2.5 bg-slate-800/30 rounded border border-slate-800">
                  <span className="text-slate-400">Total Late Minutes:</span>
                  <span className="font-mono font-semibold text-amber-300">
                    {monthlyData.total_late_minutes} min
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs p-2.5 bg-slate-800/30 rounded border border-slate-800">
                  <span className="text-slate-400">Total Overtime Minutes:</span>
                  <span className="font-mono font-semibold text-emerald-300">
                    {monthlyData.total_overtime_minutes} min
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
            * Mon-Fri only for present_days; half-day counts as 0.5. Weekend records add to late and
            overtime totals per R7.
          </div>
        </div>

        {/* Right: Department Summary Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-white">Department Monthly Summary</h3>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/50">
                Rule R9 (Zero-log Headcount)
              </span>
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-800/70 text-slate-300 border-b border-slate-700">
                    <th className="py-2.5 px-3 font-semibold">Department</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Headcount</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Present Days</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Avg Work Hrs</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Late Count</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Total Late</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Leaves</th>
                    <th className="py-2.5 px-3 font-semibold text-right">On Duty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {deptSummaries.map((item) => (
                    <tr key={item.department} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 font-sans font-medium text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        {item.department}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-200 font-bold">{item.headcount}</td>
                      <td className="py-3 px-3 text-right text-emerald-400">{item.present_days}</td>
                      <td className="py-3 px-3 text-right text-slate-300">
                        {item.avg_work_hours !== null ? `${item.avg_work_hours}h` : '—'}
                      </td>
                      <td className="py-3 px-3 text-right text-amber-400">{item.late_count}</td>
                      <td className="py-3 px-3 text-right text-amber-300">{item.total_late_minutes}m</td>
                      <td className="py-3 px-3 text-right text-blue-400">{item.leave_count}</td>
                      <td className="py-3 px-3 text-right text-purple-400">{item.on_duty_count}</td>
                    </tr>
                  ))}
                  {deptSummaries.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-slate-500">
                        No department data found for month {selectedMonth}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              All department members joined on or before month end are counted in headcount even if
              they recorded zero attendance documents.
            </span>
          </div>
        </div>
      </div>

      {/* Grid: 3. Late Leaderboard & 4. Department Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Late Leaderboard */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              <h3 className="font-semibold text-white">Late-comers Leaderboard</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Limit:</span>
              <select
                value={leaderboardLimit}
                onChange={(e) => setLeaderboardLimit(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs"
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
              </select>
              <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/50">
                Competition (1, 2, 2, 4)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-800/70 text-slate-300 border-b border-slate-700">
                  <th className="py-2.5 px-3 font-semibold text-center w-12">Rank</th>
                  <th className="py-2.5 px-3 font-semibold">Employee</th>
                  <th className="py-2.5 px-3 font-semibold">Department</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Total Late</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Late Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {leaderboard.map((item, idx) => {
                  const isFirst = item.rank === 1;
                  const isSecond = item.rank === 2;
                  const isThird = item.rank === 3;
                  return (
                    <tr
                      key={`${item.emp_code}-${idx}`}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold text-xs ${
                            isFirst
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                              : isSecond
                              ? 'bg-slate-400/20 text-slate-200 border border-slate-400/50'
                              : isThird
                              ? 'bg-amber-700/20 text-amber-400 border border-amber-700/50'
                              : 'text-slate-400'
                          }`}
                        >
                          {item.rank}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-sans">
                        <div className="font-semibold text-white">{item.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{item.emp_code}</div>
                      </td>
                      <td className="py-3 px-3 font-sans text-slate-300">{item.department}</td>
                      <td className="py-3 px-3 text-right font-bold text-amber-300">
                        {item.total_late_minutes} min
                      </td>
                      <td className="py-3 px-3 text-right text-slate-300">{item.late_count} times</td>
                    </tr>
                  );
                })}
                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-500">
                      No late arrivals recorded for this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
            * Ties share a rank and the next rank is skipped. All candidates with rank &le; limit are
            included.
          </div>
        </div>

        {/* Department Trend */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-cyan-400" />
                <h3 className="font-semibold text-white">Daily Attendance Trend</h3>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <select
                  value={trendDept}
                  onChange={(e) => setTrendDept(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={trendFrom}
                  onChange={(e) => setTrendFrom(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                />
                <span className="text-slate-500">to</span>
                <input
                  type="date"
                  value={trendTo}
                  onChange={(e) => setTrendTo(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-white rounded px-2 py-1 text-xs"
                />
              </div>
            </div>

            <div className="overflow-x-auto max-h-72 mt-4">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  <tr className="bg-slate-800/80 text-slate-300 border-b border-slate-700">
                    <th className="py-2 px-2 font-semibold">Date</th>
                    <th className="py-2 px-2 font-semibold text-center">Day</th>
                    <th className="py-2 px-2 font-semibold text-right">Headcount</th>
                    <th className="py-2 px-2 font-semibold text-right">Present</th>
                    <th className="py-2 px-2 font-semibold text-right">Late</th>
                    <th className="py-2 px-2 font-semibold text-right">Rate</th>
                    <th className="py-2 px-2 font-semibold text-right">7d Mov Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {trendItems.map((item) => (
                    <tr
                      key={item.date}
                      className={`hover:bg-slate-800/30 transition-colors ${
                        !item.is_working_day ? 'opacity-60 bg-slate-950/40' : ''
                      }`}
                    >
                      <td className="py-2 px-2 text-white font-medium">{item.date}</td>
                      <td className="py-2 px-2 text-center">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-sans ${
                            item.is_working_day
                              ? 'bg-slate-800 text-slate-300'
                              : 'bg-rose-950/50 text-rose-300 border border-rose-900/50'
                          }`}
                        >
                          {item.is_working_day ? 'Workday' : 'Weekend'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300">{item.headcount}</td>
                      <td className="py-2 px-2 text-right text-emerald-400">{item.present_count}</td>
                      <td className="py-2 px-2 text-right text-amber-400">{item.late_count}</td>
                      <td className="py-2 px-2 text-right font-semibold text-cyan-300">
                        {item.attendance_rate !== null ? (item.attendance_rate * 100).toFixed(2) + '%' : '—'}
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-indigo-300">
                        {item.moving_avg_7d !== null ? (item.moving_avg_7d * 100).toFixed(2) + '%' : '—'}
                      </td>
                    </tr>
                  ))}
                  {trendItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No trend data available for the selected range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800 text-[11px] text-slate-400">
            * Exactly one row per calendar day (densified). Attendance rate calculated only on working
            days with headcount &gt; 0, 4 decimals half-up.
          </div>
        </div>
      </div>
    </div>
  );
};
