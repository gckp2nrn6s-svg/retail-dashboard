"use client";
import { useState, FormEvent, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Zap, Eye, EyeOff, Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const sp     = useSearchParams();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const callbackUrl = sp.get("callbackUrl") || "/dashboard";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
      callbackUrl,
    });
    setLoading(false);
    if (res?.ok) {
      router.push(callbackUrl);
    } else {
      setError("Invalid username or password");
    }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #050D1A 0%, #0D1B2A 60%, #0f2d4a 100%)",
      padding: 20,
    }}>
      {/* Background glow */}
      <div style={{ position:"fixed", top:"20%", left:"50%", transform:"translateX(-50%)",
        width:600, height:600, borderRadius:"50%",
        background:"radial-gradient(circle, rgba(37,99,235,0.08) 0%, transparent 70%)",
        pointerEvents:"none" }} />

      <div style={{ width: "100%", maxWidth: 400, position: "relative" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
            width:54, height:54, borderRadius:18,
            background:"linear-gradient(135deg, #2563EB, #7C3AED)",
            boxShadow:"0 8px 32px rgba(37,99,235,0.35)", marginBottom:16 }}>
            <Zap size={26} style={{ color:"white" }} />
          </div>
          <p style={{ color:"white", fontWeight:900, fontSize:"1.4rem", letterSpacing:"-0.04em" }}>
            Le Souverain
          </p>
          <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.7rem", marginTop:4, letterSpacing:"0.12em", textTransform:"uppercase" }}>
            Intelligence Dashboard
          </p>
        </div>

        {/* Card */}
        <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
          borderRadius:24, padding:"32px 28px", backdropFilter:"blur(20px)" }}>

          <p style={{ color:"white", fontWeight:800, fontSize:"1.1rem", marginBottom:6 }}>Sign in</p>
          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.7rem", marginBottom:24 }}>
            Enter your credentials to access the dashboard
          </p>

          <form onSubmit={handleSubmit} style={{ display:"flex", flexDirection:"column", gap:14 }}>

            <div>
              <label style={{ display:"block", fontSize:"0.65rem", fontWeight:700,
                textTransform:"uppercase", letterSpacing:"0.08em",
                color:"rgba(255,255,255,0.4)", marginBottom:6 }}>Username or email</label>
              <input
                type="text" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus autoComplete="username"
                placeholder="username or you@email.com"
                style={{ width:"100%", padding:"11px 14px", borderRadius:12, fontSize:"0.85rem",
                  border:"1px solid rgba(255,255,255,0.1)",
                  background:"rgba(255,255,255,0.06)", color:"white", outline:"none",
                  boxSizing:"border-box", transition:"border-color 0.15s" }}
                onFocus={e => e.target.style.borderColor = "rgba(37,99,235,0.6)"}
                onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
              />
            </div>

            <div>
              <label style={{ display:"block", fontSize:"0.65rem", fontWeight:700,
                textTransform:"uppercase", letterSpacing:"0.08em",
                color:"rgba(255,255,255,0.4)", marginBottom:6 }}>Password</label>
              <div style={{ position:"relative" }}>
                <input
                  type={showPw ? "text" : "password"} value={password}
                  onChange={e => setPassword(e.target.value)}
                  required autoComplete="current-password"
                  placeholder="••••••••"
                  style={{ width:"100%", padding:"11px 40px 11px 14px", borderRadius:12, fontSize:"0.85rem",
                    border:"1px solid rgba(255,255,255,0.1)",
                    background:"rgba(255,255,255,0.06)", color:"white", outline:"none",
                    boxSizing:"border-box", transition:"border-color 0.15s" }}
                  onFocus={e => e.target.style.borderColor = "rgba(37,99,235,0.6)"}
                  onBlur={e  => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                    background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.35)",
                    display:"flex", alignItems:"center" }}>
                  {showPw ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.25)",
                borderRadius:10, padding:"9px 13px", fontSize:"0.72rem", color:"#FCA5A5", fontWeight:600 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ marginTop:6, padding:"13px", borderRadius:12, fontSize:"0.85rem", fontWeight:800,
                border:"none", cursor: loading ? "not-allowed" : "pointer",
                background: loading ? "rgba(37,99,235,0.5)" : "linear-gradient(135deg, #2563EB, #1d4ed8)",
                color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                boxShadow: loading ? "none" : "0 4px 16px rgba(37,99,235,0.4)",
                transition:"all 0.15s" }}>
              {loading ? <><Loader2 size={16} style={{ animation:"spin 1s linear infinite" }}/> Signing in…</> : "Sign in →"}
            </button>

          </form>
        </div>

        <p style={{ textAlign:"center", color:"rgba(255,255,255,0.15)", fontSize:"0.6rem", marginTop:20 }}>
          © 2026 Le Souverain · Powered by Intelligence
        </p>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        input::placeholder { color: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
