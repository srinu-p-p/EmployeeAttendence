import React, { useState } from 'react';
import { runComplianceTests, TestCaseResult } from '../lib/testSuite';
import {
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Check,
  AlertTriangle,
} from 'lucide-react';

export const RuleTestRunner: React.FC = () => {
  const [results, setResults] = useState<TestCaseResult[]>(() => runComplianceTests());
  const [isRunning, setIsRunning] = useState(false);

  const handleRunAll = () => {
    setIsRunning(true);
    setTimeout(() => {
      setResults(runComplianceTests());
      setIsRunning(false);
    }, 400);
  };

  const passCount = results.filter((r) => r.passed).length;
  const allPassed = passCount === results.length;

  return (
    <div className="space-y-6">
      {/* Test Runner Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl font-bold text-white">R1–R10 Business Rules Compliance Suite</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Automated verification suite testing all edge cases: overnight shifts across midnight,
            10-minute grace threshold, banker's rounding avoidance, competition tie handling, and
            zero-log headcount inclusion.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {passCount} / {results.length} PASS
            </div>
            <span className="text-[11px] text-slate-400">
              {allPassed ? '100% Specification Compliant' : 'Some Tests Failed'}
            </span>
          </div>

          <button
            onClick={handleRunAll}
            disabled={isRunning}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RotateCcw className="w-4 h-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run All Tests
              </>
            )}
          </button>
        </div>
      </div>

      {/* Test Cases Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {results.map((test) => (
          <div
            key={test.id}
            className={`p-5 rounded-xl border transition-all ${
              test.passed
                ? 'bg-slate-900/90 border-slate-800 hover:border-emerald-500/40'
                : 'bg-rose-950/20 border-rose-900/60'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/60">
                  {test.rule}
                </span>
                <h3 className="font-semibold text-white text-sm">{test.title}</h3>
              </div>

              {test.passed ? (
                <div className="flex items-center gap-1 text-emerald-400 text-xs font-semibold font-mono">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>PASS</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-rose-400 text-xs font-semibold font-mono">
                  <XCircle className="w-4 h-4" />
                  <span>FAIL</span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-300 mt-2">{test.description}</p>

            <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans">
                  Expected
                </span>
                <span className="text-slate-200">{test.expected}</span>
              </div>
              <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans">
                  Actual Result
                </span>
                <span className={test.passed ? 'text-emerald-400' : 'text-rose-400'}>
                  {test.actual}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
