import React, { useState } from 'react';
import { Save, RefreshCw, X } from 'lucide-react';

function SavePostTemplateModal({ content, mediaUrl, onSave, onClose }) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim()) return;
        setSaving(true);
        setError('');
        try {
            await onSave(name.trim(), content, mediaUrl);
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
                        <Save size={16} className="text-amber-400" /> Save as Template
                    </h2>
                    <button onClick={onClose} aria-label="סגור" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Template Name</label>
                        <input autoFocus
                            className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:ring-offset-0 outline-none"
                            placeholder='e.g. "Apartment for Rent"'
                            value={name} onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submit()} />
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
                        className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 dark:disabled:bg-[#21262d] disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save Template
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SavePostTemplateModal;
