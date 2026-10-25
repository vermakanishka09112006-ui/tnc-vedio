import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { bot, upsertBotUser, checkBanned } from "../lib/bot";
import { verifyTelegramInitData } from "../lib/telegram-auth";
import {
  listUsers,
  banUser,
  unbanUser,
  checkBannedStore,
  getStats,
} from "../lib/user-store";
import { recordStudyHeartbeat, recordWebsiteStudyHeartbeat, getLeaderboard } from "../lib/study-store";
import { getSiteIdentity } from "./site-access";

const router = Router();
const processedWebhookUpdates = new Map<number, number>();
const webhookUpdateTtlMs = 24 * 60 * 60 * 1000;
const maxCachedWebhookUpdates = 10_000;

function isDuplicateWebhookUpdate(updateId: number): boolean {
  const expiredBefore = Date.now() - webhookUpdateTtlMs;
  for (const [cachedId, processedAt] of processedWebhookUpdates) {
    if (processedAt > expiredBefore) break;
    processedWebhookUpdates.delete(cachedId);
  }
  if (processedWebhookUpdates.has(updateId)) return true;
  processedWebhookUpdates.set(updateId, Date.now());
  while (processedWebhookUpdates.size > maxCachedWebhookUpdates) {
    const oldestId = processedWebhookUpdates.keys().next().value;
    if (oldestId === undefined) break;
    processedWebhookUpdates.delete(oldestId);
  }
  return false;
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

function requireAdmin(req: Request, res: Response): boolean {
  const token =
    (req.headers["x-admin-token"] as string) ??
    (req.query.adminToken as string);
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// POST /api/bot/webhook — Telegram sends updates here
router.post("/webhook", async (req: Request, res: Response): Promise<void> => {
  let webhookUpdateId: number | undefined;
  try {
    if (!bot) {
      res.status(503).json({ error: "Bot not initialized" });
      return;
    }
    const updateId = req.body?.update_id;
    if (Number.isInteger(updateId)) {
      webhookUpdateId = updateId;
      if (isDuplicateWebhookUpdate(updateId)) {
        res.json({ ok: true, duplicate: true });
        return;
      }
    }
    await bot.handleUpdate(req.body);
    res.json({ ok: true });
  } catch (err) {
    if (webhookUpdateId !== undefined) processedWebhookUpdates.delete(webhookUpdateId);
    logger.error({ err }, "Bot webhook error");
    res.status(500).json({ error: "Webhook error" });
  }
});

// GET /api/bot/webhook — simple acknowledge so browsers show a helpful message
router.get("/webhook", async (_req: Request, res: Response): Promise<void> => {
  res.json({ ok: true, message: "Telegram webhook endpoint (POST only). Use POST to send updates." });
});

// GET /api/bot/status — lightweight bot status for health checks
router.get("/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const botReady = Boolean(bot);
    const webhook = botReady ? await bot!.telegram.getWebhookInfo() : null;
    res.json({
      ok: true,
      botInitialized: botReady,
      webhook: webhook
        ? {
            configured: Boolean(webhook.url),
            pendingUpdates: webhook.pending_update_count,
            lastErrorDate: webhook.last_error_date ?? null,
            lastErrorMessage: webhook.last_error_message ?? null,
          }
        : null,
    });
  } catch (err) {
    logger.error({ err }, "Bot status check failed");
    res.status(500).json({ ok: false, error: "Status check failed" });
  }
});

// POST /api/bot/register — Mini app registers user on open
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { telegramId, firstName, lastName, username, initData } = req.body as {
      telegramId?: number;
      firstName?: string;
      lastName?: string;
      username?: string;
      initData?: string;
    };

    const verified = verifyTelegramInitData(initData, process.env.BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN);
    const resolvedTelegramId = verified?.user.id ?? telegramId;
    const resolvedFirstName = verified?.user.first_name ?? firstName ?? "";
    const resolvedLastName = verified?.user.last_name ?? lastName ?? null;
    const resolvedUsername = verified?.user.username ?? username ?? null;

    if (!resolvedTelegramId) {
      res.status(400).json({ error: "telegramId or valid Telegram initData required" });
      return;
    }

    if (initData && !verified) {
      res.status(401).json({ error: "Invalid Telegram authentication data" });
      return;
    }

    const user = await upsertBotUser({
      id: Number(resolvedTelegramId),
      first_name: resolvedFirstName,
      last_name: resolvedLastName ?? undefined,
      username: resolvedUsername ?? undefined,
    });
    const banStatus = await checkBannedStore(Number(resolvedTelegramId));
    res.json({
      success: true,
      banned: banStatus.banned,
      reason: banStatus.reason,
      telegramId: String(resolvedTelegramId),
      user: {
        telegramId: String(resolvedTelegramId),
        firstName: user.first_name ?? resolvedFirstName,
        lastName: resolvedLastName ?? null,
        username: resolvedUsername ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to register bot user");
    res.status(500).json({ error: "Registration failed" });
  }
});

