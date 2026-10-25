export type AccessDecision = "approved" | "denied" | "blocked" | "unblocked";

export interface AccessDecisionEmail {
  email: string;
  displayName: string;
  decision: AccessDecision;
  reason: string | null;
  approvedUntil?: string | null;
  blockedUntil?: string | null;
  restoredStatus?: string;
}

export type EmailDeliveryResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "provider_error" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendAccessDecisionEmail(input: AccessDecisionEmail): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ACCESS_EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "not_configured" };

  const approved = input.decision === "approved";
  const denied = input.decision === "denied";
  const blocked = input.decision === "blocked";
  const name = input.displayName.trim() || "there";
  const subject = {
    approved: "Your TNC Nursing access is approved",
    denied: "Update on your TNC Nursing access request",
    blocked: "Your TNC Nursing access is temporarily restricted",
    unblocked: "Your TNC Nursing account restriction was lifted",
  }[input.decision];
  const title = {
    approved: "Your access is approved",
    denied: "Your access request was denied",
    blocked: "Your account is blocked",
    unblocked: "Your account block was removed",
  }[input.decision];
  const approvalDuration = input.approvedUntil
    ? `Your access is available until ${new Date(input.approvedUntil).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
    : "Your access does not currently have an expiry date.";
  const blockDuration = input.blockedUntil
    ? `Your access is blocked until ${new Date(input.blockedUntil).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
    : "Your access is blocked permanently.";
  const message = approved
    ? `You can now sign in to TNC Nursing and access learning content. ${approvalDuration}`
    : denied
      ? "Your request to access learning content was denied."
      : blocked
        ? `You can no longer access learning content. ${blockDuration}`
        : `The block on your account has been removed. Your access status is ${input.restoredStatus ?? "restored"}.`;
  const reason = input.reason?.trim();
  const detail = reason && (denied || blocked || input.decision === "unblocked")
    ? `<p><strong>${input.decision === "unblocked" ? "Previous block reason" : "Reason"}:</strong> ${escapeHtml(reason)}</p>`
    : "";
  const action = approved || input.decision === "unblocked"
    ? '<p><a href="https://courses.tncnursing.site/videos">Open TNC Nursing</a></p>'
    : '<p>If you think this was a mistake, message <a href="https://t.me/Tncnursingbot">TNC Nursing support</a>.</p>';
  const html = [
    '<!doctype html><html lang="en"><body style="margin:0;background:#f1f5f9;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a">',
    '<main style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border:1px solid #e2e8f0">',
    `<p style="margin:0;color:#047857;font-size:12px;font-weight:bold;letter-spacing:1px">TNC NURSING</p>`,
    `<h1 style="font-size:24px">${title}</h1>`,
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>${message}</p>`,
    detail,
    action,
    '</main></body></html>',
  ].join("");
  const text = [
    `Hi ${name},`,
    "",
    message,
    approved ? approvalDuration : "",
    blocked ? blockDuration : "",
    reason && (denied || blocked || input.decision === "unblocked") ? `${input.decision === "unblocked" ? "Previous block reason" : "Reason"}: ${reason}` : "",
    approved || input.decision === "unblocked" ? "Open TNC Nursing: https://courses.tncnursing.site/videos" : "If you think this was a mistake, message https://t.me/Tncnursingbot",
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.email], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { sent: true } : { sent: false, reason: "provider_error" };
  } catch {
    return { sent: false, reason: "provider_error" };
  }
}