import { Telegraf } from "telegraf";
import { logger } from "./logger";
import {
  upsertUser,
  checkBannedStore,
  banUser,
  unbanUser,
  getAllUsers,
  getStats,
} from "./user-store";
import { getRandomSfwImage } from "./waifu";
import { isAdmin } from "./admin";
import { handleSiteAccessCommand } from "./site-access-bot";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? process.env.BOT_TOKEN;
const APP_URL = process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.RENDER_URL ?? "https://courses.tncnursing.site";

export let bot: Telegraf | null = null;

// Helper to escape MarkdownV2 special characters
function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function sendWelcomeMessage(ctx: any, user: { id: number; first_name: string; username?: string }) {
  const appUrl = APP_URL;
  const imageUrl = await Promise.race([
    getRandomSfwImage(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);
  
  const welcomeText = `🏥 *Welcome to TNC Nursing Classes!*

Access all courses, video lectures, quizzes, and e-notes for your nursing exam preparation.

${appUrl ? `Tap the button below to open the app 👇\n\n🌐 ${appUrl}` : "Visit the app to start studying."}`;

  // Escape the entire message for MarkdownV2
  const escapedWelcomeText = escapeMarkdownV2(welcomeText);

  const replyOpts: Record<string, unknown> = { parse_mode: "MarkdownV2" };

  if (appUrl) {
    const keyboard: { text: string; web_app: { url: string } }[][] = [[
      { text: "📚 Open TNC Nursing App", web_app: { url: appUrl } },
    ]];
    if (isAdmin(user?.id)) {
      keyboard.push([
        { text: "🛡️ Admin Panel", web_app: { url: `${appUrl}/admin` } },
      ]);
    }
    replyOpts.reply_markup = { inline_keyboard: keyboard };
  }

  try {
    if (imageUrl) {
      await ctx.replyWithPhoto?.(imageUrl, { caption: escapedWelcomeText, parse_mode: "MarkdownV2", ...replyOpts });
      return;
    }
    await ctx.reply(escapedWelcomeText, replyOpts);
  } catch (err) {
    logger.error({ err, user: user.id }, "Failed to send welcome message with image, trying without");
    // Fallback without image
    try {
      await ctx.reply(escapedWelcomeText, { parse_mode: "MarkdownV2", ...replyOpts });
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr, user: user.id }, "Failed to send welcome message even without image");
      // Last resort - plain text (no markdown)
      await ctx.reply("🏥 Welcome to TNC Nursing Classes!\n\nAccess all courses, video lectures, quizzes, and e-notes for your nursing exam preparation.\n\n" + (appUrl ? `Tap the button below to open the app 👇\n\n${appUrl}` : "Visit the app to start studying."), { ...replyOpts, parse_mode: undefined });
    }
  }
}

export async function upsertBotUser(user: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}): Promise<Record<string, unknown>> {
  return (await upsertUser(user)) as unknown as Record<string, unknown>;
}

export async function checkBanned(
  telegramId: number,
): Promise<{ banned: boolean; reason?: string }> {
  return checkBannedStore(telegramId);
}

