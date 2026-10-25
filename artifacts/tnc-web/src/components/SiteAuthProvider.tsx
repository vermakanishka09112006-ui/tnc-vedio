import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { customFetch } from "@/lib/api-client/custom-fetch";
import { getSupabaseClient } from "@/lib/supabase";

export interface SiteAccessStatus {
  userId: string;
  email: string;
  displayName: string;
  status: "pending" | "approved" | "denied" | "blocked";
  adminRole: "admin" | "super_admin" | null;
  requestedAt: string;
  approvedUntil: string | null;
  denialReason: string | null;
  blockedUntil: string | null;
  blockedReason: string | null;
  isAdmin: boolean;
}

interface SiteAuthContextValue {
  session: Session | null;
  access: SiteAccessStatus | null;
  loading: boolean;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SiteAuthContext = createContext<SiteAuthContextValue | null>(null);

export function SiteAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<SiteAccessStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAccess(currentSession: Session | null): Promise<void> {
    if (!currentSession) {
      setAccess(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await customFetch<SiteAccessStatus>("/api/site-access/status", {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      });
      setAccess(result);
    } catch {
      setAccess(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => {};
    let removeActivityListener: () => void = () => {};
    void getSupabaseClient().then(async (client) => {
      if (!active) return;
      if (!client) {
        setLoading(false);
        return;
      }
      const { data } = await client.auth.getSession();
      if (!active) return;
      let currentSession = data.session;
      setSession(data.session);
      void loadAccess(data.session);
      const syncLocalActivity = () => {
        if (!currentSession) return;
        const read = (key: string): Record<string, unknown> => {
          try {
            const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
            return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
          } catch {
            return {};
          }
        };
        const watchHistory = read("tnc_streak");
        const studyData = {
          currentStreak: watchHistory.currentStreak ?? 0,
          longestStreak: watchHistory.longestStreak ?? 0,
          lastStudyDate: watchHistory.lastStudyDate ?? null,
          completedVideos: watchHistory.completedVideos ?? {},
          completedQuizzes: watchHistory.completedQuizzes ?? {},
        };
        void customFetch("/api/site-activity/sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${currentSession.access_token}` },
          body: JSON.stringify({ watchHistory, studyData, favorites: read("tnc_favorites") }),
        }).catch(() => undefined);
      };
      const hydrateAndSyncActivity = async (targetSession: Session) => {
        try {
          const saved = await customFetch<{ favorites?: Record<string, unknown> }>("/api/site-activity", {
            headers: { Authorization: `Bearer ${targetSession.access_token}` },
          });
          if (currentSession?.user.id !== targetSession.user.id) return;
          const localFavorites = read("tnc_favorites");
          const remoteFavorites = saved.favorites ?? {};
          const mergeList = (key: "courses" | "quizzes") => [...new Set([
            ...(Array.isArray(remoteFavorites[key]) ? remoteFavorites[key] as string[] : []),
            ...(Array.isArray(localFavorites[key]) ? localFavorites[key] as string[] : []),
          ].filter((value): value is string => typeof value === "string"))];
          localStorage.setItem("tnc_favorites", JSON.stringify({ courses: mergeList("courses"), quizzes: mergeList("quizzes") }));
          window.dispatchEvent(new Event("tnc-site-activity-updated"));
        } catch {
          if (currentSession?.user.id === targetSession.user.id) syncLocalActivity();
        }
      };
      window.addEventListener("tnc-site-activity-updated", syncLocalActivity);
      removeActivityListener = () => window.removeEventListener("tnc-site-activity-updated", syncLocalActivity);
      if (data.session) void hydrateAndSyncActivity(data.session);
      const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
        currentSession = nextSession;
        setSession(nextSession);
        void loadAccess(nextSession);
        if (nextSession) void hydrateAndSyncActivity(nextSession);
      });
      unsubscribe = () => authListener.subscription.unsubscribe();
    });
    return () => {
      active = false;
      unsubscribe();
      removeActivityListener();
    };
  }, []);

  useEffect(() => {
    if (access?.status !== "approved" || !access.approvedUntil || !session) return;
    const remaining = Date.parse(access.approvedUntil) - Date.now();
    if (remaining <= 0) {
      void loadAccess(session);
      return;
    }
    const timer = window.setTimeout(() => void loadAccess(session), remaining + 250);
    return () => window.clearTimeout(timer);
  }, [access?.approvedUntil, access?.status, session]);

  async function refreshAccess(): Promise<void> {
    await loadAccess(session);
  }

  async function signOut(): Promise<void> {
    const client = await getSupabaseClient();
    if (client) await client.auth.signOut();
    setSession(null);
    setAccess(null);
  }

  return (
    <SiteAuthContext.Provider value={{ session, access, loading, refreshAccess, signOut }}>
      {children}
    </SiteAuthContext.Provider>
  );
}

export function useSiteAuth(): SiteAuthContextValue {
  const context = useContext(SiteAuthContext);
  if (!context) throw new Error("useSiteAuth must be used inside SiteAuthProvider");
  return context;
}