'use client';

import { useState, useEffect } from 'react';
import { Clock, Sun, Moon, Sunrise } from 'lucide-react';

interface Session {
  name: string;
  emoji: string;
  color: string;
  bgColor: string;
  startUTC: number; // Hour in UTC
  endUTC: number;   // Hour in UTC
}

const SESSIONS: Session[] = [
  { 
    name: 'Sydney', 
    emoji: '🦘', 
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/20 border-sky-500/40',
    startUTC: 21, // 9pm UTC = 8am Sydney (AEDT)
    endUTC: 6 
  },
  { 
    name: 'Tokyo', 
    emoji: '🗼', 
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/20 border-rose-500/40',
    startUTC: 0, // Midnight UTC = 9am Tokyo
    endUTC: 9 
  },
  { 
    name: 'London', 
    emoji: '🏛️', 
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20 border-amber-500/40',
    startUTC: 8, // 8am UTC = 8am London (GMT)
    endUTC: 17 
  },
  { 
    name: 'New York', 
    emoji: '🗽', 
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20 border-emerald-500/40',
    startUTC: 13, // 1pm UTC = 8am NY (EST)
    endUTC: 22 
  },
];

function isSessionOpen(session: Session, currentHour: number): boolean {
  if (session.startUTC < session.endUTC) {
    // Normal session (doesn't cross midnight)
    return currentHour >= session.startUTC && currentHour < session.endUTC;
  } else {
    // Session crosses midnight (like Sydney 21:00 - 06:00)
    return currentHour >= session.startUTC || currentHour < session.endUTC;
  }
}

function getTimeUntil(targetHour: number, currentHour: number, currentMinute: number): { hours: number; minutes: number } {
  let hoursUntil = targetHour - currentHour;
  if (hoursUntil <= 0) hoursUntil += 24;
  
  const minutesUntil = 60 - currentMinute;
  if (minutesUntil < 60) {
    hoursUntil -= 1;
  }
  
  return { 
    hours: hoursUntil < 0 ? hoursUntil + 24 : hoursUntil, 
    minutes: minutesUntil === 60 ? 0 : minutesUntil 
  };
}

function formatTimeUntil(hours: number, minutes: number): string {
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getSessionProgress(session: Session, currentHour: number, currentMinute: number): number {
  if (!isSessionOpen(session, currentHour)) return 0;
  
  let sessionLength: number;
  let elapsed: number;
  
  if (session.startUTC < session.endUTC) {
    sessionLength = session.endUTC - session.startUTC;
    elapsed = (currentHour - session.startUTC) + (currentMinute / 60);
  } else {
    sessionLength = (24 - session.startUTC) + session.endUTC;
    if (currentHour >= session.startUTC) {
      elapsed = (currentHour - session.startUTC) + (currentMinute / 60);
    } else {
      elapsed = (24 - session.startUTC) + currentHour + (currentMinute / 60);
    }
  }
  
  return Math.min(100, (elapsed / sessionLength) * 100);
}

export function TradingSessions() {
  const [now, setNow] = useState(new Date());
  
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  
  const openSessions = SESSIONS.filter(s => isSessionOpen(s, currentHour));
  const closedSessions = SESSIONS.filter(s => !isSessionOpen(s, currentHour));
  
  // Find next session to open
  const nextSession = closedSessions.sort((a, b) => {
    const aTime = getTimeUntil(a.startUTC, currentHour, currentMinute);
    const bTime = getTimeUntil(b.startUTC, currentHour, currentMinute);
    return (aTime.hours * 60 + aTime.minutes) - (bTime.hours * 60 + bTime.minutes);
  })[0];
  
  // Find next session to close
  const nextClosing = openSessions.length > 0 
    ? openSessions.sort((a, b) => {
        const aTime = getTimeUntil(a.endUTC, currentHour, currentMinute);
        const bTime = getTimeUntil(b.endUTC, currentHour, currentMinute);
        return (aTime.hours * 60 + aTime.minutes) - (bTime.hours * 60 + bTime.minutes);
      })[0]
    : null;
  
  const nextSessionTime = nextSession 
    ? getTimeUntil(nextSession.startUTC, currentHour, currentMinute)
    : null;
  
  const nextClosingTime = nextClosing
    ? getTimeUntil(nextClosing.endUTC, currentHour, currentMinute)
    : null;
  
  // Determine market activity level
  const activityLevel = openSessions.length >= 2 ? 'high' : openSessions.length === 1 ? 'normal' : 'low';
  const hasOverlap = openSessions.length >= 2;
  
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Current Time */}
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-zinc-500" />
          <span className="text-xs font-mono text-zinc-400">
            {now.toUTCString().slice(17, 25)} UTC
          </span>
        </div>
        
        {/* Open Sessions */}
        <div className="flex items-center gap-2">
          {openSessions.length > 0 ? (
            <>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Open:</span>
              <div className="flex items-center gap-1.5">
                {openSessions.map(session => {
                  const progress = getSessionProgress(session, currentHour, currentMinute);
                  return (
                    <div 
                      key={session.name}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${session.bgColor}`}
                      title={`${session.name} - ${Math.round(100 - progress)}% remaining`}
                    >
                      <span>{session.emoji}</span>
                      <span className={`text-xs font-medium ${session.color}`}>
                        {session.name}
                      </span>
                      <div className="w-8 h-1 bg-zinc-700 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${session.color.replace('text-', 'bg-')}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasOverlap && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-500/20 text-orange-400 border border-orange-500/40 animate-pulse">
                  OVERLAP
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-zinc-500">Weekend / No major sessions</span>
          )}
        </div>
        
        {/* Next Events */}
        <div className="flex items-center gap-3 text-xs">
          {nextClosing && nextClosingTime && (
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Moon size={12} className="text-zinc-500" />
              <span>{nextClosing.emoji} closes in</span>
              <span className="font-mono text-zinc-300">
                {formatTimeUntil(nextClosingTime.hours, nextClosingTime.minutes)}
              </span>
            </div>
          )}
          
          {nextSession && nextSessionTime && (
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Sunrise size={12} className="text-zinc-500" />
              <span>{nextSession.emoji} opens in</span>
              <span className="font-mono text-emerald-400">
                {formatTimeUntil(nextSessionTime.hours, nextSessionTime.minutes)}
              </span>
            </div>
          )}
        </div>
        
        {/* Activity Indicator */}
        <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${
          activityLevel === 'high' 
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
            : activityLevel === 'normal'
            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
            : 'bg-zinc-700/50 text-zinc-500 border border-zinc-600/30'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            activityLevel === 'high' ? 'bg-emerald-400 animate-pulse' :
            activityLevel === 'normal' ? 'bg-blue-400' : 'bg-zinc-500'
          }`} />
          {activityLevel === 'high' ? 'High Activity' : activityLevel === 'normal' ? 'Active' : 'Low Activity'}
        </div>
      </div>
    </div>
  );
}
