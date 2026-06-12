"use client";
import { useState } from "react";
import { Sparkles, CheckCircle, AlertCircle, Edit2, Check, X } from "lucide-react";

interface SchemaItem {
  id: string;
  rawValue: string;
  dimension: string;
  mappedValue: string;
  confidence: number;
  approved: boolean;
}

type GroupedSchema = Record<string, SchemaItem[]>;

const DIMENSIONS = ["category", "line_name", "colour", "size", "material"];
const DIM_LABELS: Record<string, string> = {
  category: "Category",
  line_name: "Line name",
  colour: "Colour",
  size: "Size",
  material: "Material",
};

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? "bg-green-100 text-green-700" : pct >= 70 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return <span className={`text-xs px-1.5 py-0.5 rounded-full ${color}`}>{pct}%</span>;
}

function EditableRow({ item, onSave }: { item: SchemaItem; onSave: (id: string, val: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.mappedValue);

  return (
    <div className={`flex items-center gap-2 py-2 px-3 ${item.approved ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 truncate">{item.rawValue}</p>
        {editing ? (
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="text-sm border-b border-blue-400 outline-none w-full bg-transparent"
          />
        ) : (
          <p className="text-sm font-medium truncate">{item.mappedValue}</p>
        )}
      </div>
      <ConfidenceBadge score={item.confidence} />
      {editing ? (
        <div className="flex gap-1 shrink-0">
          <button onClick={() => { onSave(item.id, val); setEditing(false); }} className="text-green-600"><Check size={14} /></button>
          <button onClick={() => { setVal(item.mappedValue); setEditing(false); }} className="text-gray-400"><X size={14} /></button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-gray-300 shrink-0"><Edit2 size={14} /></button>
      )}
    </div>
  );
}

export default function SchemaReview() {
  const [status, setStatus] = useState<"idle" | "scanning" | "review" | "approved">("idle");
  const [schema, setSchema] = useState<GroupedSchema>({});
  const [stats, setStats] = useState<{ scanned: number; categorised: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeDim, setActiveDim] = useState("category");

  async function runScan() {
    setStatus("scanning");
    try {
      const res = await fetch("/api/schema/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStats({ scanned: data.scanned, categorised: data.categorised });

      const schemaRes = await fetch("/api/schema/approve");
      const grouped: GroupedSchema = await schemaRes.json();
      setSchema(grouped);
      setStatus("review");
    } catch (e) {
      alert("Scan failed: " + (e as Error).message);
      setStatus("idle");
    }
  }

  async function handleEdit(id: string, mappedValue: string) {
    await fetch("/api/schema/approve", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, mappedValue }),
    });
    setSchema((prev) => {
      const next = { ...prev };
      for (const dim of Object.keys(next)) {
        next[dim] = next[dim].map((item) => item.id === id ? { ...item, mappedValue } : item);
      }
      return next;
    });
  }

  async function approveAll() {
    setSaving(true);
    const res = await fetch("/api/schema/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approveAll: true }),
    });
    if (res.ok) setStatus("approved");
    setSaving(false);
  }

  if (status === "approved") {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-screen gap-4">
        <CheckCircle size={48} className="text-green-500" />
        <h2 className="text-lg font-semibold">Schema approved</h2>
        <p className="text-sm text-gray-500 text-center">Your item categorisation is locked in. The dashboard AI will now use this schema for all analysis.</p>
        <a href="/dashboard" className="mt-2 px-6 py-2.5 bg-blue-600 text-white rounded-full text-sm font-medium">
          Go to dashboard
        </a>
      </div>
    );
  }

  if (status === "idle") {
    return (
      <div className="p-6 flex flex-col min-h-screen">
        <h1 className="text-lg font-semibold mb-1">Item schema setup</h1>
        <p className="text-sm text-gray-500 mb-6">
          Before the dashboard can analyse stock by category, colour, size, material, and line name — the AI needs to scan your full item list and propose a categorisation. You review and approve it.
        </p>
        <div className="space-y-3 mb-8">
          {[
            { step: "1", label: "AI scans all items from NAV", desc: "Reads every item code and description" },
            { step: "2", label: "Proposes categorisation schema", desc: "Groups by category, colour, size, material, line" },
            { step: "3", label: "You review and edit", desc: "Fix anything that looks wrong" },
            { step: "4", label: "Approve and lock", desc: "Schema powers all AI analysis going forward" },
          ].map(({ step, label, desc }) => (
            <div key={step} className="flex gap-3 items-start">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center justify-center shrink-0 mt-0.5">{step}</span>
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={runScan}
          className="w-full py-3.5 bg-blue-600 text-white rounded-2xl font-medium flex items-center justify-center gap-2"
        >
          <Sparkles size={16} />
          Start AI scan
        </button>
      </div>
    );
  }

  if (status === "scanning") {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center">
          <Sparkles size={24} className="text-blue-600 animate-pulse" />
        </div>
        <h2 className="text-base font-semibold">Scanning your item list...</h2>
        <p className="text-sm text-gray-400 text-center">AI is reading every item from NAV and proposing categories, colours, sizes, materials, and line names.</p>
        <p className="text-xs text-gray-300">This takes 20–40 seconds</p>
      </div>
    );
  }

  const activeItems = schema[activeDim] || [];
  const lowConfidence = activeItems.filter((i) => i.confidence < 0.8);

  return (
    <div className="flex flex-col h-screen">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-base font-semibold">Review schema</h1>
          {lowConfidence.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <AlertCircle size={12} />
              {lowConfidence.length} need review
            </span>
          )}
        </div>
        {stats && (
          <p className="text-xs text-gray-400">{stats.scanned} items scanned · {stats.categorised} categorised</p>
        )}
      </div>

      <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-gray-100">
        {DIMENSIONS.map((dim) => {
          const lowConf = (schema[dim] || []).filter((i) => i.confidence < 0.8).length;
          return (
            <button
              key={dim}
              onClick={() => setActiveDim(dim)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeDim === dim
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-gray-200 text-gray-600"
              }`}
            >
              {DIM_LABELS[dim]}
              {lowConf > 0 && <span className="ml-1 text-amber-400">•</span>}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {activeItems.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No items in this dimension</p>
        ) : (
          activeItems.map((item) => (
            <EditableRow key={item.id} item={item} onSave={handleEdit} />
          ))
        )}
      </div>

      <div className="p-4 border-t border-gray-100">
        <button
          onClick={approveAll}
          disabled={saving}
          className="w-full py-3.5 bg-green-600 text-white rounded-2xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <CheckCircle size={16} />
          {saving ? "Saving..." : "Approve schema & activate"}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">You can re-run the scan anytime to update</p>
      </div>
    </div>
  );
}
