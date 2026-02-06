'use client';

import { LayoutDashboard, Signal, BarChart3, FlaskConical } from 'lucide-react';

export type TabId = 'dashboard' | 'signals' | 'stats' | 'backtest';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { id: 'signals', label: 'Signals', icon: <Signal size={16} /> },
  { id: 'stats', label: 'Stats', icon: <BarChart3 size={16} /> },
  { id: 'backtest', label: 'Backtest', icon: <FlaskConical size={16} /> },
];

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  signalCount?: number;
  openSignalCount?: number;
}

export function TabNav({ activeTab, onTabChange, signalCount = 0, openSignalCount = 0 }: TabNavProps) {
  return (
    <div className="flex items-center gap-1 bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-1">
      {TABS.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${activeTab === tab.id
              ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
            }
          `}
        >
          {tab.icon}
          <span>{tab.label}</span>
          
          {/* Badge for signals tab */}
          {tab.id === 'signals' && openSignalCount > 0 && (
            <span className={`
              px-1.5 py-0.5 text-[10px] font-bold rounded-full
              ${activeTab === 'signals' 
                ? 'bg-white/20 text-white' 
                : 'bg-amber-500 text-white animate-pulse'
              }
            `}>
              {openSignalCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
