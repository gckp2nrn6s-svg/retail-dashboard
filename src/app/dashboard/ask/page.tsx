"use client";
import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, TrendingUp, Package, Users, BarChart2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

interface Message {
  role: "user" | "assistant";
  content: string;
  chartData?: {
    type: string;
    title: string;
    labels: string[];
    datasets: { label: string; data: number[] }[];
  };
}

const QUICK_PROMPTS = [
  { label: "Fast movers this week", icon: TrendingUp },
  { label: "Low stock alerts", icon: Package },
  { label: "Top customers", icon: Users },
  { label: "Store comparison", icon: BarChart2 },
];

function InlineChart({ data }: { data: NonNullable<Message["chartData"]> }) {
  const chartData = data.labels.map((label, i) => ({
    name: label,
    ...Object.fromEntries(data.datasets.map((d) => [d.label, d.data[i]])),
  }));

  return (
    <div className="mt-3 bg-white border border-gray-100 rounded-xl p-3">
      <p className="text-xs text-gray-500 mb-2">{data.title}</p>
      <ResponsiveContainer width="100%" height={140}>
        {data.type === "line" ? (
          <LineChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            {data.datasets.map((d) => (
              <Line key={d.label} type="monotone" dataKey={d.label} stroke="#2563eb" dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            {data.datasets.map((d, i) => (
              <Bar key={d.label} dataKey={d.label} fill={["#2563eb", "#16a34a", "#d97706"][i % 3]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default function AskPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi Sherif! I have access to your live NAV data and Shopify stores. Ask me anything about your business — sales, stock, customers, trends.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.text, chartData: data.chartData },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, something went wrong. Try again." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
            <Sparkles size={14} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold">AI Assistant</p>
            <p className="text-xs text-gray-400">live data · NAV + Shopify</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-gray-100 text-gray-900 rounded-bl-sm"
              }`}
            >
              <p className="leading-relaxed">{msg.content}</p>
              {msg.chartData && <InlineChart data={msg.chartData} />}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 px-4 pb-2 overflow-x-auto">
        {QUICK_PROMPTS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            onClick={() => send(label)}
            className="flex items-center gap-1.5 whitespace-nowrap text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 bg-white shrink-0"
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-gray-100 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Ask anything about your business..."
          className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-gray-400"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center disabled:opacity-40"
        >
          <Send size={15} className="text-white" />
        </button>
      </div>
    </div>
  );
}
