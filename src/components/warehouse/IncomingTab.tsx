"use client";
import { useState, useCallback } from "react";
import { Card, LineEntry, Spinner, WH_ACCENT, fmtInt, type WHLine } from "@/components/warehouse/shared";

type Kind = "outside" | "factory";

const KINDS: { key: Kind; label: string; sub: string }[] = [
  { key: "outside", label: "Outside", sub: "Imported shipment" },
  { key: "factory", label: "Factory", sub: "Transfer from local factory" },
];

interface Result { ok: true; receiptId: number | string; lines: number; units: number }

export default function IncomingTab() {
  const [kind, setKind] = useState<Kind>("outside");
  const [lines, setLines] = useState<WHLine[]>([]);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0); // bump to force-remount LineEntry / reset

  const matchedLines = lines.filter(l => l.matched && l.qty > 0 && l.item_no);
  const canSubmit = matchedLines.length > 0 && !submitting;

  const submit = useCallback(async () => {
    if (matchedLines.length === 0 || submitting) return;
    setSubmitting(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/warehouse/receive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
          lines: matchedLines.map(l => ({ item_no: l.item_no, qty: l.qty })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.error) {
        setError(data?.error || "Couldn't receive this shipment. Please try again.");
        return;
      }
      setResult(data as Result);
      // reset form
      setReference(""); setNote(""); setLines([]); setFormKey(k => k + 1);
    } catch {
      setError("Network error — the request didn't go through.");
    } finally {
      setSubmitting(false);
    }
  }, [kind, reference, note, matchedLines, submitting]);

  const ip = {
    width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)",
    background: "var(--bg)", color: "var(--text)", fontSize: "0.82rem", outline: "none",
  } as React.CSSProperties;
  const label = { fontSize: "0.6rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" } as React.CSSProperties;

  return (
    <Card style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Header */}
        <div>
          <p style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Incoming shipment</p>
          <p style={{ fontSize: "0.7rem", color: "var(--text3)", marginTop: 2 }}>Records an arrival that adds to HO on-hand stock.</p>
        </div>

        {/* Segmented control: Outside vs Factory */}
        <div>
          <span style={label}>Source</span>
          <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--surface3)", borderRadius: 12, maxWidth: 420 }}>
            {KINDS.map(k => {
              const on = k.key === kind;
              return (
                <button key={k.key} onClick={() => setKind(k.key)} style={{
                  flex: 1, padding: "9px 12px", borderRadius: 9, border: "none", cursor: "pointer", textAlign: "center",
                  background: on ? WH_ACCENT : "transparent", color: on ? "white" : "var(--text3)",
                  fontWeight: on ? 700 : 600, fontSize: "0.78rem", transition: "all 0.12s",
                  boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
                }}>
                  <div>{k.label}</div>
                  <div style={{ fontSize: "0.58rem", fontWeight: 500, marginTop: 2, color: on ? "rgba(255,255,255,0.8)" : "var(--text4)" }}>{k.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Line entry */}
        <div>
          <span style={label}>Items received</span>
          <LineEntry key={formKey} onChange={setLines} />
        </div>

        {/* Reference + Note */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <span style={label}>Reference <span style={{ color: "var(--text4)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span></span>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="PO / invoice / shipment ref" style={ip} />
          </div>
          <div>
            <span style={label}>Note <span style={{ color: "var(--text4)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span></span>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything worth remembering" style={ip} />
          </div>
        </div>

        {/* Banners */}
        {result && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 12, padding: "11px 16px" }}>
            <span style={{ fontSize: "1.1rem" }}>✓</span>
            <span style={{ fontSize: "0.78rem", color: "#10B981", fontWeight: 700 }}>
              Received {fmtInt(result.units)} {result.units === 1 ? "unit" : "units"} across {result.lines} {result.lines === 1 ? "line" : "lines"} into HO stock · receipt #{result.receiptId}
            </span>
          </div>
        )}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "11px 16px" }}>
            <span style={{ fontSize: "0.78rem", color: "#EF4444", fontWeight: 700 }}>⚠ {error}</span>
          </div>
        )}

        {/* Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={submit} disabled={!canSubmit} style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 11, border: "none",
            cursor: canSubmit ? "pointer" : "not-allowed",
            background: canSubmit ? WH_ACCENT : "var(--surface3)",
            color: canSubmit ? "white" : "var(--text4)",
            fontWeight: 700, fontSize: "0.82rem", transition: "all 0.12s",
          }}>
            {submitting && <Spinner size={15} />}
            {submitting ? "Receiving…" : "Receive into stock"}
          </button>
          {matchedLines.length > 0 && !submitting && (
            <span style={{ fontSize: "0.7rem", color: "var(--text3)" }}>
              {matchedLines.length} {matchedLines.length === 1 ? "line" : "lines"} · {fmtInt(matchedLines.reduce((s, l) => s + l.qty, 0))} units ready
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
