import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LockKeyhole, LogOut, MessageCircle, RefreshCw } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import { useSiteAuth } from "@/components/SiteAuthProvider";
import { customFetch } from "@/lib/api-client/custom-fetch";

const SUPPORT_URL = "https://t.me/Tncnursingbot";

export default function ProtectedSitePage({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { session, access, loading, refreshAccess, signOut } = useSiteAuth();
  const [helpNotice, setHelpNotice] = useState("");

  useEffect(() => {
    if (!loading && !session) setLocation(`/login?next=${encodeURIComponent(location)}`);
  }, [loading, session, location, setLocation]);

  if (loading) return <PageLoader />;
  if (!session) return <PageLoader />;
  if (!access) {
    return (
      <AccessMessage title="We couldn't check your access" message="Your Google account is signed in, but the access service could not be reached." onAction={() => void refreshAccess()} actionLabel="Try again" onSignOut={() => void signOut()} />
    );
  }
  if (access.status === "approved") return children;

  if (access.status === "pending") {
    async function notifyAdmin() {
      setHelpNotice("");
      try {
        await customFetch("/api/site-access/notify-admin", { method: "POST" });
        setHelpNotice("The administrator was notified. You can message the help bot if you need assistance.");
      } catch (cause) {
        setHelpNotice(cause instanceof Error ? cause.message : "Could not notify the administrator. Please message the help bot.");
      }
    }
    return <AccessMessage title="Approval is pending" message="Your access request was sent to the administrator. Learning content will open here after it is approved." onAction={() => void refreshAccess()} actionLabel="Check status" onSignOut={() => void signOut()} onNotifyAdmin={() => void notifyAdmin()} helpNotice={helpNotice} />;
  }
  if (access.status === "denied") {
    return <AccessMessage title="Access was denied" message={access.denialReason || "Your request to access learning content was denied."} onAction={() => window.open(SUPPORT_URL, "_blank", "noopener,noreferrer")} actionLabel="Contact support" onSignOut={() => void signOut()} />;
  }
  const blockMessage = access.blockedUntil
    ? `Access is blocked until ${new Date(access.blockedUntil).toLocaleString()}. ${access.blockedReason ?? ""}`
    : `Access is permanently blocked. ${access.blockedReason ?? ""}`;
  return <AccessMessage title="Account blocked" message={blockMessage} onAction={() => window.open(SUPPORT_URL, "_blank", "noopener,noreferrer")} actionLabel="Contact support" onSignOut={() => void signOut()} />;
}

function AccessMessage({
  title,
  message,
  actionLabel,
  onAction,
  onSignOut,
  onNotifyAdmin,
  helpNotice,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  onSignOut: () => void;
  onNotifyAdmin?: () => void;
  helpNotice?: string;
}) {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-lg border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-5 flex h-11 w-11 items-center justify-center bg-amber-100 text-amber-900"><LockKeyhole size={21} /></div>
        <h1 className="text-2xl font-black text-slate-950">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
        {helpNotice && <p className="mt-3 text-sm text-emerald-800" role="status">{helpNotice}</p>}
        <p className="mt-3 text-sm text-slate-600">If you think this was a mistake, message <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="font-semibold text-emerald-800 underline">TNC Nursing support</a>.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={onAction} className="inline-flex items-center gap-2 bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"><RefreshCw size={15} />{actionLabel}</button>
          <button type="button" onClick={onSignOut} className="inline-flex items-center gap-2 border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><LogOut size={15} />Sign out</button>
          {onNotifyAdmin && <a href="https://t.me/Tncnursingbot?start=access_request" target="_blank" rel="noreferrer" onClick={onNotifyAdmin} className="inline-flex items-center gap-2 border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"><MessageCircle size={15} />Tell admin in Telegram</a>}
          <Link href="/courses" className="px-2 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-950">Back to courses</Link>
        </div>
      </section>
    </main>
  );
}