export function initBot(): Telegraf | null {
  if (!BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
    return null;
  }

  const tgBot = new Telegraf(BOT_TOKEN);
  bot = tgBot;
  tgBot.catch((err, ctx) => {
    logger.error({ err, updateId: ctx.update.update_id }, "Unhandled Telegram bot update error");
  });
  void tgBot.telegram.setMyCommands([
    { command: "start", description: "Open TNC Nursing Classes" },
    { command: "help", description: "Show available commands" },
    { command: "leaderboard", description: "View study leaderboard" },
    { command: "access", description: "Manage website access requests (admin)" },
  ]).catch((err) => logger.warn({ err }, "Failed to register Telegram commands"));

  const appUrl = APP_URL;
  const pendingBroadcasts = new Set<number>();
  // /start — welcome + open mini app button
  tgBot.start(async (ctx) => {
    try {
      const user = ctx.from;
      logger.info({ user }, "/start received");
      if (user) await upsertUser(user);

      const banStatus = user ? await checkBannedStore(user.id) : { banned: false };
      if (banStatus.banned) {
        await ctx.reply("🚫 You are blocked and cannot access this platform.");
        return;
      }

      // Use the new sendWelcomeMessage function
      if (user) {
        await sendWelcomeMessage(ctx, user);
      }
    } catch (err) {
      logger.error({ err }, "Error in /start handler");
      try {
        await ctx.reply("⚠️ An unexpected error occurred. Please try again later.");
      } catch {
        // ignore
      }
    }
  });

  // /admin — show the admin command center (admin only)
  tgBot.command("admin", async (ctx) => {
    try {
      if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
      logger.info({ admin: ctx.from?.id }, "/admin requested");
      await ctx.reply(
        "🛡️ TNC Admin Center\n\n" +
        "📊 /stats - View total, active, and banned users\n" +
        "👥 /users - List recent users\n" +
        "📚 /admin - Show this admin menu\n" +
        "🧾 /user <telegram_id> - View one user\n" +
        "🚫 /ban <telegram_id> [reason] - Ban a user\n" +
        "✅ /unban <telegram_id> - Unban a user\n" +
        "🔐 /access pending|approved|denied|blocked|all - View site access requests\n" +
        "🔐 /access approve|deny|block|unblock <email> ... - Manage site access\n" +
        "⛔ /banned - List banned users\n" +
        "🏆 /leaderboard - View study leaderboard\n" +
        "📣 /broadcast - Send text/media to all users\n" +
        "🔄 /comeback - Manually send an update message\n" +
        "❌ /cancel - Cancel a pending broadcast\n\n" +
        "Use /help for this command list.",
      );
    } catch (err) {
      logger.error({ err }, "Error in /admin handler");
      try { await ctx.reply("⚠️ Admin command failed. Please check server logs and Supabase connection."); } catch {}
    }
  });

  // /help
  tgBot.help(async (ctx) => {
    const admin = isAdmin(ctx.from?.id);
    const adminCmds = admin
      ? "\n\nAdmin Commands:\n/admin, /stats, /users, /user <id>, /ban <id> [reason], /unban <id>, /banned, /leaderboard, /access, /broadcast, /comeback, /cancel"
      : "";
    await ctx.reply(
      `TNC Nursing Classes Bot\n\n/start - Open the app${adminCmds}`,
    );
  });

    tgBot.command("access", async (ctx) => {
      try {
        await handleSiteAccessCommand(ctx);
      } catch (err) {
        logger.error({ err, adminId: ctx.from?.id }, "Site access bot command failed");
        await ctx.reply("Could not manage site access. Check the database connection and try again.");
      }
    });

  // /comeback — Send message to all users (bot back online)
  tgBot.command("comeback", async (ctx) => {
    try {
      if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
      logger.info({ admin: ctx.from?.id }, "/comeback requested - sending messages to all users");
      
      // Check if Supabase is configured
      const { isSupabaseConfigured } = await import("./supabase-server");
      if (!isSupabaseConfigured()) {
        await ctx.reply("⚠️ Database not configured. Please check Supabase connection.");
        return;
      }

      const { claimComebackNotification } = await import("./broadcast");
      if (!(await claimComebackNotification())) {
        await ctx.reply("A come back online notification was already sent in the last 24 hours.");
        return;
      }
      
      await ctx.reply("✅ Come back online notification queued for active users.");
      void sendComeBackOnlineMessage();
      
    } catch (err) {
      logger.error({ err }, "Error in /comeback handler");
      try { await ctx.reply("⚠️ Could not send come back online messages. Please check server logs."); } catch {}
    }
  });

  // /stats (admin)
  tgBot.command("stats", async (ctx) => {
    try {
      if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
      const { total, banned, active } = await getStats();
      await ctx.reply(`📊 Bot Stats\n\n👥 Total users: ${total}\n✅ Active: ${active}\n🚫 Banned: ${banned}`);
    } catch (err) {
      logger.error({ err }, "Error in /stats handler");
      await ctx.reply("⚠️ Could not load stats. Check the Supabase connection.");
    }
  });

  tgBot.command("user", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
    const targetId = ctx.message.text.split(" ")[1];
    if (!targetId) { await ctx.reply("Usage: /user <telegram_id>"); return; }
    const user = await (await import("./user-store")).getUser(targetId);
    if (!user) { await ctx.reply("User not found."); return; }
    const details = [
      `Telegram ID: ${user.telegramId}`,
      `Name: ${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`,
      `Username: ${user.username ?? "—"}`,
      `Banned: ${user.isBanned ? "Yes" : "No"}`,
      `Reason: ${user.bannedReason ?? "—"}`,
      `Study Time: ${Math.round(user.totalStudySeconds / 60)} min`,
    ].join("\n");
    await ctx.reply(`User Details\n\n${details}`);
  });

  // /users (admin)
  tgBot.command("users", async (ctx) => {
    try {
      if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
      const users = (await getAllUsers()).slice(0, 15);
      if (!users.length) { await ctx.reply("No users yet"); return; }
      const list = users.map((u) =>
        `• ${u.firstName}${u.lastName ? " " + u.lastName : ""} (@${u.username ?? "—"}) — ${u.telegramId}${u.isBanned ? " 🚫" : ""}`,
      ).join("\n");
      await ctx.reply(`👥 Recent Users:\n\n${list}`);
    } catch (err) {
      logger.error({ err }, "Error in /users handler");
      await ctx.reply("⚠️ Could not load users. Check the Supabase connection.");
    }
  });

  // /ban <id> [reason] (admin)
  tgBot.command("ban", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
    const parts = ctx.message.text.split(" ").slice(1);
    const targetId = parts[0];
    const reason = parts.slice(1).join(" ") || "Banned by admin";
    if (!targetId) { await ctx.reply("Usage: /ban <telegram_id> [reason]"); return; }
    const ok = await banUser(targetId, reason);
    if (ok) {
      await ctx.reply(`✅ User ${targetId} banned.\nReason: ${reason}`);
    } else {
      await ctx.reply(`⚠️ User ${targetId} not found in store. They must open the app first.`);
    }
  });

  // /unban <id> (admin)
  tgBot.command("unban", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
    const targetId = ctx.message.text.split(" ")[1];
    if (!targetId) { await ctx.reply("Usage: /unban <telegram_id>"); return; }
    const ok = await unbanUser(targetId);
    if (ok) {
      await ctx.reply(`✅ User ${targetId} unbanned.`);
    } else {
      await ctx.reply(`⚠️ User ${targetId} not found in store.`);
    }
  });

  // /banned (admin)
  tgBot.command("banned", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
    const banned = (await getAllUsers()).filter((u) => u.isBanned);
    if (!banned.length) { await ctx.reply("No banned users"); return; }
    const text = banned.map((u) =>
      `• ${u.firstName} (@${u.username ?? "—"}) — ${u.telegramId}\n  Reason: ${u.bannedReason ?? "none"}`,
    ).join("\n\n");
    await ctx.reply(`🚫 Banned Users:\n\n${text}`);
  });

  tgBot.command("leaderboard", async (ctx) => {
    const { getLeaderboard } = await import("./study-store");
    try {
      const rows = await getLeaderboard(10);
      if (!rows.length) { await ctx.reply("No study activity recorded yet."); return; }
      const text = rows.map((row, index) =>
        `${index + 1}. ${row.firstName}${row.username ? ` (@${row.username})` : ""} — ${Math.round(row.seconds / 60)} min (${row.sessions} sessions)`,
      ).join("\n");
      await ctx.reply(`🏆 Study Leaderboard\n\n${text}`);
    } catch (err) {
      logger.error({ err }, "Error in /leaderboard handler");
      await ctx.reply("⚠️ Leaderboard is temporarily unavailable. Please try again later.");
    }
  });

  // Copy the admin's next message to all active users. This preserves text,
  // images, videos, stickers, and emoji without storing media in the database.
  tgBot.command("broadcast", async (ctx) => {
    try {
      if (!isAdmin(ctx.from?.id)) { await ctx.reply("❌ Admin only"); return; }
      pendingBroadcasts.add(ctx.from!.id);
      const commandText = "text" in ctx.message ? ctx.message.text : "";
      const messageText = commandText.replace(/^\/broadcast(?:@\w+)?\s*/i, "").trim();
      if (messageText) {
        pendingBroadcasts.delete(ctx.from!.id);
        const users = await getAllUsers();
        const recipients = users.filter((user) => !user.isBanned && user.telegramId !== String(ctx.from!.id));
        let delivered = 0;
        let failed = 0;
        for (const recipient of recipients) {
          try {
            await tgBot.telegram.sendMessage(recipient.telegramId, messageText);
            delivered++;
          } catch {
            failed++;
          }
        }
        await ctx.reply(`📣 Broadcast complete.\n✅ Delivered: ${delivered}\n⚠️ Failed: ${failed}`);
        return;
      }
      await ctx.reply("📣 Send the message to broadcast now. Text, image, video, sticker, and emoji are supported.\n\nSend /cancel to stop.");
    } catch (err) {
      logger.error({ err }, "Error initiating broadcast");
      try { await ctx.reply("⚠️ Could not start broadcast. Check the bot admin configuration and database connection."); } catch {}
    }
  });

  tgBot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    if (pendingBroadcasts.delete(ctx.from.id)) await ctx.reply("Broadcast cancelled.");
  });

  tgBot.on("message", async (ctx) => {
    const adminId = ctx.from?.id;
    if (!adminId || !isAdmin(adminId)) return;
    if (!pendingBroadcasts.has(adminId)) {
      await ctx.reply("I received your message. Use /help for commands, or /broadcast to send it to all users.");
      return;
    }
    logger.info({ adminId, message: ctx.message }, "received broadcast content from admin");
    if ("text" in ctx.message && ctx.message.text === "/cancel") {
      pendingBroadcasts.delete(adminId);
      await ctx.reply("Broadcast cancelled.");
      return;
    }
    pendingBroadcasts.delete(adminId);
    const users = await getAllUsers();
    const recipients = users.filter((user) => !user.isBanned && user.telegramId !== String(adminId));
    let delivered = 0;
    let failed = 0;
    const batchSize = 10;
    for (let index = 0; index < recipients.length; index += batchSize) {
      const batch = recipients.slice(index, index + batchSize);
      for (const recipient of batch) {
        try {
          await tgBot.telegram.copyMessage(recipient.telegramId, ctx.chat.id, ctx.message.message_id);
          delivered += 1;
        } catch {
          failed += 1;
        }
      }
      if (index + batchSize < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    await ctx.reply(`📣 Broadcast complete.\n✅ Delivered: ${delivered}\n⚠️ Failed: ${failed}`);
    // Log broadcast in Supabase (best-effort)
    try {
      const { logBroadcast } = await import("./broadcast");
      let contentType = "text";
      let messageText: string | null = null;
      let mediaUrl: string | null = null;
      let mediaType: "photo" | "video" | "document" | "mixed" | null = null;
      
      if ("photo" in ctx.message && ctx.message.photo?.length) {
        contentType = "photo";
        mediaType = "photo";
        mediaUrl = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      } else if ("video" in ctx.message && ctx.message.video) {
        contentType = "video";
        mediaType = "video";
        mediaUrl = ctx.message.video.file_id;
      } else if ("document" in ctx.message && ctx.message.document) {
        contentType = "document";
        mediaType = "document";
        mediaUrl = ctx.message.document.file_id;
      } else if ("text" in ctx.message && typeof ctx.message.text === "string") {
        contentType = "text";
        messageText = ctx.message.text;
      } else if ("sticker" in ctx.message && ctx.message.sticker) {
        contentType = "sticker";
        mediaType = "document";
        mediaUrl = ctx.message.sticker.file_id;
      } else {
        contentType = "mixed";
        mediaType = "mixed";
      }
      
      await logBroadcast({ adminTelegramId: adminId, contentType, messageText, mediaUrl, mediaType, totalRecipients: recipients.length, successfulSends: delivered, failedSends: failed });
    } catch (err) {
      logger.warn({ err }, "Failed to record broadcast log");
    }
  });

  logger.info("Telegram bot initialized (Supabase user store)");
  return tgBot;
}

export async function setupWebhook(webhookUrl: string): Promise<void> {
  if (!bot) return;
  try {
    await bot.telegram.setWebhook(webhookUrl);
    logger.info({ webhookUrl }, "Telegram webhook configured");
  } catch (err) {
    logger.error({ err }, "Failed to set Telegram webhook");
  }
}

// Function to send "come back online" message to all users
export async function sendComeBackOnlineMessage(): Promise<void> {
  if (!bot) return;
  
  try {
    const users = await getAllUsers();
    const activeUsers = users.filter(user => !user.isBanned);
    
    if (!activeUsers.length) {
      logger.info("No active users to notify about bot coming back online");
      return;
    }
    
    const imageUrl = await getRandomSfwImage();
    const comeBackMessage = "🤖 Bot is back online!\n\nThe TNC Nursing Classes bot has returned to service. Start studying again with /start and access your courses, video lectures, quizzes, and e-notes.";
    
    const batchSize = 10;
    let delivered = 0;
    let failed = 0;
    
    for (let index = 0; index < activeUsers.length; index += batchSize) {
      const batch = activeUsers.slice(index, index + batchSize);
      for (const user of batch) {
        try {
          if (imageUrl) {
            await bot.telegram.sendPhoto(user.telegramId, imageUrl, { caption: comeBackMessage });
          } else {
            await bot.telegram.sendMessage(user.telegramId, comeBackMessage);
          }
          delivered++;
        } catch (err) {
          failed++;
          logger.warn({ userId: user.telegramId, err }, "Failed to send come back online message");
        }
      }
      
      if (index + batchSize < activeUsers.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    
    logger.info({ delivered, failed, total: activeUsers.length }, "Come back online message sent to users");
    
  } catch (err) {
    logger.error({ err }, "Failed to send come back online message");
  }
}