// GET /api/bot/check-ban/:telegramId — Public ban check
router.get("/check-ban/:telegramId", async (req: Request, res: Response): Promise<void> => {
  try {
    const telegramId = parseInt(String(req.params.telegramId));
    if (isNaN(telegramId)) {
      res.status(400).json({ error: "Invalid telegramId" });
      return;
    }
    const status = await checkBanned(telegramId);
    res.json(status);
  } catch (err) {
    logger.error({ err }, "Ban check failed");
    res.status(500).json({ error: "Check failed" });
  }
});

// GET /api/bot/users — List bot users (admin) — served from Supabase
router.get("/users", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const { users, total, banned } = await listUsers(page, limit);
    res.json({ users, total, banned, page, limit });
  } catch (err) {
    logger.error({ err }, "Failed to list bot users");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /api/bot/stats — Bot stats (admin)
router.get("/stats", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  res.json(await getStats());
});

// POST /api/bot/users/:telegramId/ban (admin)
router.post("/users/:telegramId/ban", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const { reason } = req.body as { reason?: string };
    const ok = await banUser(
      String(req.params.telegramId),
      reason ?? "Banned by admin",
    );
    if (ok) {
      res.json({ success: true, message: "User banned" });
    } else {
      res.status(404).json({ error: "User not found — they must open the app first" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to ban user");
    res.status(500).json({ error: "Failed to ban user" });
  }
});

// POST /api/bot/users/:telegramId/unban (admin)
router.post("/users/:telegramId/unban", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const ok = await unbanUser(String(req.params.telegramId));
    if (ok) {
      res.json({ success: true, message: "User unbanned" });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    logger.error({ err }, "Failed to unban user");
    res.status(500).json({ error: "Failed to unban user" });
  }
});

router.post("/study/heartbeat", async (req: Request, res: Response): Promise<void> => {
  try {
    const { telegramId, visitorId, visitorName, sessionId, seconds } = req.body as {
      telegramId?: number;
      visitorId?: string;
      visitorName?: string;
      sessionId?: string;
      seconds?: number;
    };
    if (!sessionId || !Number.isFinite(seconds) || (!telegramId && (!visitorId || !visitorName))) {
      res.status(400).json({ error: "A Telegram ID or website visitor ID/name, session ID, and seconds are required" });
      return;
    }
    if (telegramId) {
      await recordStudyHeartbeat({ telegramId, sessionId, seconds: seconds! });
    } else if (req.header("authorization")?.match(/^Bearer\s+.+$/i)) {
      const identity = await getSiteIdentity(req);
      if (!identity) {
        res.status(401).json({ error: "Sign in with Google to record website study time" });
        return;
      }
      await recordWebsiteStudyHeartbeat({
        visitorId: `google_${identity.id}`,
        visitorName: identity.name || identity.email.split("@")[0],
        avatarUrl: identity.avatarUrl,
        sessionId,
        seconds: seconds!,
      });
    } else {
      if (visitorId!.startsWith("google_")) {
        res.status(401).json({ error: "Google study records require an authenticated account" });
        return;
      }
      await recordWebsiteStudyHeartbeat({ visitorId: visitorId!, visitorName: visitorName!, avatarUrl: null, sessionId, seconds: seconds! });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to record study time");
    res.status(500).json({ error: "Failed to record study time" });
  }
});

router.get("/study/leaderboard", async (req: Request, res: Response): Promise<void> => {
  try {
    const requestedLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    res.json(await getLeaderboard(limit));
  } catch (err) {
    logger.error({ err }, "Failed to fetch study leaderboard");
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

export default router;
