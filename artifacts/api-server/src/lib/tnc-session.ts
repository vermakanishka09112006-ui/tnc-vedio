import { supabaseRequest } from "./supabase-rest";

const TNC_API_URL = "https://crm.tncnursing.in/common/";
const SHARED_SESSION_ID = "shared";
const SESSION_CACHE_MS = 10_000;

interface SharedTncSession {
  id: string;
  token: string;
  expires_at: string | null;
}

export class TncLoginRequiredError extends Error {
  readonly reason: "missing" | "expired";

  constructor(reason: "missing" | "expired" = "expired") {
    super("TNC login required");
    this.name = "TncLoginRequiredError";
    this.reason = reason;
  }
}

interface SharedSessionStatus {
  session: SharedTncSession | null;
  reason: "missing" | "expired" | null;
}

let sessionCache: { status: SharedSessionStatus; cachedAt: number } | null = null;
let sessionRead: Promise<SharedSessionStatus> | null = null;

export class TncApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TncApiError";
  }
}

function tokenExpiry(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof decoded.exp === "number" ? new Date(decoded.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

export async function getSharedTncSession(): Promise<SharedTncSession | null> {
  return (await readSharedSessionStatus()).session;
}

export async function getSharedTncSessionStatus(): Promise<{
  available: boolean;
  expiresAt: string | null;
  reason: "missing" | "expired" | null;
}> {
  const status = await readSharedSessionStatus();
  return {
    available: Boolean(status.session),
    expiresAt: status.session?.expires_at ?? null,
    reason: status.reason,
  };
}

async function readSharedSessionStatus(): Promise<SharedSessionStatus> {
  if (sessionCache && Date.now() - sessionCache.cachedAt < SESSION_CACHE_MS) {
    return sessionCache.status;
  }
  if (sessionRead) return sessionRead;

  sessionRead = (async () => {
  const rows = await supabaseRequest<SharedTncSession[]>(
    `tnc_shared_session?select=id,token,expires_at&id=eq.${SHARED_SESSION_ID}&limit=1`,
  );
  const session = rows[0];
  if (!session) return { session: null, reason: "missing" };
  if (session.expires_at && Date.parse(session.expires_at) <= Date.now()) {
    await clearSharedTncSession(session.token);
    return { session: null, reason: "expired" };
  }
    return { session, reason: null };
  })();

  try {
    const status = await sessionRead;
    sessionCache = { status, cachedAt: Date.now() };
    return status;
  } finally {
    sessionRead = null;
  }
}

export async function saveSharedTncSession(token: string): Promise<void> {
  const expiresAt = tokenExpiry(token);
  const savedRows = await supabaseRequest<SharedTncSession[]>("tnc_shared_session?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      id: SHARED_SESSION_ID,
      token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!savedRows.some((row) => row.id === SHARED_SESSION_ID && row.token === token)) {
    throw new Error("Supabase did not confirm that the TNC session token was saved");
  }
  sessionCache = {
    status: {
      session: { id: SHARED_SESSION_ID, token, expires_at: expiresAt },
      reason: null,
    },
    cachedAt: Date.now(),
  };
}

export async function clearSharedTncSession(token?: string): Promise<void> {
  const tokenCondition = token ? `&token=eq.${encodeURIComponent(token)}` : "";
  await supabaseRequest<void>(
    `tnc_shared_session?id=eq.${SHARED_SESSION_ID}${tokenCondition}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
  sessionCache = null;
}

async function callTnc(payload: Record<string, unknown>, token?: string): Promise<unknown> {
  const response = await fetch(TNC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ payload: JSON.stringify({ fn: "common_fn", ...payload }) }),
  });

  if (!response.ok && token && response.status === 401) throw new TncLoginRequiredError();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TncApiError(`TNC returned an invalid response (${response.status})`);
  }

  if (!response.ok) {
    throw new TncApiError(`TNC request failed (${response.status})`);
  }

  if (!Array.isArray(body) && body && typeof body === "object" && "status" in body && body.status === 1) {
    const message = "msg" in body ? String(body.msg) : "TNC request failed";
    if (token && /login required|token.*(expired|invalid)|expired.*token/i.test(message)) {
      throw new TncLoginRequiredError();
    }
    throw new TncApiError(message);
  }

  return body;
}

export async function tncPublicRequest(se: string, data: Record<string, unknown>): Promise<unknown> {
  return callTnc({ se, data });
}

export async function tncOptionalAuthRequest(
  se: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  const session = await getSharedTncSession();
  try {
    return await callTnc({ se, data, ...extra }, session?.token);
  } catch (error) {
    if (session && error instanceof TncLoginRequiredError) {
      await clearSharedTncSession(session.token);
    }
    throw error;
  }
}

export async function tncProtectedRequest(
  se: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  const status = await readSharedSessionStatus();
  const session = status.session;
  if (!session) throw new TncLoginRequiredError(status.reason ?? "missing");
  try {
    return await callTnc({ se, data, ...extra }, session.token);
  } catch (error) {
    if (error instanceof TncLoginRequiredError) await clearSharedTncSession(session.token);
    throw error;
  }
}

export async function loginSharedTncStudent(mobile: string, password: string): Promise<void> {
  const result = await tncPublicRequest("lo_us", { mob: mobile, pass: password });
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TncApiError("TNC returned an invalid login response");
  }
  const token = (result as Record<string, unknown>).token;
  if (typeof token !== "string" || !token) throw new TncApiError("TNC login did not return a token");
  await saveSharedTncSession(token);
}

export async function resetTncDeviceAndLogin(mobile: string, password: string, otp: string): Promise<void> {
  await tncPublicRequest("ve_ot", { mob: mobile, otp });
  await tncPublicRequest("re_de", { mob: mobile });
  await loginSharedTncStudent(mobile, password);
}