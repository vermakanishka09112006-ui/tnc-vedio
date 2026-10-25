import { Router, type Request, type Response, type NextFunction } from "express";
import { getSupabaseAdmin } from "../lib/supabase-server";
import { sendAccessDecisionEmail } from "../lib/access-notifications";

const router = Router();
const ADMIN_EMAIL = "shashanksv2009@gmail.com";

router.get("/site-auth/config", (_req: Request, res: Response): void => {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const supabasePublicKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublicKey) {
    res.status(503).json({ error: "Public Supabase URL and anon/publishable key are not configured" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ supabaseUrl, supabasePublicKey });
});

export interface SiteIdentity {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface SiteAccessRecord {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: "pending" | "approved" | "denied" | "blocked";
  requested_at: string;
  approved_until: string | null;
  admin_notified_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  denial_reason: string | null;
  blocked_until: string | null;
  blocked_reason: string | null;
  status_before_block: "pending" | "approved" | "denied";
}

export async function getSiteIdentity(req: Request): Promise<SiteIdentity | null> {
  const authorization = req.header("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user?.email) return null;
  const metadata = data.user.user_metadata ?? {};
  const name = typeof metadata.full_name === "string"
    ? metadata.full_name
    : typeof metadata.name === "string" ? metadata.name : "";
  const avatarCandidate = typeof metadata.avatar_url === "string"
    ? metadata.avatar_url
    : typeof metadata.picture === "string" ? metadata.picture : "";
  let avatarUrl: string | null = null;
  try {
    const parsed = new URL(avatarCandidate);
    if (parsed.protocol === "https:" && (parsed.hostname === "googleusercontent.com" || parsed.hostname.endsWith(".googleusercontent.com"))) {
      avatarUrl = parsed.toString();
    }
  } catch {
    // Ignore malformed profile image URLs from auth metadata.
  }
  return { id: data.user.id, email: data.user.email.toLowerCase(), name, avatarUrl };
}

async function ensureAccessRecord(identity: SiteIdentity): Promise<SiteAccessRecord> {
  const admin = getSupabaseAdmin();
  const { data: existing, error: readError } = await admin
    .from("site_access")
    .select("*")
    .eq("user_id", identity.id)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    if (existing.email !== identity.email || existing.display_name !== identity.name || existing.avatar_url !== identity.avatarUrl) {
      const { data, error } = await admin.from("site_access")
        .update({
          email: identity.email,
          display_name: identity.name || existing.display_name,
          avatar_url: identity.avatarUrl,
        })
        .eq("user_id", identity.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as SiteAccessRecord;
    }
    return existing as SiteAccessRecord;
  }

  const { data, error } = await admin.from("site_access")
    .insert({
      user_id: identity.id,
      email: identity.email,
      display_name: identity.name,
      avatar_url: identity.avatarUrl,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as SiteAccessRecord;
}

async function effectiveAccessRecord(identity: SiteIdentity): Promise<SiteAccessRecord> {
  if (identity.email === ADMIN_EMAIL) {
    return {
      user_id: identity.id,
      email: identity.email,
      display_name: "Admin",
      status: "approved",
      requested_at: new Date().toISOString(),
      approved_until: null,
      admin_notified_at: null,
      reviewed_at: null,
      reviewed_by: null,
      denial_reason: null,
      blocked_until: null,
      blocked_reason: null,
      status_before_block: "approved",
    };
  }

  let record = await ensureAccessRecord(identity);
  if (record.status === "blocked" && record.blocked_until && Date.parse(record.blocked_until) <= Date.now()) {
    const { data, error } = await getSupabaseAdmin().from("site_access")
      .update({
        status: record.status_before_block,
        blocked_until: null,
        blocked_reason: null,
      })
      .eq("user_id", identity.id)
      .select("*")
      .single();
    if (error) throw error;
    record = data as SiteAccessRecord;
  }
  if (record.status === "approved" && record.approved_until && Date.parse(record.approved_until) <= Date.now()) {
    const { data, error } = await getSupabaseAdmin().from("site_access")
      .update({ status: "pending", approved_until: null })
      .eq("user_id", identity.id)
      .select("*")
      .single();
    if (error) throw error;
    record = data as SiteAccessRecord;
  }
  return record;
}

export async function requireApprovedSiteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Sign in with Google to access learning content", code: "SITE_LOGIN_REQUIRED" });
      return;
    }
    const access = await effectiveAccessRecord(identity);
    if (access.status !== "approved") {
      res.status(403).json({
        error: access.status === "blocked" ? access.blocked_reason ?? "Your account is blocked" : "Learning access is not approved",
        code: access.status === "blocked" ? "SITE_ACCESS_BLOCKED" : `SITE_ACCESS_${access.status.toUpperCase()}`,
        status: access.status,
        reason: access.status === "denied" ? access.denial_reason : access.blocked_reason,
        blockedUntil: access.blocked_until,
      });
      return;
    }
    next();
  } catch (error) {
    res.status(503).json({ error: "Access status could not be checked", code: "SITE_ACCESS_UNAVAILABLE" });
  }
}

async function requireAdmin(req: Request, res: Response): Promise<SiteIdentity | null> {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity || identity.email !== ADMIN_EMAIL) {
      res.status(403).json({ error: "Admin access is restricted" });
      return null;
    }
    return identity;
  } catch {
    res.status(503).json({ error: "Admin access could not be verified" });
    return null;
  }
}

