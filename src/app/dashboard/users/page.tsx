"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { TABS, WH_ACTIONS, type Permissions } from "@/lib/permissions";
import { Plus, Trash2, Pencil, Check, X, ShieldCheck, User as UserIcon } from "lucide-react";
import SystemStatus from "@/components/admin/SystemStatus";

interface User { id: string; email: string; name: string; role: string; permissions: Permissions; active: boolean; createdAt: string }
interface Form { id?: string; email: string; name: string; password: string; role: "admin" | "member"; tabs: Set<string>; wh: Set<string>; active: boolean }

const ACCENT = "#6366F1";
const emptyForm = (): Form => ({ email: "", name: "", password: "", role: "member", tabs: new Set(), wh: new Set(), active: true });

export default function UsersPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  const [view, setView] = useState<"users" | "status">("users");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/users").then(x => x.json()); setUsers(r.users || []); }
    catch { setUsers([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (session && !isAdmin) {
    return <div style={{ padding: 60, textAlign: "center", color: "var(--text3)" }}><ShieldCheck size={40} style={{ opacity: 0.4 }} /><p style={{ marginTop: 12, fontWeight: 700 }}>Admins only</p><p style={{ fontSize: "0.8rem" }}>You don't have access to user management.</p></div>;
  }

  const openNew = () => { setErr(null); setMsg(null); setForm(emptyForm()); };
  const openEdit = (u: User) => { setErr(null); setMsg(null); setForm({ id: u.id, email: u.email, name: u.name, password: "", role: u.role === "admin" ? "admin" : "member", tabs: new Set(u.permissions?.tabs || []), wh: new Set(Object.entries(u.permissions?.wh || {}).filter(([, v]) => v).map(([k]) => k)), active: u.active }); };

  const save = async () => {
    if (!form) return;
    setBusy(true); setErr(null);
    const permissions: Permissions = { tabs: [...form.tabs], wh: Object.fromEntries(WH_ACTIONS.map(a => [a.key, form.wh.has(a.key)])) };
    const body: Record<string, unknown> = { email: form.email, name: form.name, role: form.role, active: form.active, permissions };
    if (form.password) body.password = form.password;
    try {
      const url = form.id ? `/api/users/${form.id}` : "/api/users";
      const method = form.id ? "PATCH" : "POST";
      if (!form.id && !form.password) { setErr("Set a password for the new user."); setBusy(false); return; }
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json());
      if (r.ok || r.id) { setForm(null); setMsg(form.id ? "User updated." : "User created."); load(); }
      else setErr(r.error || "Couldn't save.");
    } catch { setErr("Couldn't save."); } finally { setBusy(false); }
  };

  const del = async (u: User) => {
    if (!confirm(`Delete ${u.email}? This can't be undone.`)) return;
    const r = await fetch(`/api/users/${u.id}`, { method: "DELETE" }).then(x => x.json());
    if (r.ok) { setMsg("User deleted."); load(); } else alert(r.error || "Couldn't delete.");
  };
  const toggleActive = async (u: User) => {
    const r = await fetch(`/api/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !u.active }) }).then(x => x.json());
    if (r.ok) load(); else alert(r.error || "Couldn't update.");
  };

  const toggle = (set: Set<string>, key: string) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); return n; };
  const ip = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "0.85rem", outline: "none" } as React.CSSProperties;
  const lbl = { fontSize: "0.6rem", fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, display: "block" } as React.CSSProperties;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", paddingBottom: 80 }}>
      <div style={{ background: "linear-gradient(160deg, #1e1b4b 0%, #312e81 55%, #4338ca 100%)", padding: "clamp(20px,4vw,28px) 24px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Admin</p>
          <h1 style={{ color: "white", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3 }}>Users &amp; permissions</h1>
        </div>
        {view === "users" && <button onClick={openNew} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 11, border: "none", cursor: "pointer", background: "white", color: "#312e81", fontWeight: 800, fontSize: "0.82rem" }}><Plus size={16} /> New user</button>}
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--surface3)", borderRadius: 11, maxWidth: 380 }}>
          {([["users", "Users & permissions"], ["status", "System status"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: view === k ? "var(--surface)" : "transparent", color: view === k ? "var(--text)" : "var(--text3)", fontWeight: view === k ? 700 : 600, fontSize: "0.78rem", boxShadow: view === k ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>{l}</button>
          ))}
        </div>

        {view === "status" ? <SystemStatus /> : <>
        {msg && <div style={{ padding: "9px 14px", borderRadius: 10, background: "rgba(16,185,129,0.12)", color: "#10B981", fontSize: "0.78rem", fontWeight: 700 }}>{msg}</div>}

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 12 }} />)}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {users.map(u => (
              <div key={u.id} className="card" style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", opacity: u.active ? 1 : 0.55 }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: u.role === "admin" ? "rgba(99,102,241,0.15)" : "var(--surface3)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {u.role === "admin" ? <ShieldCheck size={18} style={{ color: ACCENT }} /> : <UserIcon size={18} style={{ color: "var(--text3)" }} />}
                </span>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <p style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--text)" }}>{u.name || u.email} {u.role === "admin" && <span style={{ fontSize: "0.56rem", fontWeight: 800, color: ACCENT, background: "rgba(99,102,241,0.12)", padding: "1px 7px", borderRadius: 6, marginLeft: 4 }}>ADMIN</span>}{!u.active && <span style={{ fontSize: "0.56rem", fontWeight: 800, color: "var(--text4)", background: "var(--surface3)", padding: "1px 7px", borderRadius: 6, marginLeft: 4 }}>DISABLED</span>}</p>
                  <p style={{ fontSize: "0.68rem", color: "var(--text3)", marginTop: 1 }}>{u.email} · {u.role === "admin" ? "full access" : `${u.permissions?.tabs?.length || 0} tab${(u.permissions?.tabs?.length || 0) === 1 ? "" : "s"}`}</p>
                </div>
                <button onClick={() => toggleActive(u)} style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--text2)", background: "var(--surface3)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}>{u.active ? "Disable" : "Enable"}</button>
                <button onClick={() => openEdit(u)} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.7rem", fontWeight: 700, color: ACCENT, background: "rgba(99,102,241,0.1)", border: "none", borderRadius: 8, padding: "5px 11px", cursor: "pointer" }}><Pencil size={12} /> Edit</button>
                <button onClick={() => del(u)} style={{ display: "inline-flex", alignItems: "center", color: "#EF4444", background: "none", border: "none", cursor: "pointer", padding: 5 }}><Trash2 size={14} /></button>
              </div>
            ))}
            {users.length === 0 && <p style={{ textAlign: "center", color: "var(--text4)", padding: 40 }}>No users yet.</p>}
          </div>
        )}
        </>}
      </div>

      {/* Create / edit modal */}
      {form && (
        <div onClick={() => !busy && setForm(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, width: "min(560px, 100%)", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: "0.95rem", fontWeight: 800 }}>{form.id ? "Edit user" : "New user"}</p>
              <button onClick={() => setForm(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text4)" }}><X size={18} /></button>
            </div>
            <div style={{ padding: "16px 20px", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><span style={lbl}>Username or email</span><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="warehouse1" style={ip} /></div>
                <div><span style={lbl}>Display name</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Warehouse Team" style={ip} /></div>
              </div>
              <div><span style={lbl}>Password {form.id && <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--text4)", fontWeight: 500 }}>(leave blank to keep current)</span>}</span><input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={form.id ? "••••••••" : "at least 6 characters"} style={ip} /></div>

              <div>
                <span style={lbl}>Role</span>
                <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--surface3)", borderRadius: 11, maxWidth: 320 }}>
                  {(["member", "admin"] as const).map(r => (
                    <button key={r} onClick={() => setForm({ ...form, role: r })} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", background: form.role === r ? (r === "admin" ? ACCENT : "var(--surface)") : "transparent", color: form.role === r ? (r === "admin" ? "white" : "var(--text)") : "var(--text3)", fontWeight: form.role === r ? 700 : 600, fontSize: "0.78rem", textTransform: "capitalize" }}>{r}{r === "admin" ? " (full access)" : ""}</button>
                  ))}
                </div>
              </div>

              {form.role === "member" ? (
                <>
                  <div>
                    <span style={lbl}>Tabs this user can open</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 6 }}>
                      {TABS.map(t => {
                        const on = form.tabs.has(t.key);
                        return (
                          <button key={t.key} onClick={() => setForm({ ...form, tabs: toggle(form.tabs, t.key) })} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", borderRadius: 9, cursor: "pointer", border: on ? `1.5px solid ${ACCENT}` : "1px solid var(--border)", background: on ? "rgba(99,102,241,0.08)" : "var(--surface2)", textAlign: "left" }}>
                            <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: on ? ACCENT : "transparent", border: on ? "none" : "1.5px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={11} strokeWidth={3} style={{ color: "white" }} />}</span>
                            <span style={{ fontSize: "0.74rem", fontWeight: 600, color: on ? "var(--text)" : "var(--text2)" }}>{t.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {form.tabs.has("warehouse") && (
                    <div>
                      <span style={lbl}>Warehouse actions they can perform</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {WH_ACTIONS.map(a => {
                          const on = form.wh.has(a.key);
                          return (
                            <button key={a.key} onClick={() => setForm({ ...form, wh: toggle(form.wh, a.key) })} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 9, cursor: "pointer", border: on ? `1.5px solid #0D9488` : "1px solid var(--border)", background: on ? "rgba(13,148,136,0.08)" : "var(--surface2)", textAlign: "left" }}>
                              <span style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: on ? "#0D9488" : "transparent", border: on ? "none" : "1.5px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={11} strokeWidth={3} style={{ color: "white" }} />}</span>
                              <span style={{ fontSize: "0.76rem", fontWeight: 600, color: on ? "var(--text)" : "var(--text2)" }}>{a.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: "0.64rem", color: "var(--text4)", marginTop: 6 }}>Unchecked actions stay read-only — they'll see the tab but can't submit/adjust/receive.</p>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", fontSize: "0.76rem", color: "var(--text2)" }}>
                  <ShieldCheck size={15} style={{ color: ACCENT, verticalAlign: "middle", marginRight: 6 }} />Admins see every tab and can perform every action, including managing users.
                </div>
              )}

              {err && <p style={{ fontSize: "0.78rem", color: "#EF4444", fontWeight: 600 }}>⚠ {err}</p>}
            </div>
            <div style={{ padding: "13px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setForm(null)} disabled={busy} style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface3)", cursor: "pointer", fontWeight: 700, fontSize: "0.8rem", color: "var(--text2)" }}>Cancel</button>
              <button onClick={save} disabled={busy} style={{ padding: "9px 22px", borderRadius: 10, border: "none", cursor: busy ? "default" : "pointer", background: ACCENT, color: "white", fontWeight: 800, fontSize: "0.8rem", opacity: busy ? 0.6 : 1 }}>{form.id ? "Save changes" : "Create user"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
