import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase-server";
import { supabaseRequest } from "./supabase-rest";

function ensureClient() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured on server");
  return getSupabaseAdmin();
}

export interface StudySessionSummary {
  telegramId: string;
  firstName: string;
  username: string | null;
  avatarUrl: string | null;
  seconds: number;
  sessions: number;
}

export interface WebsiteStudyHeartbeat {
  visitorId: string;
  visitorName: string;
  avatarUrl: string | null;
  sessionId: string;
  seconds: number;
}

export async function recordStudyHeartbeat(input: {
  telegramId: number;
  sessionId: string;
  seconds: number;
}): Promise<void> {
  const seconds = Math.min(Math.max(Math.round(input.seconds), 0), 300);
  if (!seconds) return;
  const supabase = ensureClient();
  const { error } = await supabase.rpc("record_study_time", {
    p_telegram_id: input.telegramId,
    p_session_id: input.sessionId,
    p_seconds: seconds,
  });
  if (error) throw error;
}

export async function recordWebsiteStudyHeartbeat(input: WebsiteStudyHeartbeat): Promise<void> {
  const seconds = Math.min(Math.max(Math.round(input.seconds), 0), 300);
  const visitorId = input.visitorId.trim().slice(0, 120);
  const visitorName = input.visitorName.trim().slice(0, 80);
  if (!seconds || !visitorId || !visitorName || !input.sessionId) return;
  await supabaseRequest("rpc/record_website_study_time", {
    method: "POST",
    body: JSON.stringify({
      p_visitor_id: visitorId,
      p_visitor_name: visitorName,
      p_avatar_url: input.avatarUrl,
      p_session_id: input.sessionId,
      p_seconds: seconds,
    }),
  });
}

export async function getLeaderboard(limit = 20): Promise<StudySessionSummary[]> {
  const maxRows = Math.min(limit, 100);
  try {
    const rows = await supabaseRequest<Array<{
      participant_id: number | string;
      first_name: string;
      username: string | null;
      avatar_url: string | null;
      seconds: number;
      sessions: number;
    }>>(`study_leaderboard?select=participant_id,first_name,username,seconds,sessions&order=seconds.desc&limit=${maxRows}`);
    return rows.map((row) => ({
      telegramId: String(row.participant_id),
      firstName: row.first_name,
      username: row.username,
      avatarUrl: row.avatar_url,
      seconds: Number(row.seconds),
      sessions: Number(row.sessions),
    }));
  } catch {
    const [legacyRows, sessionRows] = await Promise.all([
      supabaseRequest<Array<{
        telegram_id: number | string;
        first_name: string;
        username: string | null;
        seconds: number;
      }>>(`study_leaderboard?select=telegram_id,first_name,username,seconds&order=seconds.desc&limit=${maxRows}`),
      supabaseRequest<Array<{ telegram_id: number | string }>>("study_sessions?select=telegram_id"),
    ]);
    const sessionCounts = new Map<string, number>();
    for (const session of sessionRows) {
      const telegramId = String(session.telegram_id);
      sessionCounts.set(telegramId, (sessionCounts.get(telegramId) ?? 0) + 1);
    }
    return legacyRows.map((row) => ({
      telegramId: `telegram_${row.telegram_id}`,
      firstName: row.first_name,
      username: row.username,
      avatarUrl: null,
      seconds: Number(row.seconds),
      sessions: sessionCounts.get(String(row.telegram_id)) ?? 0,
    }));
  }
}
