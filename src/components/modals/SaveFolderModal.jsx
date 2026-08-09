import React, { useState } from 'react';
import { FolderPlus, RefreshCw, Save, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

function SaveFolderModal({ selectedGroups, groups, onSave, onClose }) {
    const { t } = useLanguage();
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim()) return;
        setSaving(true);
        setError('');
        try {
            await onSave(name.trim());
        } catch (e) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                    <h2 className="text-gray-900 dark:text-white font-bold text-sm flex items-center gap-2">
                        <FolderPlus size={16} className="text-blue-400" /> Save as Folder
                    </h2>
                    <button onClick={onClose} aria-label={t('close')} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Folder Name</label>
                        <input autoFocus
                            className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 outline-none"
                            placeholder='e.g. "Real Estate Groups"'
                            value={name} onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submit()} />
                    </div>
                    <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Saving {selectedGroups.length} groups</p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                            {selectedGroups.slice(0, 8).map(id => {
                                const g = groups.find(x => x.id === id);
                                return g ? <div key={id} className="text-xs text-gray-400 truncate" dir="rtl">{g.name}</div> : null;
                            })}
                            {selectedGroups.length > 8 && <div className="text-[10px] text-gray-600">+{selectedGroups.length - 8} more…</div>}
                        </div>
                    </div>
                </div>
                {error && (
                    <div className="px-4 pb-3 text-xs text-red-400 bg-red-900/20 border-t border-red-900/40 py-2">
                        ❌ {error}
                    </div>
                )}
                <div className="p-4 bg-gray-50 dark:bg-[#0d1117] flex justify-end gap-2 border-t border-gray-200 dark:border-[#30363d]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d]">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || saving}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 dark:disabled:bg-[#21262d] disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save Folder
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SaveFolderModal;