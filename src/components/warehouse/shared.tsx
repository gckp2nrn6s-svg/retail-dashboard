"use client";
import { useState, useEffect, useRef } from "react";
import { Copy, Check, Loader2 } from "lucide-react";

// ── Design tokens (consistent with the rest of the dashboard) ────────────────
export const WH_ACCENT = "#0D9488"; // teal — warehousing
export const fmtInt = (n: number | string | null | undefined) => Math.round(Number(n) || 0).toLocaleString();

// Client-safe store names (do NOT import @/lib/db here — it pulls in pg/Node).
const STORE_NAMES: Record<string, string> = {
  ALMAZA: "Almaza City Center", CCA: "Alexandria", "CF-HOS": "Cairo Festival City",
  CSTARS: "City Stars", P90: "Point 90", MOA: "Mall of Arabia", MOE: "Mall of Egypt",
  HO: "Head Office", NOON: "Noon", JUMIA: "Jumia", AMAZON: "Amazon Egypt",
  "GO SPORT1": "Go Sport", SPINNEYS: "Spinneys", "DUTY FREE": "Duty Free", "FOUR SEASO": "Four Seasons",
  ATCFC: "AT Cairo Festival", ATMADI: "AT Madinaty", "AMAZON BAN": "Amazon Banha", "AMAZON KAM": "Amazon Kamal",
};
export const storeName = (code: string) => STORE_NAMES[code] ?? code;

export interface WHLine { input: string; item_no: string | null; description: string | null; qty: number; matched: boolean }

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="card" style={{ padding: "16px 20px", ...style }}>{children}</div>;
}

// ── Horizontal sub-tab bar ───────────────────────────────────────────────────
export function SubTabBar({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px", background: "var(--surface3)", borderRadius: 14 }}>
      {tabs.map(t => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "none", cursor: "pointer",
            background: on ? "var(--surface)" : "transparent", color: on ? "var(--text)" : "var(--text3)",
            fontWeight: on ? 700 : 600, fontSize: "0.78rem", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.12s",
          }}>
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span style={{ fontSize: "0.6rem", fontWeight: 800, background: WH_ACCENT, color: "white", borderRadius: 20, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Copy button (copies text, flashes "Copied") ──────────────────────────────
export function CopyButton({ text, label = "Copy", style }: { text: string; label?: string; style?: React.CSSProperties }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "none", cursor: "pointer", background: done ? "#10B981" : WH_ACCENT, color: "white", fontWeight: 700, fontSize: "0.78rem", ...style }}>
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? "Copied" : label}
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} style={{ animation: "spin 0.8s linear infinite", color: "var(--text4)" }} />;
}
export function Empty({ icon = "📦", title, sub }: { icon?: string; title: string; sub?: string }) {
  return (
    <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--text4)" }}>
      <p style={{ fontSize: "2rem", marginBottom: 10 }}>{icon}</p>
      <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text2)" }}>{title}</p>
      {sub && <p style={{ fontSize: "0.74rem", color: "var(--text3)", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

// ── Simple date-range filter (from / to) ─────────────────────────────────────
export function DateFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const ip = { padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.72rem", background: "var(--bg)", color: "var(--text)", outline: "none" } as React.CSSProperties;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="date" value={from} onChange={e => onChange(e.target.value, to)} style={ip} />
      <span style={{ color: "var(--text4)", fontSize: "0.7rem" }}>→</span>
      <input type="date" value={to} onChange={e => onChange(from, e.target.value)} style={ip} />
    </div>
  );
}

// ── Parse pasted/typed lines into { code, qty } ──────────────────────────────
// Handles: tab-separated (Excel), "<sku with spaces>  <qty>", comma-separated.
// The SKU itself can contain spaces, so qty = the trailing numeric token.
export function parseLines(text: string): { code: string; qty: number }[] {
  const out: { code: string; qty: number }[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (line.includes("\t")) {
      const parts = line.split("\t").map(s => s.trim()).filter(Boolean);
      const qty = parseFloat(parts[parts.length - 1]);
      out.push({ code: parts.slice(0, -1).join(" ").trim() || parts[0], qty: isNaN(qty) ? 0 : qty });
      continue;
    }
    const m = line.match(/^(.*?)[\s,]+([\d.]+)\s*$/);
    if (m) out.push({ code: m[1].trim(), qty: parseFloat(m[2]) });
    else out.push({ code: line, qty: 0 });
  }
  return out.filter(p => p.code);
}

// ── LineEntry — paste/type item|SKU + qty, live-resolved to item_no+description ─
// Calls onChange with the resolved lines whenever they change.
export function LineEntry({ onChange, placeholder }: { onChange: (lines: WHLine[]) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const [lines, setLines] = useState<WHLine[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const parsed = parseLines(text);
      if (!parsed.length) { setLines([]); onChange([]); return; }
      setLoading(true);
      try {
        const r = await fetch("/api/warehouse/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codes: parsed.map(p => p.code) }) }).then(x => x.json());
        const resolved: WHLine[] = parsed.map((p, i) => ({
          input: p.code, qty: p.qty,
          item_no: r.resolved?.[i]?.item_no ?? null,
          description: r.resolved?.[i]?.description ?? null,
          matched: !!r.resolved?.[i]?.matched,
        }));
        setLines(resolved); onChange(resolved);
      } finally { setLoading(false); }
    }, 400);
    return () => clearTimeout(timer.current);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const matched = lines.filter(l => l.matched && l.qty > 0);
  const issues = lines.filter(l => !l.matched || l.qty <= 0);
  const totalQty = matched.reduce((s, l) => s + l.qty, 0);

  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
        placeholder={placeholder || "Paste or type one per line:\n  gm3 09 004   5\n  20942        3"}
        style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.82rem", fontFamily: "ui-monospace, monospace", resize: "vertical", outline: "none", lineHeight: 1.6 }} />
      {lines.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
            <thead><tr style={{ background: "var(--surface3)" }}>
              {["Entered", "Item no.", "Description", "Qty", ""].map((h, i) => (
                <th key={i} style={{ padding: "8px 12px", textAlign: i === 3 ? "right" : "left", fontSize: "0.58rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border)", background: l.matched && l.qty > 0 ? "transparent" : "rgba(245,158,11,0.07)" }}>
                  <td style={{ padding: "7px 12px", color: "var(--text3)", fontFamily: "ui-monospace, monospace" }}>{l.input}</td>
                  <td style={{ padding: "7px 12px", fontWeight: 700, color: "var(--text)" }}>{l.item_no ?? "—"}</td>
                  <td style={{ padding: "7px 12px", color: "var(--text2)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.description ?? (l.matched ? "" : "not found")}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{l.qty || "—"}</td>
                  <td style={{ padding: "7px 12px" }}>{l.matched && l.qty > 0 ? <Check size={13} style={{ color: "#10B981" }} /> : <span style={{ fontSize: "0.6rem", color: "#F59E0B", fontWeight: 700 }}>{!l.matched ? "no match" : "qty?"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, fontSize: "0.72rem", color: "var(--text3)" }}>
        {loading && <Spinner size={13} />}
        <span><strong style={{ color: "var(--text)" }}>{matched.length}</strong> matched · <strong style={{ color: "var(--text)" }}>{fmtInt(totalQty)}</strong> units</span>
        {issues.length > 0 && <span style={{ color: "#F59E0B", fontWeight: 600 }}>⚠ {issues.length} need attention</span>}
      </div>
    </div>
  );
}
