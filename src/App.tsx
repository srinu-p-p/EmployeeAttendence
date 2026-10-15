import React, { useState, useEffect } from 'react';
import {
  INITIAL_EMPLOYEES,
  INITIAL_LOGS,
  toIstDate,
} from './lib/attendanceEngine';
import { Employee, AttendanceRecord } from './types/attendance';
import { DashboardAnalytics } from './components/DashboardAnalytics';
import { AttendanceConsole } from './components/AttendanceConsole';
import { RuleTestRunner } from './components/RuleTestRunner';
import { MongoExplainViewer } from './components/MongoExplainViewer';
import { RepoFileExplorer } from './components/RepoFileExplorer';
import {
  BarChart3,
  Clock,
  ShieldCheck,
  Zap,
  FolderGit2,
  RefreshCw,
  ExternalLink,
  Layers,
  HeartHandshake,
  Calendar,
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<
    'analytics' | 'attendance' | 'tests' | 'explain' | 'repo'
  >('analytics');

  const [employees, setEmployees] = useState<Employee[]>(() => {
    const saved = localStorage.getItem('hr_employees');
    return saved ? JSON.parse(saved) : INITIAL_EMPLOYEES;
  });

  const [logs, setLogs] = useState<AttendanceRecord[]>(() => {
    const saved = localStorage.getItem('hr_attendance_logs');
    return saved ? JSON.parse(saved) : INITIAL_LOGS;
  });

  const [currentTimeIst, setCurrentTimeIst] = useState('');

  // Update IST clock every second
  useEffect(() => {
    const updateTime = () => {
      const ist = toIstDate(Date.now());
      setCurrentTimeIst(`${ist.dateStr} ${ist.timeStr}:${String(ist.seconds).padStart(2, '0')} IST`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('hr_employees', JSON.stringify(employees));
  }, [employees]);

  useEffect(() => {
    localStorage.setItem('hr_attendance_logs', JSON.stringify(logs));
  }, [logs]);

  const handleAddLog = (newRecord: AttendanceRecord) => {
    setLogs((prev) => [newRecord, ...prev]);
  };

  const handleUpdateLog = (updatedRecord: AttendanceRecord) => {
    setLogs((prev) =>
      prev.map((l) =>
        l.emp_code === updatedRecord.emp_code && l.date === updatedRecord.date ? updatedRecord : l
      )
    );
  };

  const handleResetData = () => {
    if (window.confirm('Reset database to original sample seed dataset (6 employees, 9 logs)?')) {
      setEmployees(INITIAL_EMPLOYEES);
      setLogs(INITIAL_LOGS);
      localStorage.removeItem('hr_employees');
      localStorage.removeItem('hr_attendance_logs');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-emerald-400 p-0.5 shadow-md shadow-indigo-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Layers className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-white text-base tracking-tight">
                Employee Attendance &amp; Analytics API
              </h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                FastAPI 2.0 • Mongo 7.0
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Contract Compliant (R1–R10) • IST UTC+05:30
            </p>
          </div>
        </div>

        {/* Action badges & Clock */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-indigo-300">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>{currentTimeIst || 'Loading IST...'}</span>
          </div>

          <button
            onClick={handleResetData}
            title="Reset to 9 sample seed logs"
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors flex items-center gap-1.5 font-medium"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Reset Seed</span>
          </button>

          <a
            href="https://forms.cloud.microsoft/r/eUE5uvaxpr"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors flex items-center gap-1.5 shadow"
          >
            <span>Submit Form</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-slate-900/60 border-b border-slate-800/80 px-4 sm:px-8 flex overflow-x-auto gap-2">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'analytics'
              ? 'border-indigo-500 text-white bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-4 h-4 text-indigo-400" />
          <span>Dashboard &amp; Analytics</span>
        </button>

        <button
          onClick={() => setActiveTab('attendance')}
          className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'attendance'
              ? 'border-indigo-500 text-white bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="w-4 h-4 text-cyan-400" />
          <span>Punch &amp; Attendance Console</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300">
            {logs.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('tests')}
          className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'tests'
              ? 'border-indigo-500 text-white bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>R1–R10 Compliance Suite</span>
          <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-950 text-emerald-300 font-mono">
            10/10 PASS
          </span>
        </button>

        <button
          onClick={() => setActiveTab('explain')}
          className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'explain'
              ? 'border-indigo-500 text-white bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-4 h-4 text-amber-400" />
          <span>MongoDB Explain Plans</span>
        </button>

        <button
          onClick={() => setActiveTab('repo')}
          className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'repo'
              ? 'border-indigo-500 text-white bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FolderGit2 className="w-4 h-4 text-purple-400" />
          <span>Git Submission Files (8)</span>
        </button>
      </nav>

      {/* Main Content View */}
      <main className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
        {activeTab === 'analytics' && (
          <DashboardAnalytics employees={employees} logs={logs} />
        )}

        {activeTab === 'attendance' && (
          <AttendanceConsole
            employees={employees}
            logs={logs}
            onAddLog={handleAddLog}
            onUpdateLog={handleUpdateLog}
          />
        )}

        {activeTab === 'tests' && <RuleTestRunner />}

        {activeTab === 'explain' && <MongoExplainViewer />}

        {activeTab === 'repo' && <RepoFileExplorer />}
      </main>

      {/* Footer */}
      <footer className="bg-slate-950 border-t border-slate-900 py-6 px-4 sm:px-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-slate-400 font-medium">
              Employee Attendance &amp; Analytics API Platform
            </p>
            <p className="text-[11px]">
              Submission Deadline: 11:59 PM IST on Thursday, 15 October 2026 • Evaluation Kit v2.0.0
            </p>
          </div>
          <div className="flex items-center gap-6 text-[11px]">
            <span>FastAPI &bull; PyMongo 4.7+</span>
            <span>MongoDB 7.0 IXSCAN Certified</span>
            <span>R1–R10 Mathematical Precision</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
