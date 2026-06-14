"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, RotateCcw, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";

interface Message {
  role: "user" | "assistant";
  content: string;
  chartData?: { type: string; data: Record<string, unknown>[]; xKey: string; yKey: string; label?: string };
  loading?: boolean;
}

// Quick-fire action categories
const QUICK_ACTIONS = [
  {
    category: "🚨 Urgent",
    color: "#EF4444",
    bg: "rgba(239,68,68,0.1)",
    questions: [
      "What needs to be restocked TODAY? Give me the exact items and quantities to order.",
      "Which items are at risk of stocking out this week? Prioritise by revenue impact.",
    ],
  },
  {
    category: "📊 Performance",
    color: "#2563EB",
    bg: "rgba(37,99,235,0.1)",
    questions: [
      "Which store is underperforming this week and why? What should we do?",
      "Give me a full weekly P&L summary — revenue by channel, vs last week.",
      "Compare Samsonite vs American Tourister performance this month.",
    ],
  },
  {
    category: "🔥 Opportunities",
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.1)",
    questions: [
      "What's my #1 revenue opportunity right now? Be specific.",
      "Which products are trending up that I should push harder?",
      "Which store has the most untapped potential and what should we do there?",
    ],
  },
  {
    category: "💰 Inventory",
    color: "#10B981",
    bg: "rgba(16,185,129,0.1)",
    questions: [
      "Show me dead stock — what's sitting unsold and costing us money?",
      "What should I markdown or promote to clear slow inventory?",
      "Which colours and sizes are overstocked across all stores?",
    ],
  },
];

const CHART_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899"];

function ChartBlock({ chart }: { chart: NonNullable<Message["chartData"]> }) {
  if (chart.type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={chart.data} margin={{ top: 5, right: 5, left: -20, bottom: 25 }}>
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-30} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 10, border: "1px solid var(--border)" }} />
          <Bar dataKey={chart.yKey} radius={[4, 4, 0, 0]}>
            {chart.data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={chart.data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 10, border: "1px solid var(--border)" }} />
          <Line type="monotone" dataKey={chart.yKey} stroke="#2563EB" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={170}>
        <PieChart>
          <Pie data={chart.data} dataKey={chart.yKey} nameKey={chart.xKey} cx="50%" cy="50%" outerRadius={60} innerRadius={32} paddingAngle={2}>
            {chart.data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 10, border: "1px solid var(--border)" }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return null;
}

export default function AskPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text?: string) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: q };
    const loadingMsg: Message = { role: "assistant", content: "", loading: true };
    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history: messages.filter((m) => !m.loading) }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: data.content || data.error || "No response", chartData: data.chartData },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "Something went wrong. Try again." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setMessages([]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(160deg, #0D1B2A 0%, #0f2d4a 60%, #1a3a5c 100%)", flexShrink: 0 }}>
        <div className="px-4 pt-12 pb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} style={{ color: "#A78BFA" }} />
              <h1 style={{ color: "white", fontSize: "1.25rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
                AI Analyst
              </h1>
            </div>
            <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", marginTop: 2 }}>
              Your personal retail intelligence advisor
            </p>
          </div>
          {messages.length > 0 && (
            <button onClick={reset} style={{ color: "rgba(255,255,255,0.5)", padding: "7px 12px", background: "rgba(255,255,255,0.08)", borderRadius: 10, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: "0.68rem" }}>
              <RotateCcw size={13} /> New chat
            </button>
          )}
        </div>
      </div>

      {/* Messages + suggestions */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {messages.length === 0 ? (
          <div style={{ padding: "16px 16px 100px" }}>
            {/* Category tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }} className="hide-scrollbar">
              {QUICK_ACTIONS.map((cat, i) => (
                <button key={i} onClick={() => setActiveCategory(i)} style={{
                  padding: "6px 14px", borderRadius: 20, fontSize: "0.7rem", fontWeight: 700,
                  border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  background: activeCategory === i ? cat.color : "var(--surface)",
                  color: activeCategory === i ? "white" : "var(--text3)",
                  transition: "all 0.15s",
                }}>
                  {cat.category}
                </button>
              ))}
            </div>

            {/* Questions for active category */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {QUICK_ACTIONS[activeCategory].questions.map((q) => (
                <button key={q} onClick={() => send(q)} style={{
                  textAlign: "left", padding: "13px 16px",
                  borderRadius: 14,
                  border: `1.5px solid ${QUICK_ACTIONS[activeCategory].color}40`,
                  background: QUICK_ACTIONS[activeCategory].bg,
                  cursor: "pointer", fontSize: "0.78rem",
                  color: "var(--text2)", lineHeight: 1.45,
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  transition: "all 0.12s",
                }}>
                  <span>{q}</span>
                  <Zap size={14} style={{ color: QUICK_ACTIONS[activeCategory].color, flexShrink: 0 }} />
                </button>
              ))}
            </div>

            <p style={{ fontSize: "0.62rem", color: "var(--text3)", textAlign: "center", marginTop: 20 }}>
              Or type your own question below
            </p>
          </div>
        ) : (
          <div style={{ padding: "12px 16px 100px", display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "assistant" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg, #7C3AED, #2563EB)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Sparkles size={11} style={{ color: "white" }} />
                    </div>
                    <span style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text3)" }}>AI Analyst</span>
                  </div>
                )}
                <div style={{
                  maxWidth: "90%",
                  background: msg.role === "user"
                    ? "linear-gradient(135deg, #1E3A8A, #2563EB)"
                    : "var(--surface)",
                  color: msg.role === "user" ? "white" : "var(--text)",
                  borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
                  padding: "12px 16px",
                  border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
                  fontSize: "0.8rem",
                  lineHeight: 1.55,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}>
                  {msg.loading ? (
                    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "3px 0" }}>
                      {[0, 1, 2].map((j) => (
                        <div key={j} style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: "linear-gradient(135deg, #7C3AED, #2563EB)",
                          animation: "pulse 1.2s infinite",
                          animationDelay: `${j * 0.2}s`,
                        }} />
                      ))}
                    </div>
                  ) : (
                    <>
                      <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
                      {msg.chartData && (
                        <div style={{ marginTop: 12, marginLeft: -4, marginRight: -4 }}>
                          {msg.chartData.label && (
                            <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text3)", marginBottom: 6, paddingLeft: 4 }}>
                              {msg.chartData.label}
                            </p>
                          )}
                          <ChartBlock chart={msg.chartData} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div style={{
        padding: "10px 16px 16px",
        borderTop: "1px solid var(--border)",
        background: "var(--surface)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything about your business…"
            rows={1}
            style={{
              flex: 1, padding: "11px 14px", borderRadius: 14, resize: "none",
              border: "1.5px solid var(--border)", background: "var(--bg)",
              fontSize: "0.8rem", outline: "none", lineHeight: 1.5,
              maxHeight: 90, overflow: "auto", color: "var(--text)",
            }}
          />
          <button onClick={() => send()} disabled={!input.trim() || loading} style={{
            width: 44, height: 44, borderRadius: 14, border: "none", cursor: "pointer",
            background: input.trim() && !loading
              ? "linear-gradient(135deg, #1E3A8A, #2563EB)"
              : "var(--border)",
            color: input.trim() && !loading ? "white" : "var(--text3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "all 0.15s",
            boxShadow: input.trim() && !loading ? "0 4px 12px rgba(37,99,235,0.4)" : "none",
          }}>
            <Send size={17} />
          </button>
        </div>
      </div>

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
