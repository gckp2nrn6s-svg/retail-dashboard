"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, RotateCcw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";

interface Message {
  role: "user" | "assistant";
  content: string;
  chartData?: { type: string; data: Record<string, unknown>[]; xKey: string; yKey: string; label?: string };
  loading?: boolean;
}

const SUGGESTIONS = [
  "What are my top 10 selling products this month?",
  "Which stores are underperforming vs last month?",
  "What's at risk of stocking out in the next 2 weeks?",
  "Show me Samsonite revenue trend over 90 days",
  "Which colours sell best in luggage?",
  "Compare retail vs online sales this year",
  "What's my slowest moving inventory by value?",
  "Which category has the best margin?",
];

const CHART_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899"];

function ChartBlock({ chart }: { chart: NonNullable<Message["chartData"]> }) {
  if (chart.type === "bar") {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chart.data} margin={{ top: 5, right: 5, left: -20, bottom: 20 }}>
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} angle={-30} textAnchor="end" interval={0} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
          <Bar dataKey={chart.yKey} fill="#2563EB" radius={[3, 3, 0, 0]}>
            {chart.data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={chart.data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <XAxis dataKey={chart.xKey} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
          <Line type="monotone" dataKey={chart.yKey} stroke="#2563EB" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={chart.data} dataKey={chart.yKey} nameKey={chart.xKey} cx="50%" cy="50%" outerRadius={55} innerRadius={30} paddingAngle={2}>
            {chart.data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: "0.65rem", borderRadius: 8, border: "1px solid var(--border)" }} />
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
      setMessages((prev) => [...prev.slice(0, -1), { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => setMessages([]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D1B2A 0%, #1a3a5c 100%)", flexShrink: 0 }}>
        <div className="px-4 pt-12 pb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} style={{ color: "#60A5FA" }} />
              <h1 style={{ color: "white", fontSize: "1.2rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Ask AI</h1>
            </div>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: 2 }}>
              Ask anything about your sales, stock, or products
            </p>
          </div>
          {messages.length > 0 && (
            <button onClick={reset} style={{ color: "rgba(255,255,255,0.5)", padding: 6, background: "rgba(255,255,255,0.08)", borderRadius: 8, border: "none", cursor: "pointer" }}>
              <RotateCcw size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div>
            <p style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Suggested questions
            </p>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  style={{
                    width: "100%", textAlign: "left", padding: "10px 12px",
                    borderRadius: 12, border: "1.5px solid var(--border)",
                    background: "var(--surface)", cursor: "pointer",
                    fontSize: "0.75rem", color: "var(--text2)", lineHeight: 1.4,
                    transition: "all 0.15s",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
            <div style={{
              maxWidth: "88%",
              background: msg.role === "user" ? "var(--navy)" : "var(--surface)",
              color: msg.role === "user" ? "white" : "var(--text)",
              borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
              padding: "10px 14px",
              border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
              fontSize: "0.8rem",
              lineHeight: 1.5,
            }}>
              {msg.loading ? (
                <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
                  {[0, 1, 2].map((j) => (
                    <div key={j} style={{
                      width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
                      animation: "bounce 1.2s infinite",
                      animationDelay: `${j * 0.2}s`,
                    }} />
                  ))}
                </div>
              ) : (
                <>
                  <p style={{ whiteSpace: "pre-wrap" }}>{msg.content}</p>
                  {msg.chartData && (
                    <div style={{ marginTop: 10, marginLeft: -2, marginRight: -2 }}>
                      {msg.chartData.label && (
                        <p style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--text3)", marginBottom: 4 }}>{msg.chartData.label}</p>
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

      {/* Input */}
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
            placeholder="Ask about sales, stock, or any product…"
            rows={1}
            style={{
              flex: 1, padding: "10px 12px", borderRadius: 12, resize: "none",
              border: "1.5px solid var(--border)", background: "var(--surface2)",
              fontSize: "0.8rem", outline: "none", lineHeight: 1.5,
              maxHeight: 80, overflow: "auto",
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            style={{
              width: 40, height: 40, borderRadius: 12, border: "none", cursor: "pointer",
              background: input.trim() && !loading ? "var(--navy)" : "var(--border)",
              color: input.trim() && !loading ? "white" : "var(--text3)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "all 0.15s",
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
          40% { transform: scale(1.1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
