import React, { useState } from 'react';
import { REPO_FILES, RepoFile } from '../data/rawRepoFiles';
import {
  FileText,
  Copy,
  Check,
  Download,
  FolderTree,
  Terminal,
  ExternalLink,
} from 'lucide-react';

export const RepoFileExplorer: React.FC = () => {
  const [selectedFileName, setSelectedFileName] = useState<string>('main.py');
  const [copied, setCopied] = useState<boolean>(false);

  const selectedFile =
    REPO_FILES.find((f) => f.name === selectedFileName) || REPO_FILES[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (file: RepoFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    // Downloads all 8 files sequentially
    REPO_FILES.forEach((f, idx) => {
      setTimeout(() => {
        handleDownload(f);
      }, idx * 150);
    });
  };

  const lines = selectedFile.content.split('\n');

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FolderTree className="w-6 h-6 text-indigo-400" />
            <h2 className="text-xl font-bold text-white">Public Git Repository Submission Package</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Complete candidate kit ready for submission to the evaluation portal:{' '}
            <a
              href="https://forms.cloud.microsoft/r/eUE5uvaxpr"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 underline inline-flex items-center gap-1 hover:text-indigo-300"
            >
              Submission Form <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>

        <button
          onClick={handleDownloadAll}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg transition-all flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Download All 8 Files
        </button>
      </div>

      {/* Main Explorer Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar: File List */}
        <div className="md:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 mb-2">
            Required Git Files
          </div>
          {REPO_FILES.map((file) => {
            const isSelected = file.name === selectedFileName;
            return (
              <button
                key={file.name}
                onClick={() => setSelectedFileName(file.name)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs text-left transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white font-medium shadow'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-4 h-4 shrink-0 opacity-80" />
                  <span className="truncate">{file.path}</span>
                </div>
                <span className="text-[10px] opacity-70 font-mono ml-1">{file.language}</span>
              </button>
            );
          })}

          <div className="mt-4 pt-4 border-t border-slate-800 text-[11px] text-slate-400 px-2 space-y-2">
            <div className="font-semibold text-slate-300">Git Push Instructions:</div>
            <div className="p-2 rounded bg-slate-950 font-mono text-[10px] text-indigo-300 space-y-1">
              <div>git init</div>
              <div>git add .</div>
              <div>git commit -m &quot;feat: complete attendance API&quot;</div>
              <div>git push origin main</div>
            </div>
          </div>
        </div>

        {/* Code Viewer */}
        <div className="md:col-span-3 bg-slate-900 border border-slate-800 rounded-xl flex flex-col shadow-md overflow-hidden">
          {/* Header of Viewer */}
          <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="text-white font-mono text-xs font-semibold">
                  {selectedFile.path}
                </span>
                <span className="text-[11px] text-slate-400 block">{selectedFile.description}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all flex items-center gap-1.5 border border-slate-700"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy File</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleDownload(selectedFile)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all flex items-center gap-1.5 shadow"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            </div>
          </div>

          {/* Code Body */}
          <div className="p-4 bg-slate-950 overflow-x-auto max-h-[580px] font-mono text-xs leading-relaxed">
            <table className="w-full text-left">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="hover:bg-slate-900/60 transition-colors">
                    <td className="w-10 pr-4 select-none text-right text-slate-600 text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="text-slate-200 whitespace-pre">{line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer info */}
          <div className="px-4 py-2.5 bg-slate-900/90 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
            <span>{lines.length} lines</span>
            <span>UTF-8 • {selectedFile.language}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