router.get("/site-access/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Sign in with Google first" });
      return;
    }
    const access = await effectiveAccessRecord(identity);
    res.json({
      userId: access.user_id,
      email: access.email,
      displayName: access.display_name,
      status: access.status,
      requestedAt: access.requested_at,
      approvedUntil: access.approved_until,
      denialReason: access.denial_reason,
      blockedUntil: access.blocked_until,
      blockedReason: access.blocked_reason,
      isAdmin: identity.email === ADMIN_EMAIL,
    });
  } catch {
    res.status(503).json({ error: "Access request could not be created or loaded" });
  }
});

router.get("/admin/site-access", async (req: Request, res: Response): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  if (!["all", "pending", "approved", "denied", "blocked"].includes(status)) {
    res.status(400).json({ error: "Invalid access status" });
    return;
  }
  try {
    let query = getSupabaseAdmin().from("site_access").select("*").order("requested_at", { ascending: false });
    if (status !== "all") query = query.eq("status", status);
    query = query.limit(1000);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ users: (data ?? []).map((user) => ({
      userId: user.user_id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      status: user.status,
      requestedAt: user.requested_at,
      reviewedAt: user.reviewed_at,
      reviewedBy: user.reviewed_by,
      approvedUntil: user.approved_until,
      denialReason: user.denial_reason,
      blockedUntil: user.blocked_until,
      blockedReason: user.blocked_reason,
      statusBeforeBlock: user.status_before_block,
    })) });
  } catch {
    res.status(500).json({ error: "Could not load site access requests" });
  }
});

router.post("/site-activity/sync", async (req: Request, res: Response): Promise<void> => {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Sign in with Google to save study activity" });
      return;
    }
    const { watchHistory, studyData, favorites } = req.body ?? {};
    const isObject = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value);
    if (!isObject(watchHistory) || !isObject(studyData) || !isObject(favorites)) {
      res.status(400).json({ error: "Activity snapshot must contain watchHistory, studyData, and favorites objects" });
      return;
    }
    if (JSON.stringify({ watchHistory, studyData, favorites }).length > 250_000) {
      res.status(413).json({ error: "Activity snapshot exceeds the allowed size" });
      return;
    }
    const { error } = await getSupabaseAdmin().rpc("sync_site_user_activity", {
      p_user_id: identity.id,
      p_watch_history: watchHistory,
      p_study_data: studyData,
      p_favorites: favorites,
    });
    if (error) throw error;
    res.json({ saved: true });
  } catch {
    res.status(500).json({ error: "Could not save study activity" });
  }
});

router.get("/admin/site-access/:userId/activity", async (req: Request, res: Response): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { data, error } = await getSupabaseAdmin().from("site_user_activity")
      .select("watch_history,study_data,favorites,updated_at")
      .eq("user_id", req.params.userId)
      .maybeSingle();
    if (error) throw error;
    res.json(data ?? { watch_history: {}, study_data: {}, favorites: {}, updated_at: null });
  } catch {
    res.status(500).json({ error: "Could not load user study activity" });
  }
});

