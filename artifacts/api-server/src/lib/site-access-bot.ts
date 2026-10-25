import type { Context } from "telegraf";
import { getSupabaseAdmin } from "./supabase-server";
import { sendAccessDecisionEmail, type AccessDecision } from "./access-notifications";
import { isAdmin } from "./admin";

type SiteAccessStatus = "pending" | "approved" | "denied" | "blocked";

interface SiteAccessUser {
  user_id: string;
  email: string;
  display_name: string;
  status: SiteAccessStatus;
  requested_at: string;
  approved_until: string | null;
  denial_reason: string | null;
  blocked_until: string | null;
  blocked_reason: string | null;
  status_before_block: "pending" | "approved" | "denied";
}

function parseDuration(value: string | undefined, defaultHours?: number): number | null | undefined {
  if (value === "permanent") return null;
  if (value === undefined && defaultHours !== undefined) return defaultHours;
  if (!value) return undefined;
  const hours = Number(value);
  return Number.isInteger(hours) && hours >= 1 && hours <= 8760 ? hours : undefined;
}

function emailDeliveryText(result: Awaited<ReturnType<typeof sendAccessDecisionEmail>>): string {
  if (result.sent) return "Email sent.";
  return result.reason === "not_configured"
    ? "Email not sent: configure RESEND_API_KEY and ACCESS_EMAIL_FROM on the API service."
    : "Email provider could not deliver the notification.";
}

async function findUserByEmail(email: string): Promise<SiteAccessUser | null> {
  const { data, error } = await getSupabaseAdmin().from("site_access")
    .select("user_id,email,display_name,status,requested_at,approved_until,denial_reason,blocked_until,blocked_reason,status_before_block")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw error;
  return data as SiteAccessUser | null;
}

export async function handleSiteAccessCommand(ctx: Context): Promise<void> {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.reply("Admin only.");
    return;
  }
  if (!ctx.message || !("text" in ctx.message)) return;

  const args = ctx.message.text.replace(/^\/access(?:@\w+)?\s*/i, "").trim().split(/\s+/).filter(Boolean);
  const action = (args[0] ?? "help").toLowerCase();
  const admin = getSupabaseAdmin();

  if (["pending", "approved", "denied", "blocked", "all"].includes(action)) {
    let query = admin.from("site_access")
      .select("email,display_name,status,requested_at,approved_until,blocked_until,denial_reason,blocked_reason")
      .order("requested_at", { ascending: false })
      .limit(25);
    if (action !== "all") query = query.eq("status", action);
    const { data, error } = await query;
    if (error) throw error;
    const users = (data ?? []) as Array<Pick<SiteAccessUser, "email" | "display_name" | "status" | "requested_at" | "approved_until" | "blocked_until" | "denial_reason" | "blocked_reason">>;
    if (!users.length) {
      await ctx.reply(`No ${action} site access requests.`);
      return;
    }
    const lines = users.map((user) => {
      const extra = user.status === "approved" && user.approved_until
        ? ` · until ${new Date(user.approved_until).toLocaleString()}`
        : user.status === "blocked"
          ? ` · ${user.blocked_until ? `until ${new Date(user.blocked_until).toLocaleString()}` : "permanent"}`
          : "";
      return `• ${user.display_name || "Student"} <${user.email}> · ${user.status}${extra}`;
    });
    await ctx.reply(`Site access · ${action} (latest ${users.length})\n\n${lines.join("\n")}`);
    return;
  }

  if (action === "help") {
    await ctx.reply([
      "Site access commands:",
      "/access pending|approved|denied|blocked|all",
      "/access approve <email> [hours|permanent]",
      "/access deny <email> [reason]",
      "/access block <email> <hours|permanent> <reason>",
      "/access unblock <email>",
    ].join("\n"));
    return;
  }

  const email = args[1]?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await ctx.reply("Provide the user's email address. Use /access for command help.");
    return;
  }

  const user = await findUserByEmail(email);
  if (!user) {
    await ctx.reply("No site access request found for that email.");
    return;
  }

  const now = new Date().toISOString();
  let decision: AccessDecision | "blocked" | "unblocked";
  let update: Record<string, unknown>;
  let emailInput: Parameters<typeof sendAccessDecisionEmail>[0];

  if (action === "approve") {
    const hours = parseDuration(args[2], 720);
    if (hours === undefined) {
      await ctx.reply("Use an approval duration from 1 to 8760 hours, or 'permanent'.");
      return;
    }
    decision = "approved";
    const approvedUntil = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    update = { status: "approved", approved_until: approvedUntil, denial_reason: null, blocked_until: null, blocked_reason: null, reviewed_at: now, reviewed_by: `telegram:${ctx.from?.id}` };
    emailInput = { email: user.email, displayName: user.display_name, decision, reason: null, approvedUntil };
  } else if (action === "deny") {
    decision = "denied";
    const reason = args.slice(2).join(" ").trim() || null;
    update = { status: "denied", approved_until: null, denial_reason: reason, blocked_until: null, blocked_reason: null, reviewed_at: now, reviewed_by: `telegram:${ctx.from?.id}` };
    emailInput = { email: user.email, displayName: user.display_name, decision, reason };
  } else if (action === "block") {
    const hours = parseDuration(args[2]);
    const reason = args.slice(3).join(" ").trim();
    if (hours === undefined || !reason) {
      await ctx.reply("Usage: /access block <email> <hours|permanent> <reason>");
      return;
    }
    if (user.email.toLowerCase() === "shashanksv2009@gmail.com") {
      await ctx.reply("The site administrator cannot be blocked.");
      return;
    }
    decision = "blocked";
    const blockedUntil = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    update = { status: "blocked", status_before_block: user.status === "blocked" ? user.status_before_block : user.status, blocked_until: blockedUntil, blocked_reason: reason };
    emailInput = { email: user.email, displayName: user.display_name, decision, reason, blockedUntil };
  } else if (action === "unblock") {
    if (user.status !== "blocked") {
      await ctx.reply("That user is not blocked.");
      return;
    }
    decision = "unblocked";
    update = { status: user.status_before_block, blocked_until: null, blocked_reason: null };
    emailInput = { email: user.email, displayName: user.display_name, decision, reason: user.blocked_reason, restoredStatus: user.status_before_block };
  } else {
    await ctx.reply("Unknown site access action. Use /access for command help.");
    return;
  }

  const { data, error } = await admin.from("site_access")
    .update(update)
    .eq("user_id", user.user_id)
    .select("status")
    .single();
  if (error) throw error;

  const emailResult = await sendAccessDecisionEmail(emailInput);
  const actionLabel = decision === "approved" ? "approved" : decision === "denied" ? "denied" : decision === "blocked" ? "blocked" : "unblocked";
  await ctx.reply(`User ${user.email} ${actionLabel}; access status is ${data.status}. ${emailDeliveryText(emailResult)}`);
}
