import { useEffect, useState } from "react";
import { BookOpen, Check, Clock3, LogOut, RefreshCw, Search, Shield, ShieldOff, Users, X } from "lucide-react";
import { useSiteAuth, type SiteAccessStatus } from "@/components/SiteAuthProvider";
import { customFetch } from "@/lib/api-client/custom-fetch";

type AdminAccessUser = SiteAccessStatus & {
  reviewedAt: string | null;
  reviewedBy: string | null;
  statusBeforeBlock: "pending" | "approved" | "denied";
};

const FILTERS = ["pending", "approved", "denied", "blocked", "all"] as const;
const SUPER_ADMIN_EMAIL = "shashanksv2009@gmail.com";
type Filter = (typeof FILTERS)[number];

interface SiteAccessStats {
  total: number;
  pending: number;
  approved: number;
  denied: number;
  blocked: number;
}

interface SiteAdminAccount {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  grantedAt: string;
  grantedBy: string | null;
}

interface SiteUserActivity {
  watch_history: Record<string, unknown>;
  study_data: Record<string, unknown>;
  favorites: Record<string, unknown>;
  updated_at: string | null;
}

interface EmailOutcome {
  emailSent: boolean;
  emailReason: string | null;
}

function emailNotice(action: string, outcome: EmailOutcome): string {
  if (outcome.emailSent) return `${action} saved and email sent to the user.`;
  if (outcome.emailReason === "not_configured") {
    return `${action} saved, but email is not configured. Set RESEND_API_KEY and ACCESS_EMAIL_FROM on the API service.`;
  }
  return `${action} saved, but the email provider could not deliver the notification.`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function activityItems(value: unknown): Array<Record<string, unknown>> {
  return Object.values(objectRecord(value)).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function UserActivityPanel({ activity }: { activity: SiteUserActivity }) {
  const videos = activityItems(activity.watch_history.watchedVideos).sort((a, b) => String(b.watchedAt ?? "").localeCompare(String(a.watchedAt ?? "")));
  const courses = activityItems(activity.watch_history.watchedCourses).sort((a, b) => String(b.watchedAt ?? "").localeCompare(String(a.watchedAt ?? "")));
  const completed = objectRecord(activity.watch_history.completedLectures);
  const quizzes = Object.values(objectRecord(activity.watch_history.completedQuizzes)).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  const favorites = Object.values(objectRecord(activity.favorites)).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);

  return (
    <section className="mt-4 border-t border-slate-100 pt-4" aria-label="Saved user study activity">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-slate-50 p-3"><p className="text-lg font-black">{videos.length}</p><p className="text-xs text-slate-500">Videos watched</p></div>
        <div className="bg-slate-50 p-3"><p className="text-lg font-black">{Object.keys(completed).length}</p><p className="text-xs text-slate-500">Lectures completed</p></div>
        <div className="bg-slate-50 p-3"><p className="text-lg font-black">{courses.length}</p><p className="text-xs text-slate-500">Courses visited</p></div>
        <div className="bg-slate-50 p-3"><p className="text-lg font-black">{quizzes} / {favorites}</p><p className="text-xs text-slate-500">Quizzes / favorites</p></div>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Recently watched</h4>{videos.length ? <ul className="mt-2 divide-y divide-slate-100">{videos.slice(0, 8).map((item, index) => <li key={`${String(item.sessionId ?? item.title)}-${index}`} className="py-2 text-sm"><p className="truncate font-semibold text-slate-800">{String(item.title ?? item.sessionId ?? "Video")}</p><p className="text-xs text-slate-500">{item.watchedAt ? new Date(String(item.watchedAt)).toLocaleString() : "Watch date unavailable"}{item.completedAt ? " · Completed" : ""}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No watched videos saved.</p>}</div>
        <div><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Recently visited courses</h4>{courses.length ? <ul className="mt-2 divide-y divide-slate-100">{courses.slice(0, 8).map((item, index) => <li key={`${String(item.courseId ?? item.name)}-${index}`} className="py-2 text-sm"><p className="truncate font-semibold text-slate-800">{String(item.name ?? item.courseId ?? "Course")}</p><p className="text-xs text-slate-500">{item.watchedAt ? new Date(String(item.watchedAt)).toLocaleString() : "Visit date unavailable"}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No course visits saved.</p>}</div>
      </div>
      <p className="mt-3 text-right text-[11px] text-slate-400">Last saved {activity.updated_at ? new Date(activity.updated_at).toLocaleString() : "not yet synced"}</p>
    </section>
  );
}

function UserDetailsPanel({ user }: { user: AdminAccessUser }) {
  const details: Array<[string, string]> = [
    ["Google name", user.displayName || "—"],
    ["Email", user.email],
    ["User ID", user.userId],
    ["Role", user.adminRole ?? "User"],
    ["Access status", user.status],
    ["Requested", new Date(user.requestedAt).toLocaleString()],
    ["Last reviewed", user.reviewedAt ? new Date(user.reviewedAt).toLocaleString() : "Never"],
    ["Reviewed by", user.reviewedBy ?? "—"],
    ["Approval expires", user.approvedUntil ? new Date(user.approvedUntil).toLocaleString() : user.status === "approved" ? "Never" : "—"],
    ["Denial reason", user.denialReason ?? "—"],
    ["Block reason", user.blockedReason ?? "—"],
    ["Block expires", user.blockedUntil ? new Date(user.blockedUntil).toLocaleString() : user.status === "blocked" ? "Permanent" : "—"],
  ];

  return (
    <section className="mt-4 border-t border-slate-100 pt-4" aria-label={`Details for ${user.email}`}>
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Account details</h4>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-0.5 break-words text-sm text-slate-800">{value}</dd></div>)}
      </dl>
    </section>
  );
}

export default function SiteAdminPage() {
  const { access, signOut } = useSiteAuth();
  const canManageSiteAdmins = access?.adminRole === "super_admin" || access?.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
  const [filter, setFilter] = useState<Filter>("pending");
  const [users, setUsers] = useState<AdminAccessUser[]>([]);
  const [stats, setStats] = useState<SiteAccessStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [durationHours, setDurationHours] = useState("24");
  const [permanent, setPermanent] = useState(false);
  const [approvalDurationHours, setApprovalDurationHours] = useState("720");
  const [permanentApproval, setPermanentApproval] = useState(false);
  const [selectedAction, setSelectedAction] = useState<"approve" | "block" | null>(null);
  const [busyId, setBusyId] = useState("");
  const [search, setSearch] = useState("");
  const [activityUserId, setActivityUserId] = useState<string | null>(null);
  const [activity, setActivity] = useState<SiteUserActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [detailsUserId, setDetailsUserId] = useState<string | null>(null);
  const [zoomedProfile, setZoomedProfile] = useState<{ url: string; name: string } | null>(null);
  const [siteAdmins, setSiteAdmins] = useState<SiteAdminAccount[]>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminRoleLoading, setAdminRoleLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [response, summary] = await Promise.all([
        customFetch<{ users: AdminAccessUser[] }>(`/api/admin/site-access?status=${filter}`),
        customFetch<SiteAccessStats>("/api/admin/site-access/stats"),
      ]);
      setUsers(response.users);
      setStats(summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load access requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [filter]);

  async function refreshSiteAdmins() {
    if (!canManageSiteAdmins) return;
    try {
      const response = await customFetch<{ admins: SiteAdminAccount[] }>("/api/admin/site-admins");
      setSiteAdmins(response.admins);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load admin roles.");
    }
  }

  useEffect(() => { void refreshSiteAdmins(); }, [canManageSiteAdmins]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleUsers = users.filter((user) => `${user.displayName} ${user.email}`.toLowerCase().includes(normalizedSearch));

  async function toggleActivity(userId: string) {
    if (activityUserId === userId) {
      setActivityUserId(null);
      setActivity(null);
      return;
    }
    setActivityUserId(userId);
    setActivity(null);
    setActivityLoading(true);
    setError("");
    try {
      setActivity(await customFetch<SiteUserActivity>(`/api/admin/site-access/${encodeURIComponent(userId)}/activity`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load saved user activity.");
    } finally {
      setActivityLoading(false);
    }
  }

  async function updateUser(userId: string, action: "approve" | "deny" | "unapprove" | "block" | "unblock") {
    setBusyId(userId);
    setError("");
    setNotice("");
    try {
      if (action === "approve" || action === "deny" || action === "unapprove") {
        const decision = await customFetch<EmailOutcome>(`/api/admin/site-access/${encodeURIComponent(userId)}/decision`, {
          method: "POST",
          body: JSON.stringify({
            status: action === "approve" ? "approved" : action === "deny" ? "denied" : "pending",
            reason,
            ...(action === "approve" ? { durationHours: permanentApproval ? null : Number(approvalDurationHours) } : {}),
          }),
        });
        setNotice(emailNotice(action === "approve" ? "Approval" : action === "deny" ? "Denial" : "Unapproval", decision));
      } else if (action === "block") {
        if (!reason.trim()) throw new Error("Add a reason before blocking this user.");
        const outcome = await customFetch<EmailOutcome>(`/api/admin/site-access/${encodeURIComponent(userId)}/block`, {
          method: "POST",
          body: JSON.stringify({ reason, durationHours: permanent ? null : Number(durationHours) }),
        });
        setNotice(emailNotice("Ban", outcome));
      } else {
        const outcome = await customFetch<EmailOutcome>(`/api/admin/site-access/${encodeURIComponent(userId)}/unblock`, { method: "POST" });
        setNotice(emailNotice("Unban", outcome));
      }
      setReason("");
      setSelectedId(null);
      setSelectedAction(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "User access could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  async function setUserAdmin(email: string, enabled: boolean) {
    setAdminRoleLoading(true);
    setError("");
    setNotice("");
    try {
      await customFetch("/api/admin/site-admins", {
        method: "PUT",
        body: JSON.stringify({ email, enabled }),
      });
      setNotice(`${email} is ${enabled ? "now an admin" : "no longer an admin"}.`);
      setAdminEmail("");
      await Promise.all([refresh(), refreshSiteAdmins()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update admin role.");
    } finally {
      setAdminRoleLoading(false);
    }
  }

  useEffect(() => {
    if (!zoomedProfile) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedProfile(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [zoomedProfile]);

  if (!access?.isAdmin) {
    return <main className="min-h-screen bg-slate-950 px-4 py-20 text-center text-white"><h1 className="text-xl font-black">Admin access required</h1><p className="mt-2 text-sm text-white/70">Sign in with the authorized Google account to manage site access.</p></main>;
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center bg-emerald-800 text-white"><Shield size={18} /></div><div><h1 className="font-black">Site access</h1><p className="text-xs text-slate-500">{access.email}</p></div></div>
        <div className="flex items-center gap-3"><button onClick={() => void refresh()} title="Refresh requests" aria-label="Refresh requests" className="p-2 text-slate-600 hover:bg-slate-100"><RefreshCw size={17} /></button><button onClick={() => void signOut()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><LogOut size={16} /> Sign out</button></div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Access management</p><h2 className="mt-1 text-2xl font-black">Google account requests</h2></div>
          <nav className="flex flex-wrap gap-1" aria-label="Filter users by access status">{FILTERS.map((status) => <button key={status} onClick={() => setFilter(status)} className={`border-b-2 px-3 py-2 text-sm font-semibold capitalize ${filter === status ? "border-emerald-800 text-emerald-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{status}</button>)}</nav>
        </div>
        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="User access totals">
          {([
            ["Total users", stats?.total, Users, "text-slate-800", "bg-slate-100"],
            ["Pending", stats?.pending, Clock3, "text-amber-800", "bg-amber-50"],
            ["Approved", stats?.approved, Check, "text-emerald-800", "bg-emerald-50"],
            ["Denied", stats?.denied, X, "text-red-800", "bg-red-50"],
            ["Blocked", stats?.blocked, ShieldOff, "text-slate-700", "bg-slate-200"],
          ] as const).map(([label, value, Icon, color, background]) => (
            <div key={label} className="flex items-center gap-3 border border-slate-200 bg-white p-3 sm:p-4">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${background} ${color}`}><Icon size={17} /></span>
              <span className="min-w-0"><span className="block text-xl font-black text-slate-900">{value ?? "—"}</span><span className="block truncate text-xs text-slate-500">{label}</span></span>
            </div>
          ))}
        </section>
        {canManageSiteAdmins && <section className="mt-6 border border-blue-200 bg-white p-4 sm:p-5" aria-label="Admin role management">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-800">Superadmin controls</p><h3 className="mt-1 text-lg font-black">Admin roles</h3><p className="mt-1 text-xs text-slate-500">Only the superadmin can grant or remove admin privileges.</p></div>
            <form onSubmit={(event) => { event.preventDefault(); void setUserAdmin(adminEmail.trim(), true); }} className="flex w-full max-w-lg gap-2">
              <input type="email" required value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="Google account email" aria-label="Email to make admin" className="min-w-0 flex-1 border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-700" />
              <button type="submit" disabled={adminRoleLoading} className="shrink-0 bg-blue-800 px-4 py-2 text-sm font-bold text-white hover:bg-blue-900 disabled:opacity-50">Make admin</button>
            </form>
          </div>
          {siteAdmins.length > 0 ? <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">{siteAdmins.map((admin) => <li key={admin.userId} className="flex items-center gap-3 py-3">
            {admin.avatarUrl ? <img src={admin.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full object-cover" /> : <div aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-800">{(admin.displayName || admin.email).slice(0, 1).toUpperCase()}</div>}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{admin.displayName || admin.email}</p><p className="truncate text-xs text-slate-500">{admin.email}</p></div>
            <span className="hidden text-xs text-slate-400 sm:block">Admin since {new Date(admin.grantedAt).toLocaleDateString()}</span>
            <button type="button" disabled={adminRoleLoading} onClick={() => void setUserAdmin(admin.email, false)} className="border border-red-200 px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-50">Remove admin</button>
          </li>)}</ul> : <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">No regular admins assigned yet.</p>}
        </section>}
        <label className="relative mt-5 block max-w-xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by Google name or email" aria-label="Search users by name or email" className="w-full border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100" />
        </label>
        {error && <p className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {notice && <p className="mt-4 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</p>}
        {loading ? <p className="py-12 text-center text-sm text-slate-500">Loading access requests...</p> : visibleUsers.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">No users match this search.</p> : (
          <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200 bg-white">
            {visibleUsers.map((user) => <article key={user.userId} className="px-4 py-5 sm:px-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                {user.avatarUrl ? <button type="button" onClick={() => setZoomedProfile({ url: user.avatarUrl!, name: user.displayName || user.email })} aria-label={`Zoom ${user.displayName || user.email}'s profile picture`} className="h-12 w-12 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"><img src={user.avatarUrl} alt={`${user.displayName || user.email} profile`} referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" loading="lazy" /></button> : <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-900">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</div>}
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all font-bold">{user.displayName || user.email}</h3><span className="break-all text-sm text-slate-600">{user.displayName ? user.email : ""}</span><span className={`px-2 py-1 text-xs font-bold uppercase ${user.status === "approved" ? "bg-emerald-100 text-emerald-800" : user.status === "denied" || user.status === "blocked" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{user.status}</span>{user.adminRole && <span className="bg-blue-100 px-2 py-1 text-xs font-bold uppercase text-blue-800">{user.adminRole.replace("_", " ")}</span>}</div><p className="mt-1 text-xs text-slate-500">Requested {new Date(user.requestedAt).toLocaleString()}</p>{user.status === "approved" && <p className="mt-2 text-xs text-emerald-800">{user.approvedUntil ? `Approved until ${new Date(user.approvedUntil).toLocaleString()}` : "Permanent approval"}</p>}{user.denialReason && <p className="mt-2 text-sm text-red-800">Denied: {user.denialReason}</p>}{user.blockedReason && <p className="mt-2 text-sm text-red-800">Block reason: {user.blockedReason}{user.blockedUntil ? ` · Until ${new Date(user.blockedUntil).toLocaleString()}` : " · Permanent"}</p>}</div>
                <div className="flex flex-wrap gap-2"><button disabled={!!busyId} onClick={() => setDetailsUserId(detailsUserId === user.userId ? null : user.userId)} className="border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">{detailsUserId === user.userId ? "Hide details" : "Details"}</button>{access.adminRole === "super_admin" && <button disabled={!!busyId} onClick={() => void toggleActivity(user.userId)} className="inline-flex items-center gap-1.5 border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><BookOpen size={14} /> Activity</button>}<button disabled={!!busyId} onClick={() => { setSelectedId(selectedId === user.userId && selectedAction === "approve" ? null : user.userId); setSelectedAction(selectedId === user.userId && selectedAction === "approve" ? null : "approve"); setReason(""); }} className="inline-flex items-center gap-1.5 bg-emerald-800 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-900 disabled:opacity-50"><Check size={14} /> {user.status === "approved" ? "Set approval period" : "Approve"}</button>{user.status === "approved" && <button disabled={!!busyId} onClick={() => void updateUser(user.userId, "unapprove")} className="inline-flex items-center gap-1.5 border border-red-200 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-50"><X size={14} /> Unapprove</button>}{user.status === "pending" && <button disabled={!!busyId} onClick={() => void updateUser(user.userId, "deny")} className="inline-flex items-center gap-1.5 border border-red-200 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-50"><X size={14} /> Deny</button>}{user.status === "blocked" ? <button disabled={!!busyId} onClick={() => void updateUser(user.userId, "unblock")} className="inline-flex items-center gap-1.5 border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"><ShieldOff size={14} /> Unblock</button> : <button disabled={!!busyId} onClick={() => { const opening = selectedId !== user.userId || selectedAction !== "block"; setSelectedId(opening ? user.userId : null); setSelectedAction(opening ? "block" : null); setReason(""); }} className="inline-flex items-center gap-1.5 border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Clock3 size={14} /> Block</button>}{access.adminRole === "super_admin" && user.adminRole !== "super_admin" && <button disabled={!!busyId} onClick={() => void setUserAdmin(user.email, user.adminRole !== "admin")} className="inline-flex items-center gap-1.5 border border-blue-200 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-50">{user.adminRole === "admin" ? "Remove admin" : "Make admin"}</button>}</div>
              </div>
              {detailsUserId === user.userId && <UserDetailsPanel user={user} />}
              {activityUserId === user.userId && activityLoading && <p className="mt-4 text-sm text-slate-500">Loading saved activity...</p>}
              {activityUserId === user.userId && activity && <UserActivityPanel activity={activity} />}
              {selectedId === user.userId && selectedAction && <form onSubmit={(event) => { event.preventDefault(); void updateUser(user.userId, selectedAction); }} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto] sm:items-end">
                {selectedAction === "block" && <label className="text-xs font-semibold text-slate-600">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-700" /></label>}
                <label className="text-xs font-semibold text-slate-600">{selectedAction === "approve" ? "Approval duration (hours)" : "Block duration (hours)"}<input type="number" min="1" max="8760" required={selectedAction === "block" ? !permanent : !permanentApproval} disabled={selectedAction === "approve" ? permanentApproval : permanent} value={selectedAction === "approve" ? approvalDurationHours : durationHours} onChange={(event) => selectedAction === "approve" ? setApprovalDurationHours(event.target.value) : setDurationHours(event.target.value)} className="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-700 disabled:bg-slate-100" /></label>
                <label className="flex items-center gap-2 py-2 text-sm text-slate-700"><input type="checkbox" checked={selectedAction === "approve" ? permanentApproval : permanent} onChange={(event) => selectedAction === "approve" ? setPermanentApproval(event.target.checked) : setPermanent(event.target.checked)} /> Permanent</label>
                <button type="submit" disabled={!!busyId} className={`${selectedAction === "approve" ? "bg-emerald-800 hover:bg-emerald-900" : "bg-red-800 hover:bg-red-900"} px-4 py-2 text-sm font-bold text-white disabled:opacity-50`}>{selectedAction === "approve" ? "Confirm approval" : "Confirm block"}</button>
              </form>}
            </article>)}
          </div>
        )}
      </div>
      {zoomedProfile && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="profile-zoom-title" onClick={() => setZoomedProfile(null)}>
        <div className="relative max-h-[90vh] max-w-[min(92vw,42rem)]" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setZoomedProfile(null)} aria-label="Close enlarged profile picture" className="absolute -right-3 -top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-800 shadow-lg hover:bg-slate-100"><X size={19} /></button>
          <img src={zoomedProfile.url} alt={`${zoomedProfile.name} profile picture`} referrerPolicy="no-referrer" className="max-h-[82vh] w-auto max-w-[92vw] rounded-xl bg-white object-contain shadow-2xl" />
          <p id="profile-zoom-title" className="mt-3 text-center text-sm font-semibold text-white">{zoomedProfile.name}</p>
        </div>
      </div>}
    </main>
  );
}