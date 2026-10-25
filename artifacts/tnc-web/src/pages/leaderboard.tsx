import { useEffect, useState } from "react";
import { Trophy, Medal, Clock3, RefreshCw } from "lucide-react";
import Layout from "@/components/Layout";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const FEATURED_VISITOR_ROW_ID = "web_fp_v2_5363fd62d30899e6bbb8f15b1eb619f7";

interface LeaderboardRow {
  telegramId: string;
  firstName: string;
  username: string | null;
  avatarUrl?: string | null;
  seconds: number;
  sessions: number;
}

function formatStudyTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function isLeaderboardRow(value: unknown): value is LeaderboardRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LeaderboardRow>;
  return typeof row.telegramId === "string" && typeof row.firstName === "string" &&
    typeof row.seconds === "number" && Number.isFinite(row.seconds) && row.seconds >= 0 &&
    typeof row.sessions === "number" && Number.isFinite(row.sessions) && row.sessions >= 0;
}

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const loadLeaderboard = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${BASE}/api/bot/study/leaderboard?limit=100`, { cache: "no-store" });
        if (!response.ok) throw new Error("Failed to load leaderboard");
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error("Invalid leaderboard response");
        const validRows = data.filter(isLeaderboardRow).sort((a, b) => b.seconds - a.seconds);
        if (!active) return;
        setRows(validRows);
        setError(false);
        setLastUpdated(new Date());
      } catch {
        if (!active) return;
        setRows([]);
        setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLeaderboard();
    const refreshTimer = window.setInterval(() => { void loadLeaderboard(); }, 60_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [refreshKey]);

  function retry() {
    setRefreshKey((value) => value + 1);
  }

  return (
    <Layout>
      <div className="tnc-hero-gradient text-white px-4 py-10">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center">
            <Trophy size={28} className="text-yellow-300" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black">Study Leaderboard</h1>
            <p className="text-white/70 text-sm mt-1">Celebrate consistent study time with the TNC community.</p>
          </div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-16 skeleton rounded-2xl" />)}
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-red-100 p-12 text-center text-gray-500">
            <Trophy size={42} className="mx-auto text-red-200 mb-3" />
            <p className="font-semibold">Leaderboard is temporarily unavailable</p>
            <button type="button" onClick={retry} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Try again</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center text-gray-500">
            <Trophy size={42} className="mx-auto text-gray-200 mb-3" />
            <p className="font-semibold">No study activity yet</p>
            <p className="text-sm text-gray-400 mt-1">Start a lesson and your time will appear here.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
              <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
              <button type="button" onClick={retry} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50">
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {rows.map((row, index) => {
              const isFeaturedVisitor = row.telegramId === FEATURED_VISITOR_ROW_ID;
              return (
              <div key={row.telegramId} className={`flex items-center gap-3 px-5 py-4 border-b last:border-0 border-gray-50 ${isFeaturedVisitor ? "bg-amber-50" : ""}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black ${
                  index === 0 ? "bg-yellow-100 text-yellow-700" : index === 1 ? "bg-gray-100 text-gray-600" : index === 2 ? "bg-orange-100 text-orange-700" : "bg-blue-50 text-blue-600"
                }`}>
                  {index < 3 ? <Medal size={17} /> : index + 1}
                </div>
                {row.avatarUrl && <img src={row.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />}
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold truncate ${isFeaturedVisitor ? "text-amber-700" : "text-gray-900"}`}>{row.firstName || "Student"}</p>
                  {row.username && <p className="text-xs text-gray-400">@{row.username}</p>}
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5 text-sm font-bold text-blue-700">
                    <Clock3 size={15} />
                    {formatStudyTime(row.seconds)}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{row.sessions} sessions</div>
                </div>
              </div>
              );
            })}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}