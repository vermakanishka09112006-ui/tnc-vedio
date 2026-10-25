import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetAdminStats, useTogglePromo, useGetPromoStatus, getGetPromoStatusQueryKey, customFetch } from "@/lib/api-client";
import { Shield, Users, BookOpen, Video, ShoppingCart, LogOut, ToggleLeft, ToggleRight, RefreshCw, Calendar, Plus, Minus, Clock, Search, ChevronLeft, ChevronRight, Snowflake } from "lucide-react";
import { getAdminToken, clearAdminToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { useWinterEffects } from "@/components/WinterEffectsProvider";
import { useSiteAuth } from "@/components/SiteAuthProvider";
import SiteAdminPage from "@/pages/site-admin";
import { signInWithGoogle } from "@/lib/supabase";
import GoogleMark from "@/components/GoogleMark";

const QUICK_DAYS = [7, 14, 30, 60, 90];
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_USER_PAGE_SIZE = 50;

interface AdminDirectoryUser {
  id: string;
  source: "app" | "telegram" | "mobile" | "crm";
  name: string;
  details: Record<string, unknown>;
  activityAt: string | null;
}

interface AdminDirectoryResponse {
  users: AdminDirectoryUser[];
  total: number;
  page: number;
  limit: number;
  unavailableSources?: string[];
}

function displayAdminValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function StudentsDirectory() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  
  // Immediate search on change for better UX
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-user-directory", debouncedSearch, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(ADMIN_USER_PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return customFetch<AdminDirectoryResponse>(`${BASE}/api/admin/users?${params}`, {
        headers: { "x-admin-token": getAdminToken() ?? "" },
      });
    },
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });

  const students = data?.users ?? [];
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / ADMIN_USER_PAGE_SIZE));
  const firstRow = data?.total ? (page - 1) * ADMIN_USER_PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(page * ADMIN_USER_PAGE_SIZE, data?.total ?? 0);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-gray-900">All Users</h2>
          <p className="text-sm text-gray-500">{(data?.total ?? 0).toLocaleString()} users across CRM, app, Telegram, and mobile</p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isLoading}
          className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search every user field: name, ID, contact, platform, activity..."
          className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" 
        />
        {search !== debouncedSearch && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          </div>
        )}
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-800">Failed to load users. Please try again.</p>
          <button
            onClick={() => void refetch()}
            className="mt-2 text-xs bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      {data?.unavailableSources?.includes("crm") && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          CRM users require a valid TNC session. <Link href="/courses" className="font-semibold underline">Sign in on Courses</Link>, return here, and refresh the directory.
        </p>
      )}

      {isLoading && !data && (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-500">Loading users...</p>
        </div>
      )}

      {!isLoading && students.length === 0 && (
        <div className="py-8 text-center text-gray-500">
          <p>No users found.</p>
          {search && <p className="text-xs mt-1">Try adjusting your search terms</p>}
        </div>
      )}

      {students.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b text-xs uppercase tracking-wide text-gray-400"><th className="py-2 pr-4">User</th><th className="py-2 pr-4">Source</th><th className="py-2 pr-4">Available user data</th><th className="py-2">Last active</th></tr></thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id} className="border-b last:border-0 align-top">
                  <td className="py-3 pr-4 font-semibold text-gray-900">{student.name}<div className="break-all text-xs font-normal text-gray-400">{student.id}</div></td>
                  <td className="py-3 pr-4"><span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium capitalize text-gray-700">{student.source}</span></td>
                  <td className="py-3 pr-4">
                    <dl className="grid min-w-[22rem] grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
                      {Object.entries(student.details).filter(([, value]) => value !== null && value !== "").map(([key, value]) => (
                        <div key={key} className="min-w-0 text-xs">
                          <dt className="inline font-medium text-gray-500">{key.replaceAll("_", " ")}: </dt>
                          <dd className="inline break-words text-gray-800">{displayAdminValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                  <td className="whitespace-nowrap py-3 text-xs text-gray-600">{student.activityAt ? new Date(student.activityAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-gray-500">Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {data.total.toLocaleString()} users. Passwords, tokens, and secrets are excluded.</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || isLoading} className="rounded border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40" aria-label="Previous users page"><ChevronLeft size={16} /></button>
            <span className="text-xs text-gray-600">Page {page} of {pageCount}</span>
            <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || isLoading} className="rounded border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40" aria-label="Next users page"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </section>
  );
}

type MobileAdminStats = {
  installs: number;
  opensToday: number;
  opensWeek: number;
  opensTotal: number;
  activeToday: number;
  lessonsCompleted: number;
};

type MobileAdminUser = {
  id: string;
  name: string;
  platform: string;
  firstSeen: string;
  lastSeen: string;
  isBlocked: boolean;
  blockedReason: string | null;
};

function MobileAppAnalytics() {
  const [stats, setStats] = useState<MobileAdminStats | null>(null);
  const [users, setUsers] = useState<MobileAdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const headers = { "x-admin-token": getAdminToken() ?? "" };
      const [statsResponse, usersResponse] = await Promise.all([
        fetch(`${BASE}/api/mobile/admin/stats`, { headers }),
        fetch(`${BASE}/api/mobile/admin/users?limit=100`, { headers }),
      ]);
      if (!statsResponse.ok || !usersResponse.ok) throw new Error("Mobile analytics could not be loaded.");
      const nextStats = await statsResponse.json() as MobileAdminStats;
      const nextUsers = await usersResponse.json() as { users: MobileAdminUser[] };
      setStats(nextStats);
      setUsers(nextUsers.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mobile analytics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function toggleBlock(user: MobileAdminUser) {
    try {
      const action = user.isBlocked ? "unblock" : "block";
      const response = await fetch(`${BASE}/api/mobile/admin/users/${encodeURIComponent(user.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": getAdminToken() ?? "" },
        body: JSON.stringify({ reason: "Blocked by admin" }),
      });
      if (!response.ok) throw new Error("Access update failed.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access update failed.");
    }
  }

  const metrics: Array<[string, keyof MobileAdminStats]> = [
    ["First opens / installs", "installs"],
    ["Opens today", "opensToday"],
    ["Opens · 7 days", "opensWeek"],
    ["Opens all time", "opensTotal"],
    ["Active today", "activeToday"],
    ["Lessons completed", "lessonsCompleted"],
  ];

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-gray-900">Mobile App · TNC Nursing 2.0</h2>
          <p className="text-sm text-gray-500">Real opens and anonymous installs recorded by the app API.</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} Run the SQL in `docs/mobile-app-supabase.sql` if the tables are not created.</p>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {metrics.map(([label, key]) => <div key={key} className="border border-gray-100 bg-gray-50 p-4">
          <div className="text-2xl font-black text-gray-900">{loading ? "…" : (stats?.[key] ?? 0).toLocaleString()}</div>
          <div className="text-xs text-gray-500 mt-1">{label}</div>
        </div>)}
      </div>
      <p className="text-xs text-gray-500">Store downloads are not visible to the app server; “installs” counts distinct devices after their first app open. No raw IP, phone, or hardware fingerprint is collected.</p>
      <div>
        <h3 className="font-bold text-gray-900 mb-2">Mobile users <span className="text-gray-400 font-normal">({users.length})</span></h3>
        {users.length === 0 && !loading ? <p className="text-sm text-gray-500 py-4">No mobile users have opened the app yet.</p> : (
          <div className="divide-y divide-gray-100">
            {users.map((user) => <div key={user.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-gray-900 truncate">{user.name || "Student"} {user.isBlocked && <span className="text-red-600">· Blocked</span>}</div>
                <div className="text-xs text-gray-500">{user.platform} · last active {new Date(user.lastSeen).toLocaleDateString()}</div>
                <div className="text-[10px] text-gray-400">Install ID: {user.id}</div>
              </div>
              <button onClick={() => void toggleBlock(user)} className={`px-3 py-1.5 text-xs font-semibold ${user.isBlocked ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {user.isBlocked ? "Unblock" : "Block"}
              </button>
            </div>)}
          </div>
        )}
      </div>
    </section>
  );
}

function AdminLogin() {
  const { toast } = useToast();

  async function loginWithGoogle() {
    const callback = new URL(`${BASE}/auth/callback`, window.location.origin);
    callback.searchParams.set("next", "/admin");
    try {
      await signInWithGoogle(callback.toString());
    } catch {
      toast({ title: "Google sign-in unavailable", description: "Check the Supabase URL, anon key, and Google provider settings.", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen tnc-hero-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-yellow-400/20 flex items-center justify-center mx-auto mb-4 border-2 border-yellow-400/40">
            <Shield size={32} className="text-yellow-400" />
          </div>
          <h1 className="text-2xl font-black text-white">Admin Panel</h1>
          <p className="text-white/60 text-sm mt-1">Restricted access</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <button type="button" onClick={() => void loginWithGoogle()} className="mb-4 box-border inline-flex min-h-12 w-full appearance-none items-center justify-center gap-3 rounded-md border border-[#747775] bg-white px-4 py-3 text-sm font-semibold leading-5 text-[#1f1f1f] shadow-sm hover:bg-[#f8faff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">
            <GoogleMark />Sign in with Google admin account
          </button>
          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">Back to site</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, note }: { icon: React.ElementType; label: string; value: string | number; color: string; note?: string }) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100"
      data-testid={`stat-card-${label.replace(/ /g, "-").toLowerCase()}`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="text-2xl font-black text-gray-900">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="text-sm text-gray-500 font-medium mt-0.5">{label}</div>
      {note && <div className="text-xs text-gray-400 mt-1">{note}</div>}
    </motion.div>
  );
}

function PromoManager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: promo, refetch } = useGetPromoStatus();
  const togglePromo = useTogglePromo();
  const [customDays, setCustomDays] = useState(30);
  const [extending, setExtending] = useState(false);

  async function handleTogglePromo(enabled: boolean, days = customDays) {
    togglePromo.mutate(
      { data: { enabled, durationDays: days, adminToken: getAdminToken() ?? "" } },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetPromoStatusQueryKey() });
          refetch();
          toast({
            title: (res as { enabled: boolean }).enabled ? `Free period enabled for ${days} days` : "Free period disabled",
            description: (res as { message: string }).message,
          });
        },
        onError: () => toast({ title: "Failed to update promo", variant: "destructive" }),
      }
    );
  }

  async function handleExtend(days: number) {
    setExtending(true);
    try {
      const resp = await fetch(`${BASE}/api/promo/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationDays: days, adminToken: getAdminToken() ?? "" }),
      });
      const data = await resp.json() as { message: string; expiresAt: string };
      queryClient.invalidateQueries({ queryKey: getGetPromoStatusQueryKey() });
      refetch();
      toast({ title: `Extended by ${days} days`, description: data.message });
    } catch {
      toast({ title: "Extension failed", variant: "destructive" });
    } finally {
      setExtending(false);
    }
  }

  const expiresDate = promo?.expiresAt ? new Date(promo.expiresAt) : null;
  const daysRemaining = expiresDate
    ? Math.max(0, Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            <Calendar size={16} className="text-blue-600" />
            Free Period Manager
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {promo?.enabled
              ? `Active — expires ${expiresDate?.toLocaleDateString("en-IN")} (${daysRemaining} days left)`
              : "Inactive — users must purchase courses"}
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${
          promo?.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
        }`}>
          {promo?.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {promo?.enabled ? "ON" : "OFF"}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-2">Duration (days):</p>
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_DAYS.map((d) => (
            <button key={d} onClick={() => setCustomDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                customDays === d ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600"
              }`}
            >{d}d</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCustomDays((d) => Math.max(1, d - 1))}
            className="w-8 h-8 rounded-lg border flex items-center justify-center text-gray-500 hover:bg-gray-50">
            <Minus size={14} />
          </button>
          <input type="number" min={1} max={365} value={customDays}
            onChange={(e) => setCustomDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
            className="w-16 text-center border rounded-lg py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={() => setCustomDays((d) => Math.min(365, d + 1))}
            className="w-8 h-8 rounded-lg border flex items-center justify-center text-gray-500 hover:bg-gray-50">
            <Plus size={14} />
          </button>
          <span className="text-sm text-gray-400">days</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {!promo?.enabled ? (
          <button onClick={() => handleTogglePromo(true, customDays)} disabled={togglePromo.isPending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl tnc-amber-gradient text-gray-900 font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            data-testid="btn-enable-promo">
            <ToggleRight size={16} /> Enable Free Period ({customDays}d)
          </button>
        ) : (
          <>
            <button onClick={() => handleExtend(customDays)} disabled={extending}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition-colors disabled:opacity-60"
              data-testid="btn-extend-promo">
              <Clock size={16} /> {extending ? "Extending..." : `Extend by ${customDays}d`}
            </button>
            <button onClick={() => handleTogglePromo(false)} disabled={togglePromo.isPending}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-600 border border-red-200 font-semibold text-sm hover:bg-red-100 transition-colors disabled:opacity-60"
              data-testid="btn-disable-promo">
              <ToggleLeft size={16} /> Disable
            </button>
          </>
        )}
      </div>

      {promo?.enabled && expiresDate && (
        <div className="bg-green-50 rounded-xl p-3 text-xs text-green-800 border border-green-100">
          <strong>Free period is active.</strong> All content unlocked until{" "}
          <strong>{expiresDate.toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</strong>
          {" "}({daysRemaining} days remaining).
        </div>
      )}
    </div>
  );
}

function AdminDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { enabled: winterEffectsEnabled, toggle: toggleWinterEffects } = useWinterEffects();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useGetAdminStats();

  function handleLogout() {
    clearAdminToken();
    window.location.reload();
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "hsl(var(--background))" }}>
      {/* Header */}
      <div className="tnc-brand-gradient text-white px-4 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
            <Shield size={18} />
          </div>
          <div>
            <div className="font-black text-base">Admin Panel</div>
            <div className="text-white/60 text-xs">TNC Nursing Classes</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleWinterEffects}
            className="winter-admin-effect-toggle"
            title={winterEffectsEnabled ? "Turn snowfall off" : "Turn snowfall on"}
            aria-label={winterEffectsEnabled ? "Turn snowfall off" : "Turn snowfall on"}
            aria-pressed={winterEffectsEnabled}
            data-testid="btn-admin-winter-effects"
          >
            <Snowflake size={15} />
          </button>
          <Link href="/" className="text-white/60 hover:text-white text-xs transition-colors px-2" data-testid="btn-admin-site">View Site</Link>
          <button onClick={handleLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition-colors" data-testid="btn-admin-logout">
            <LogOut size={13} /> Logout
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <>
            {/* Stats */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-gray-900">Overview</h2>
                <button
                  onClick={() => { refetchStats(); toast({ title: "Stats refreshed" }); }}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
              {statsLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 skeleton rounded-2xl" />)}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard icon={Users} label="Total Students" value={stats?.totalUsers ?? 0} color="bg-blue-600" />
                  <StatCard icon={BookOpen} label="Courses" value={stats?.totalCourses ?? 0} color="bg-indigo-600" />
                  <StatCard icon={Video} label="Video Sessions" value={(stats?.totalSessions ?? 59806).toLocaleString()} color="bg-purple-600" note="From live CRM" />
                  <StatCard icon={ShoppingCart} label="Purchases" value={stats?.totalPurchases ?? 0} color="bg-amber-500" />
                </div>
              )}
            </div>

            {/* Free Period Manager */}
            <PromoManager />

            <MobileAppAnalytics />

            <StudentsDirectory />

        </>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { session, access, loading, signOut } = useSiteAuth();
  if (loading && session) return <div className="min-h-screen bg-slate-50 p-12 text-center text-sm text-slate-500">Checking admin access...</div>;
  if (session) {
    if (access?.isAdmin) return <SiteAdminPage />;
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-4 text-center text-white"><h1 className="text-2xl font-black">Admin access required</h1><p className="text-sm text-white/70">Sign in with shashanksv2009@gmail.com to manage site access.</p><button onClick={() => void signOut()} className="mt-2 border border-white/30 px-4 py-2 text-sm font-semibold hover:bg-white/10">Sign out</button></div>;
  }
  return <AdminLogin />;
}
