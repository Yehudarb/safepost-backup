import React, { useState } from 'react';
import { Sparkles, RefreshCw, Send, CheckCircle, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

/**
 * AiPostAssistantModal
 * @param {function} onInsert - callback to insert AI text into the post form
 * @param {function} onGenerate - ApiService.generateAiContent(prompt, history) passed from App
 * @param {function} onClose
 */
function AiPostAssistantModal({ onInsert, onGenerate, onClose }) {
    const { t } = useLanguage();
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([]);
    const [generating, setGenerating] = useState(false);
    const chatEndRef = React.useRef(null);
    const inputRef = React.useRef(null);

    React.useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || generating) return;
        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setGenerating(true);
        try {
            const history = messages.map(m => ({ role: m.role, content: m.text }));
            const result = await onGenerate(userMsg, history);
            if (result.success && result.text) {
                setMessages(prev => [...prev, { role: 'ai', text: result.text }]);
            } else {
                setMessages(prev => [...prev, { role: 'error', text: result.message || t('aiAssistantGenericError') }]);
            }
        } catch (e) {
            setMessages(prev => [...prev, { role: 'error', text: t('aiAssistantNetworkError') }]);
        } finally {
            setGenerating(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-xl rounded-xl shadow-2xl flex flex-col max-h-[90vh] h-[600px]">

                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128] shrink-0">
                    <h2 className="text-gray-900 dark:text-white font-bold text-sm flex items-center gap-2">
                        <Sparkles size={16} className="text-purple-400" /> AI Content Generator
                    </h2>
                    <button onClick={onClose} aria-label={t('close')} className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition"><X size={18} /></button>
                </div>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-40">
                            <Sparkles size={32} className="text-purple-400" />
                            <p className="text-gray-400 text-sm">{t('aiAssistantEmptyStateLine1')}<br />{t('aiAssistantEmptyStateLine2')}</p>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'error' ? (
                                <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2 max-w-[85%]">
                                    ❌ {msg.text}
                                </div>
                            ) : (
                                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-purple-700 text-white rounded-br-sm' : 'bg-gray-100 dark:bg-[#21262d] text-gray-700 dark:text-gray-200 rounded-bl-sm'}`}>
                                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                                    {msg.role === 'ai' && (
                                        <button onClick={() => onInsert(msg.text)}
                                            className="mt-2 text-[10px] font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300 flex items-center gap-1 transition">
                                            <CheckCircle size={11} /> {t('aiAssistantUseThisText')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    {generating && (
                        <div className="flex justify-start">
                            <div className="bg-gray-100 dark:bg-[#21262d] rounded-xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                                <div className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Bar */}
                <div className="p-3 border-t border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] shrink-0">
                    <div className="flex gap-2 items-end">
                        <textarea ref={inputRef} autoFocus rows={2}
                            className="flex-1 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:ring-offset-0 outline-none transition resize-none"
                            placeholder={t('aiAssistantInputPlaceholder')}
                            value={input} onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
                        <button onClick={sendMessage} disabled={!input.trim() || generating}
                            className="p-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-200 dark:disabled:bg-[#21262d] disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-lg transition shrink-0">
                            {generating ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                    <p className="text-[10px] text-gray-600 mt-1.5" dir="rtl">{t('aiAssistantKeyboardHint')}</p>
                </div>
            </div>
        </div>
    );
}

export default AiPostAssistantModal;
