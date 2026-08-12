'use client';

import { useEffect, useRef, useState } from 'react';
import { useConflictFeed, useTick } from '@/lib/hooks';
import { playAlertSound } from '@/lib/generateAlert';
import { useConflict } from '@/lib/conflicts/context';

interface AlertData {
  status: 'ACTIVE' | 'CLEAR';
  activeCount: number;
  alerts: {
    type: string;
    threat: string;
    active: boolean;
  }[];
  lastChecked: string;
}

interface DroneTrack {
  id: string;
  label: string;
  color: string;
  heading: number;
  count: number;
  place: string;
  time: string;
}

interface DroneData {
  drones: DroneTrack[];
  count: number;
  ballisticThreat: boolean;
}

interface FlightDataResponse {
  total: number;
  military: number;
}

interface ThreatBarProps {
  className?: string;
}

export default function ThreatBar({ className = '' }: ThreatBarProps) {
  const { config } = useConflict();
  
  // Polling
  const { data: alertsData } = useConflictFeed<AlertData>('/api/alerts', 15000);
  const { data: droneData } = useConflictFeed<DroneData>('/api/drones', 20000);
  const { data: flightData } = useConflictFeed<FlightDataResponse>('/api/flights', 180000);

  // States
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const prevStatus = useRef<string>('CLEAR');
  
  // Session timer
  const [startTime] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.floor((now - startTime) / 1000);
  const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  const uptime = `${m}:${s}`;

  // Interaction listener for audio
  useEffect(() => {
    const handleInteraction = () => {
      setHasInteracted(true);
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // Notifications and Sound
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!alertsData) return;
    
    if (alertsData.status === 'ACTIVE' && prevStatus.current === 'CLEAR' && soundEnabled && hasInteracted) {
      playAlertSound('urgent');
      
      if (Notification.permission === 'granted') {
        new Notification('IRONSIGHT ALERT', {
          body: `${alertsData.activeCount} active alert(s) - ${alertsData.alerts[0]?.type}: ${alertsData.alerts[0]?.threat}`,
          icon: '/favicon.ico',
          tag: 'ironsight-alert',
        });
      }
    }
    
    prevStatus.current = alertsData.status;
  }, [alertsData, soundEnabled, hasInteracted]);

  // Derived state
  const isActive = alertsData?.status === 'ACTIVE';
  const activeCount = alertsData?.activeCount || 0;
  const types = Array.from(new Set(alertsData?.alerts?.map(a => a.type) || [])).join('/');
  
  const dronesCount = droneData?.drones?.length || 0;
  const isBallistic = droneData?.ballisticThreat || false;
  
  const milFlights = flightData?.military || 0;
  
  const hasThreat = isActive || dronesCount > 0 || isBallistic;

  return (
    <div 
      className={`panel flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 py-2 gap-2 ${isActive ? 'alert-flash border-[var(--red)]' : 'border-[var(--border-color)]'} ${className}`}
      style={hasThreat ? { boxShadow: '0 0 15px rgba(255, 51, 102, 0.2)' } : {}}
      role="region"
      aria-label="Threat Status Bar"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span 
            className="status-dot"
            style={{
              background: hasThreat ? 'var(--red)' : 'var(--green)',
              animation: hasThreat ? 'pulse-dot 0.5s ease-in-out infinite' : undefined,
              width: '8px',
              height: '8px',
            }}
          />
          <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: hasThreat ? 'var(--red)' : 'var(--cyan)' }}>
            {isActive ? `THREAT ACTIVE: ${activeCount} ALERT${activeCount !== 1 ? 'S' : ''}` : 'SYSTEM NOMINAL'}
          </span>
        </div>

        {isActive && types && (
          <div className="text-[10px] bg-red-900/50 px-1.5 py-0.5 border border-red-500/50 rounded text-[var(--red)] font-bold">
            {types}
          </div>
        )}

        {/* Drones */}
        {dronesCount > 0 && (
          <div className={`text-[10px] px-1.5 py-0.5 border rounded font-bold ${isBallistic ? 'bg-amber-900/50 border-amber-500/50 text-[var(--amber)] highlight-pulse' : 'bg-red-900/30 border-red-800/50 text-[var(--red)]'}`}>
            {dronesCount} TRK {isBallistic && ' · BALLISTIC WARNING'}
          </div>
        )}
        
        {/* Mil Flights */}
        {milFlights > 0 && (
          <div className="text-[10px] text-[var(--text-secondary)] border border-[var(--border-color)] px-1.5 py-0.5 rounded bg-[var(--bg-panel-header)]">
            MIL AIR: {milFlights}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
        <div className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-panel-header)] px-2 py-0.5 rounded border border-[var(--border-color)]" title="Session Uptime">
          T+{uptime}
        </div>

        <button
          onClick={() => {
            setSoundEnabled(!soundEnabled);
            if (!soundEnabled && hasInteracted) {
              playAlertSound('ping');
            }
          }}
          className="text-[10px] px-2 py-0.5 rounded border transition-colors flex items-center gap-1.5 cursor-pointer"
          style={{
            color: soundEnabled ? 'var(--cyan)' : 'var(--text-secondary)',
            borderColor: soundEnabled ? 'var(--cyan)' : 'var(--border-color)',
            background: soundEnabled ? 'rgba(0,212,255,0.1)' : 'transparent',
          }}
          title={soundEnabled ? 'Sound alerts ON' : 'Sound alerts OFF'}
          aria-label={soundEnabled ? 'Disable sound alerts' : 'Enable sound alerts'}
          aria-pressed={soundEnabled}
        >
          <span>{soundEnabled ? '🔔' : '🔕'}</span>
          <span className="font-bold">{soundEnabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
  );
}
