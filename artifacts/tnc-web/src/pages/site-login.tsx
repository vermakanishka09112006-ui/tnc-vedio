import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { signInWithGoogle } from "@/lib/supabase";
import GoogleMark from "@/components/GoogleMark";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export default function SiteLoginPage() {
  const [location, setLocation] = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestedPath = new URLSearchParams(window.location.search).get("next") ?? "/videos";
  const nextPath = requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/videos";

  async function login() {
    setError("");
    setBusy(true);
    try {
      const callback = new URL(`${BASE}/auth/callback`, window.location.origin);
      callback.searchParams.set("next", nextPath);
      await signInWithGoogle(callback.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in could not start.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-white">
      <section className="w-full max-w-md border border-white/15 bg-white p-7 text-slate-900 shadow-2xl">
        <div className="mb-6 flex h-11 w-11 items-center justify-center bg-emerald-100 text-emerald-800"><ShieldCheck size={22} /></div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">TNC Nursing</p>
        <h1 className="mt-2 text-2xl font-black">Sign in to continue</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Use your Google account. Learning access is enabled after an administrator approves your request.</p>
        <button type="button" onClick={() => void login()} disabled={busy} className="mt-7 box-border inline-flex min-h-12 w-full appearance-none items-center justify-center gap-3 rounded-md border border-[#747775] bg-white px-4 py-3 text-sm font-semibold leading-5 text-[#1f1f1f] shadow-sm hover:bg-[#f8faff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
          <GoogleMark />
          {busy ? "Connecting to Google..." : "Continue with Google"}
        </button>
        {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        <button type="button" onClick={() => setLocation(location === "/login" ? "/" : "/courses")} className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"><ArrowLeft size={15} /> Back to site</button>
      </section>
    </main>
  );
}