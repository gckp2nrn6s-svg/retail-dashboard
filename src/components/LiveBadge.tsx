"use client";
import { useState, useEffect } from "react";

interface LiveBadgeProps {
  lastUpdated: Date | null;
  refreshing?: boolean;
}

export function LiveBadge({ lastUpdated, refreshing = false }: LiveBadgeProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  function ago(d: Date) {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: 8, height: 8 }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          background: refreshing ? "#F59E0B" : "#10B981",
          animation: "livePulse 2s ease-in-out infinite",
        }} />
        {!refreshing && (
          <div style={{
            position: "absolute", inset: -2, borderRadius: "50%",
            background: "rgba(16,185,129,0.2)",
            animation: "liveRipple 2s ease-out infinite",
          }} />
        )}
      </div>
      <span style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>
        {refreshing ? "Refreshing…" : lastUpdated ? `Updated ${ago(lastUpdated)}` : "Live"}
      </span>
      <style>{`
        @keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.8)} }
        @keyframes liveRipple { 0%{opacity:0.4;transform:scale(0.8)} 100%{opacity:0;transform:scale(2.2)} }
      `}</style>
    </div>
  );
}
