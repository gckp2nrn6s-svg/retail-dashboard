"use client";
import { useState, useCallback } from "react";
import { Card, LineEntry, Spinner, WH_ACCENT, fmtInt, MovementReceipt, type WHLine, type MoveRow } from "@/components/warehouse/shared";
import { Plus, Minus } from "lucide-react";

type Dir = "add" | "deduct";

export default function AdjustTab() {
  const [dir, setDir] = useState<Dir>("add");
  const [lines, setLines] = useState<WHLine[]>([]);
  const [reason, setReason] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [preview, setPreview] = useState<MoveRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ units: number; lines: number; adjustmentId: number | string; direction: Dir } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matched = lines.filter(l => l.matched && l.qty > 0 && l.item_no);
  const sign = dir === "add" ? 1 : -1;

  const review = useCallback(async () => {
    if (!matched.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const moves = matched.map(l => ({ item_no: l.item_no!, delta: sign * l.qty }));
      const r = await fetch("/api/warehouse/movement-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ moves }) }).then(x => x.json());
      if (r.rows?.length) setPreview(r.rows); else setError("Couldn't preview the change.");
    } catch { setError("Couldn't preview the change."); } finally { setBusy(false); }
  }, [matched, sign]);

  const confirm = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/warehouse/adjust", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction: dir, reason: reason.trim() || undefined, lines: matched.map(l => ({ item_no: l.item_no, qty: l.qty })) }) }).then(x => x.json());
      if (r.ok) {
        setResult({ units: r.units, lines: r.lines, adjustmentId: r.adjustmentId, direction: dir });
        setPreview(null); setReason(""); setLines([]); setFormKey(k => k + 1);
      } else setError(r.error || "Adjustment failed.");
    } catch { setError("Adjustment failed."); } finally { setBusy(false); }
  }, [dir, reason, matched]);

  const label = { fontSize: "0.6rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" } as React.CSSProperties;
  const ip = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none" } as React.CSSProperties;
  const canReview = matched.length > 0 && !busy;

  return (
    <Card style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <p style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Manual stock adjustment</p>
          <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>Correct HO on-hand by hand — recounts, damages, found stock. You'll see the before → after before anything changes.</p>
        </div>

        {/* Add vs Deduct */}
        <div>
          <span style={label}>Direction</span>
          <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--surface3)", borderRadius: 12, maxWidth: 360 }}>
            {([["add", "Add", Plus], ["deduct", "Deduct", Minus]] as const).map(([key, text, Icon]) => {
              const on = key === dir;
              const tone = key === "add" ? "#10B981" : "#EF4444";
              return (
                <button key={key} onClick={() => { setDir(key); setResult(null); }} style={{
                  flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                  background: on ? tone : "transparent", color: on ? "white" : "var(--text3)", fontWeight: on ? 700 : 600, fontSize: "0.8rem", transition: "all 0.12s",
                }}>
                  <Icon size={15} strokeWidth={2.5} /> {text}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span style={label}>Items to {dir === "add" ? "add" : "deduct"}</span>
          <LineEntry key={formKey} onChange={setLines} />
        </div>

        <div>
          <span style={label}>Reason <span style={{ color: "var(--text4)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(recommended)</span></span>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. physical recount, damaged units, found stock" style={ip} />
        </div>

        {result && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 12, padding: "11px 16px" }}>
            <span style={{ fontSize: "1.1rem" }}>✓</span>
            <span style={{ fontSize: "0.78rem", color: "#10B981", fontWeight: 700 }}>
              {result.direction === "add" ? "Added" : "Deducted"} {fmtInt(result.units)} {result.units === 1 ? "unit" : "units"} across {result.lines} {result.lines === 1 ? "line" : "lines"} · adjustment #{result.adjustmentId}
            </span>
          </div>
        )}
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "11px 16px" }}>
            <span style={{ fontSize: "0.78rem", color: "#EF4444", fontWeight: 700 }}>⚠ {error}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={review} disabled={!canReview} style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 11, border: "none",
            cursor: canReview ? "pointer" : "not-allowed", background: canReview ? WH_ACCENT : "var(--surface3)",
            color: canReview ? "white" : "var(--text4)", fontWeight: 700, fontSize: "0.82rem", transition: "all 0.12s",
          }}>
            {busy && !preview && <Spinner size={15} />}
            Review change
          </button>
          {matched.length > 0 && (
            <span style={{ fontSize: "0.7rem", color: "var(--text3)" }}>
              {matched.length} {matched.length === 1 ? "line" : "lines"} · {fmtInt(matched.reduce((s, l) => s + l.qty, 0))} units to {dir === "add" ? "add" : "deduct"}
            </span>
          )}
        </div>
      </div>

      {preview && (
        <MovementReceipt
          title={dir === "add" ? "Add to HO stock" : "Deduct from HO stock"}
          subtitle={reason.trim() ? `Reason: ${reason.trim()}` : "Confirm the on-hand change below."}
          rows={preview}
          busy={busy}
          confirmLabel={dir === "add" ? "Confirm — add" : "Confirm — deduct"}
          onConfirm={confirm}
          onCancel={() => { if (!busy) setPreview(null); }}
        />
      )}
    </Card>
  );
}
