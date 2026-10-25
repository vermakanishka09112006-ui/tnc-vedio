import { useEffect, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import { useSiteAuth } from "@/components/SiteAuthProvider";
import { getSupabaseClient, signInWithGoogle } from "@/lib/supabase";

type AuthorizationDetails = Record<string, unknown> & {
  authorization_id?: string;
  redirect_url?: string;
  client?: Record<string, unknown>;
  client_name?: string;
  scope?: string;
};

function displayText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export default function OAuthConsentPage() {
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { session, loading: authLoading } = useSiteAuth();
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");

  useEffect(() => {
    let active = true;
    if (authLoading || !session) return;
    if (!authorizationId) {
      setError("The authorization request is missing its authorization ID.");
      return;
    }
    void getSupabaseClient().then((client) => {
      if (!client) throw new Error("OAuth consent is not configured on this site.");
      return client.auth.oauth.getAuthorizationDetails(authorizationId);
    }).then(({ data, error: requestError }) => {
      if (!active) return;
      if (requestError) setError(requestError.message);
      else if (data && "redirect_url" in data) window.location.assign(data.redirect_url);
      else setDetails(data as AuthorizationDetails);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Authorization details could not be loaded.");
    });
    return () => { active = false; };
  }, [authorizationId, authLoading, session]);

  async function decide(approved: boolean) {
    const client = await getSupabaseClient();
    if (!client) return;
    setBusy(true);
    setError("");
    if (!details?.authorization_id) return;
    const result = approved
      ? await client.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
    if (result.error) {
      setError(result.error.message);
      setBusy(false);
    } else if (result.data?.redirect_url) {
      window.location.assign(result.data.redirect_url);
    }
  }

  if (authLoading) return <PageLoader />;
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-white">
        <section className="w-full max-w-lg border border-white/15 bg-white p-7 text-slate-900 shadow-2xl">
          <div className="mb-5 flex h-11 w-11 items-center justify-center bg-emerald-100 text-emerald-800"><ShieldCheck size={22} /></div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">TNC Nursing authorization</p>
          <h1 className="mt-2 text-2xl font-black">Sign in to review this request</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Continue with Google to review and approve the requested account access.</p>
          {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
          <button type="button" onClick={() => void signInWithGoogle(window.location.href)} className="mt-6 w-full bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900">Sign in with Google</button>
        </section>
      </main>
    );
  }
  if (!details && !error) return <PageLoader />;
  const client = details?.client && typeof details.client === "object" ? details.client as Record<string, unknown> : {};
  const clientName = displayText(client.name) ?? displayText(details?.client_name) ?? "An application";
  const requestedScopes = typeof details?.scope === "string" ? details.scope.split(/\s+/).filter(Boolean) : [];

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-white">
      <section className="w-full max-w-lg border border-white/15 bg-white p-7 text-slate-900 shadow-2xl">
        <div className="mb-5 flex h-11 w-11 items-center justify-center bg-emerald-100 text-emerald-800"><ShieldCheck size={22} /></div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">TNC Nursing authorization</p>
        <h1 className="mt-2 text-2xl font-black">Allow {clientName}?</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Review the requested account access before continuing.</p>
        {requestedScopes.length > 0 && <ul className="mt-5 space-y-2 border-y border-slate-200 py-4 text-sm text-slate-700">{requestedScopes.map((scope) => <li key={scope} className="flex items-center gap-2"><Check size={15} className="text-emerald-700" />{scope}</li>)}</ul>}
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy || !details} onClick={() => void decide(false)} className="inline-flex items-center justify-center gap-2 border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X size={16} /> Deny</button>
          <button type="button" disabled={busy || !details} onClick={() => void decide(true)} className="inline-flex items-center justify-center gap-2 bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"><Check size={16} /> {busy ? "Continuing..." : "Allow access"}</button>
        </div>
      </section>
    </main>
  );
}