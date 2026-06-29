"use client";
import { useState } from "react";
import { SubTabBar } from "@/components/warehouse/shared";
import IncomingTab from "@/components/warehouse/IncomingTab";
import POTab from "@/components/warehouse/POTab";
import ToBeReceivedTab from "@/components/warehouse/ToBeReceivedTab";
import PaperCheckTab from "@/components/warehouse/PaperCheckTab";
import StockTab from "@/components/warehouse/StockTab";
import AdjustTab from "@/components/warehouse/AdjustTab";
import HoSalesTab from "@/components/warehouse/HoSalesTab";
import ReturnsTab from "@/components/warehouse/ReturnsTab";
import LogTab from "@/components/warehouse/LogTab";
import HistoryTab from "@/components/warehouse/HistoryTab";

const TABS = [
  { key: "incoming", label: "Incoming" },
  { key: "po", label: "PO" },
  { key: "tbr", label: "To Be Received" },
  { key: "paper", label: "Paper Check" },
  { key: "stock", label: "Stock" },
  { key: "adjust", label: "Adjust" },
  { key: "hosales", label: "HO Sales" },
  { key: "returns", label: "Returns" },
  { key: "log", label: "Log" },
  { key: "history", label: "History" },
];

export default function WarehousePage() {
  const [tab, setTab] = useState("incoming");
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", paddingBottom: 80 }}>
      <div style={{ background: "linear-gradient(160deg, #06251f 0%, #0a3b30 55%, #0d4d40 100%)", padding: "clamp(20px,4vw,28px) 24px 20px" }}>
        <p style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Head Office</p>
        <h1 style={{ color: "white", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3 }}>Warehousing</h1>
      </div>
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <SubTabBar tabs={TABS} active={tab} onChange={setTab} />
        {tab === "incoming" && <IncomingTab />}
        {tab === "po" && <POTab />}
        {tab === "tbr" && <ToBeReceivedTab />}
        {tab === "paper" && <PaperCheckTab />}
        {tab === "stock" && <StockTab />}
        {tab === "adjust" && <AdjustTab />}
        {tab === "hosales" && <HoSalesTab />}
        {tab === "returns" && <ReturnsTab />}
        {tab === "log" && <LogTab />}
        {tab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}
