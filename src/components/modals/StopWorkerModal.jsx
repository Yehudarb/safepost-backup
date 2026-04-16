import React from 'react';
import { StopCircle, AlertTriangle } from 'lucide-react';

function StopWorkerModal({ onConfirm, onClose, workerActive }) {
    return (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-red-900/50 w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-red-900/40 bg-red-900/20 flex items-center gap-3">
                    <StopCircle size={20} className="text-red-400 shrink-0" />
                    <div>
                        <h2 className="text-gray-900 dark:text-white font-bold text-sm">Send Stop Signal</h2>
                        <p className="text-[10px] text-red-400 mt-0.5">Worker will halt after current operation</p>
                    </div>
                </div>
                <div className="p-5 space-y-3">
                    <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-xs text-gray-400 space-y-2">
                        <p>• The extension will <span className="text-gray-900 dark:text-white font-bold">not pick up new jobs</span> for 10 minutes</p>
                        <p>• Any task <span className="text-yellow-400 font-bold">currently PROCESSING</span> will still complete</p>
                        <p>• Use <span className="text-green-400 font-bold">"Resume Worker"</span> to restore normal operation</p>
                        <p>• To stop immediately — also <span className="text-orange-400 font-bold">Cancel All Pending</span> tasks</p>
                    </div>
                    {workerActive && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border-yellow-800/40 rounded-lg">
                            <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
                            <span className="text-xs text-yellow-400">Worker is currently ACTIVE — a post may be mid-execution</span>
                        </div>
                    )}
                </div>
                <div className="p-4 flex justify-end gap-2 border-t border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d]">Cancel</button>
                    <button onClick={onConfirm}
                        className="px-5 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                        <StopCircle size={12} /> Send Stop Signal
                    </button>
                </div>
            </div>
        </div>
    );
}

export default StopWorkerModal;