router.post("/site-access/notify-admin", async (req: Request, res: Response): Promise<void> => {
  try {
    const identity = await getSiteIdentity(req);
    if (!identity) {
      res.status(401).json({ error: "Sign in with Google first" });
      return;
    }
    const access = await effectiveAccessRecord(identity);
    if (access.status !== "pending") {
      res.status(409).json({ error: "Only pending requests can notify the administrator" });
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
    const adminIds = [process.env.ADMIN_CHAT_ID, process.env.ADMIN_TELEGRAM_ID, process.env.TELEGRAM_ADMIN_ID]
      .flatMap((value) => (value ?? "").split(","))
      .map((value) => value.trim())
      .filter((value) => /^-?\d+$/.test(value));
    if (!botToken || adminIds.length === 0) {
      res.status(503).json({ error: "Telegram admin notifications are not configured" });
      return;
    }

    if (access.admin_notified_at && Date.now() - Date.parse(access.admin_notified_at) < 15 * 60 * 1000) {
      res.status(429).json({ error: "The administrator was notified recently. Please wait before notifying again." });
      return;
    }

    const now = new Date().toISOString();
    const { error: updateError } = await getSupabaseAdmin().from("site_access")
      .update({ admin_notified_at: now })
      .eq("user_id", identity.id);
    if (updateError) throw updateError;

    const text = [
      "A student is waiting for TNC Nursing site access approval.",
      `Name: ${identity.name || access.display_name || "Student"}`,
      `Email: ${identity.email}`,
    ].join("\n");
    const delivery = await Promise.all(adminIds.map(async (chatId) => {
      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(8_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    }));
    if (!delivery.some(Boolean)) {
      await getSupabaseAdmin().from("site_access").update({ admin_notified_at: null }).eq("user_id", identity.id);
      res.status(502).json({ error: "The Telegram notification could not be delivered" });
      return;
    }
    res.json({ notified: true });
  } catch {
    res.status(500).json({ error: "Could not notify the administrator" });
  }
});

router.post("/admin/site-access/:userId/decision", async (req: Request, res: Response): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const status = req.body?.status;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  const requestedDuration = req.body?.durationHours;
  const durationHours = requestedDuration === null
    ? null
    : requestedDuration === undefined
      ? 720
      : Number(requestedDuration);
  if (status !== "approved" && status !== "denied") {
    res.status(400).json({ error: "Decision must be approved or denied" });
    return;
  }
  if (status === "approved" && durationHours !== null && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 8760)) {
    res.status(400).json({ error: "Approval duration must be from 1 to 8760 hours, or null for permanent access" });
    return;
  }
  try {
    const approvedUntil = status === "approved" && durationHours !== null
      ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()
      : null;
    const { data, error } = await getSupabaseAdmin().from("site_access")
      .update({
        status,
        approved_until: approvedUntil,
        reviewed_at: new Date().toISOString(),
        reviewed_by: identity.email,
        denial_reason: status === "denied" ? reason || null : null,
        blocked_until: null,
        blocked_reason: null,
      })
      .eq("user_id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;
    const email = await sendAccessDecisionEmail({
      email: data.email,
      displayName: data.display_name,
      decision: status,
      reason: data.denial_reason,
      approvedUntil,
    });
    res.json({ user: data, emailSent: email.sent, emailReason: email.sent ? null : email.reason });
  } catch {
    res.status(500).json({ error: "Could not update the access request" });
  }
});

router.post("/admin/site-access/:userId/block", async (req: Request, res: Response): Promise<void> => {
  const identity = await requireAdmin(req, res);
  if (!identity) return;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  const durationHours = req.body?.durationHours;
  if (!reason || (durationHours !== null && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 8760))) {
    res.status(400).json({ error: "Provide a reason and a valid duration in hours, or null for a permanent block" });
    return;
  }
  try {
    const admin = getSupabaseAdmin();
    const { data: current, error: readError } = await admin.from("site_access")
      .select("status,status_before_block,email")
      .eq("user_id", req.params.userId)
      .single();
    if (readError) throw readError;
    if (current.email?.toLowerCase() === ADMIN_EMAIL) {
      res.status(400).json({ error: "The site administrator cannot be blocked here" });
      return;
    }
    const blockedUntil = durationHours === null ? null : new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin.from("site_access")
      .update({
        status: "blocked",
        status_before_block: current.status === "blocked" ? current.status_before_block : current.status,
        blocked_until: blockedUntil,
        blocked_reason: reason,
      })
      .eq("user_id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch {
    res.status(500).json({ error: "Could not block this user" });
  }
});

router.post("/admin/site-access/:userId/unblock", async (req: Request, res: Response): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  try {
    const admin = getSupabaseAdmin();
    const { data: current, error: readError } = await admin.from("site_access")
      .select("status,status_before_block")
      .eq("user_id", req.params.userId)
      .single();
    if (readError) throw readError;
    if (current.status !== "blocked") {
      res.status(400).json({ error: "This user is not blocked" });
      return;
    }
    const { data, error } = await admin.from("site_access")
      .update({ status: current.status_before_block, blocked_until: null, blocked_reason: null })
      .eq("user_id", req.params.userId)
      .select("*")
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch {
    res.status(500).json({ error: "Could not unblock this user" });
  }
});

export default router;