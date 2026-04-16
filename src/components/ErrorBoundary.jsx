import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[200px] gap-4 p-6 bg-red-900/10 border border-red-900/30 rounded-xl text-center">
                    <span className="text-2xl">⚠️</span>
                    <div>
                        <p className="text-sm font-bold text-red-400">משהו השתבש</p>
                        <p className="text-xs text-gray-500 mt-1">{this.state.error?.message || 'שגיאה לא ידועה'}</p>
                    </div>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition">
                        נסה שוב
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
