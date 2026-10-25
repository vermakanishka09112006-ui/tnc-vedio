import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getCachedFirebaseVideoUrl, isFirebaseConfigured, isUserAuthConfigured, isServiceAccountConfigured, signInWithEmailPassword, streamFirebaseVideo } from "../lib/firebase-rest";
import { authenticateAppUser, createAppUser, findAppUser, listAppUsers } from "../lib/app-user-store";
import { getStats as getBotStats } from "../lib/user-store";
import { invalidateAdminDirectoryCache, listAdminDirectoryUsers } from "../lib/admin-directory";
import { TncApiError, TncLoginRequiredError, getSharedTncSessionStatus, loginSharedTncStudent, resetTncDeviceAndLogin, tncProtectedRequest, tncPublicRequest } from "../lib/tnc-session";
import { requireApprovedSiteUser } from "./site-access";

const router = Router();

const CRM_BASE = "https://crm.tncnursing.in";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const PROMO_EXPIRES_DAYS = 30;

function requireAdmin(req: Request, res: Response): boolean {
  const token = req.header("x-admin-token") ?? req.query.adminToken;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function sendTncLoginRequired(res: Response, error: unknown): boolean {
  if (!(error instanceof TncLoginRequiredError)) return false;
  res.status(428).json({
    error: error.reason === "expired" ? "TNC session expired" : "TNC login required",
    code: "TNC_LOGIN_REQUIRED",
    reason: error.reason,
  });
  return true;
}

if (!ADMIN_PASSWORD) {
  console.warn("[proxy] ADMIN_PASSWORD env var not set — admin login disabled");
}
if (!ADMIN_TOKEN) {
  console.warn("[proxy] ADMIN_TOKEN env var not set — admin actions disabled");
}

let promoState = {
  enabled: true,
  expiresAt: new Date(Date.now() + PROMO_EXPIRES_DAYS * 24 * 60 * 60 * 1000).toISOString() as string | null,
};

async function crmQuery(payload: object): Promise<unknown> {
  const resp = await fetch(`${CRM_BASE}/common/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: JSON.stringify(payload) }),
  });
  if (!resp.ok) throw new Error(`CRM error ${resp.status}`);
  return resp.json();
}

function buildMediaUrl(path: string | undefined | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\\//g, "/").trim();
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `${CRM_BASE}/${normalized.replace(/^\/+/, "")}`;
}

function unwrapJson(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return unwrapJson(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(unwrapJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapJson(item)]));
  }
  return value;
}

function recordJson(value: unknown): Record<string, unknown> {
  const unwrapped = unwrapJson(value);
  return unwrapped && typeof unwrapped === "object" && !Array.isArray(unwrapped)
    ? unwrapped as Record<string, unknown>
    : {};
}

function loadPdfCandidates(json: Record<string, unknown>): string[] {
  const roots = [
    recordJson(json._de)._no,
    json._no,
    json._no_ur,
    json.notes,
    json._pd,
    json._pd_ur,
    json.pdf,
    json.pdf_url,
    json._pdf_url,
    json._no_url,
    json.note_url,
    json.document_url,
    json.file_url,
    json._no_path,
    json._no_file,
    json._no_src,
    json._at,
    json.attachment,
  ];
  const candidates: string[] = [];
  const visit = (value: unknown): void => {
    const unwrapped = unwrapJson(value);
    if (Array.isArray(unwrapped)) {
      for (const item of unwrapped) visit(item);
      return;
    }
    if (unwrapped && typeof unwrapped === "object") {
      for (const [key, item] of Object.entries(unwrapped)) {
        if (/^(url|uri|path|file|src|href|link|pdf_url|file_url|document_url|note_url|_url|_no_url)$/i.test(key)) visit(item);
      }
      return;
    }
    if (typeof unwrapped !== "string") return;
    for (const part of unwrapped.split(",")) {
      const candidate = part.trim().replace(/\\\//g, "/");
      if (isPdfCandidate(candidate)) candidates.push(candidate);
    }
  };
  for (const root of roots) visit(root);
  return [...new Set(candidates)];
}

function pdfProxyUrl(candidate: string): string {
  const resolved = new URL(candidate.replace(/\\\//g, "/"), `${CRM_BASE}/`);
  if (resolved.hostname === new URL(CRM_BASE).hostname && !resolved.search) {
    const path = resolved.pathname.replace(/^\/+/, "");
    return `/api/pdf?path=${encodeURIComponent(path)}`;
  }
  return `/api/pdf?url=${encodeURIComponent(resolved.toString())}`;
}

async function loadCourseContent(courseId: string): Promise<{
  subjectData: unknown;
  contentData: unknown;
}> {
  const batches = await tncProtectedRequest("fe_co", { limit: 1000 });
  const batch = Array.isArray(batches)
    ? (batches as Record<string, unknown>[]).find((row) => String(row.row_id ?? "") === courseId)
    : undefined;
  const batchJson = recordJson(batch?.json);
  const subjectIds = Array.isArray(batchJson._su) ? [...new Set(batchJson._su.filter((id): id is string => typeof id === "string" && Boolean(id)))] : [];
  const chapterIds = Array.isArray(batchJson._ch) ? [...new Set(batchJson._ch.filter((id): id is string => typeof id === "string" && Boolean(id)))] : [];
  const parentCourseIds = Array.isArray(batchJson._co) ? batchJson._co.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
  const courseRefId = String(batch?.course_id ?? batch?.wc_refid ?? batchJson.course_id ?? batchJson.wc_refid ?? parentCourseIds[0] ?? courseId);

  let subjectData: unknown = [];
  if (subjectIds.length) {
    subjectData = await tncProtectedRequest("fe", { json: "*" }, {
      sch: "t_su", cond: { "(row_id)": subjectIds }, limit: 1000,
    });
  }
  if (!Array.isArray(subjectData) || subjectData.length === 0) {
    subjectData = await tncProtectedRequest("fe", { json: "*" }, {
      sch: "t_su", cond: { co_refid: courseRefId }, limit: 1000,
    });
  }

  const linkedSubjectIds = Array.isArray(subjectData)
    ? [...new Set((subjectData as Record<string, unknown>[]).map((row) => String(row.row_id ?? "").trim()).filter(Boolean))]
    : [];
  const queries: Promise<unknown>[] = [];
  if (chapterIds.length) {
    queries.push(tncProtectedRequest("fe", { json: "*" }, {
      sch: "t_ch", cond: { "(row_id)": chapterIds }, limit: 1000,
    }));
  }
  if (linkedSubjectIds.length) {
    queries.push(tncProtectedRequest("fe", { json: "*" }, {
      sch: "t_ch", cond: { "(su_refid)": linkedSubjectIds }, limit: 1000,
    }));
  }
  const contentRows = (await Promise.all(queries)).flatMap((data) => Array.isArray(data) ? data as Record<string, unknown>[] : []);
  const contentData = [...new Map(contentRows.map((row) => [String(row.row_id ?? row.id ?? JSON.stringify(row)), row])).values()];
  return { subjectData, contentData };
}

function courseDescriptionText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\\x3c/gi, "<")
    .replace(/\\x3e/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function parseCourse(row: Record<string, unknown>) {
  const json = typeof row.json === "string" ? JSON.parse(row.json) as Record<string, unknown> : (row.json as Record<string, unknown>) ?? {};
  const at = (json._at as Record<string, unknown>) ?? {};
  return {
    id: row.id,
    rowId: row.row_id,
    name: json._na ?? "",
    description: courseDescriptionText(json._de),
    price: String(json._pr ?? ""),
    serialNo: json._sno ?? "",
    imageUrl: buildMediaUrl(at.url as string),
    createdAt: row.cr_on as string,
    updatedAt: row.up_on,
  };
}

function deriveSubject(title: string): { rowId: string; name: string } {
  const normalized = title.trim().toLowerCase();
  const rules: Array<[RegExp, string, string]> = [
    [/^obg\b|\bobg\s*[-:]/i, "obg", "OBG"],
    [/^fon\b|nursing foundation/i, "nursing-foundation", "Nursing Foundation"],
    [/^blood\b/i, "blood", "Blood"],
    [/^psychology\b/i, "psychology", "Psychology"],
    [/^psychiatric\b|psychiatric nursing/i, "psychiatric-nursing", "Psychiatric Nursing"],
    [/^pediatric\b|^paediatric\b|pediatric nursing/i, "pediatric-nursing", "Pediatric Nursing"],
    [/^community\b|community health/i, "community-health", "Community Health Nursing"],
    [/^pharmacology\b/i, "pharmacology", "Pharmacology"],
    [/^anatomy\b/i, "anatomy", "Anatomy"],
    [/^physiology\b/i, "physiology", "Physiology"],
    [/^microbiology\b/i, "microbiology", "Microbiology"],
    [/^nutrition\b/i, "nutrition", "Nutrition"],
  ];
  for (const [pattern, rowId, name] of rules) {
    if (pattern.test(normalized)) return { rowId, name };
  }
  return { rowId: "uncategorized", name: "Uncategorized" };
}

function isYouTubeUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url.startsWith("http")) return false;
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function isPdfCandidate(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const value = url.trim();
  if (!value) return false;
  if (isYouTubeUrl(value)) return false;
  if (/\.(mp4|m3u8|webm|mov|avi|mkv)(\?|$)/i.test(value)) return false;
  if (/youtube|vimeo|bunny|video|stream|cloudfront|cdn/i.test(value)) return false;
  // More permissive PDF detection
  if (/\.pdf(\?|$)/i.test(value)) return true;
  if (value.includes("/pdf/") || value.includes("application/pdf")) return true;
  // Also accept common document paths
  if (value.includes("/uploads/") && (value.includes(".pdf") || value.includes("document") || value.includes("note"))) return true;
  if (value.includes("drive.google.com") || value.includes("docs.google.com")) return true;
  // If it's a URL that doesn't look like video, and has a file extension, allow it
  if (value.startsWith("http") && /\.(pdf|doc|docx|txt)(\?|$)/i.test(value)) return true;
  return false;
}

function isDirectVideoUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (!url.startsWith("http")) return false;
  return (
    url.includes(".mp4") ||
    url.includes(".m3u8") ||
    url.includes(".webm") ||
    url.includes(".mov") ||
    url.includes("video") ||
    url.includes("stream") ||
    url.includes("cloudfront") ||
    url.includes("vimeo") ||
    url.includes("bunny") ||
    url.includes("cdn")
  );
}

function isPlayableVideoUrl(url: unknown): url is string {
  return isYouTubeUrl(url) || isDirectVideoUrl(url);
}

function isFirebaseStorageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  return url.includes("firebasestorage.googleapis.com") || url.startsWith("gs://");
}

function convertFirebaseStorageUrl(url: string): string {
  if (url.startsWith("gs://")) {
    const withoutGs = url.replace("gs://", "");
    const slashIdx = withoutGs.indexOf("/");
    const bucket = withoutGs.slice(0, slashIdx);
    const path = withoutGs.slice(slashIdx + 1);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
  }
  return url;
}

function parseChapter(row: Record<string, unknown>) {
  const json = recordJson(row.json);
  const title = (json._na ?? "Untitled") as string;
  const derivedSubject = deriveSubject(title);
  const vi = (json._vi as Record<string, unknown>) ?? {};
  const de = recordJson(json._de);
  const deVi = (de._vi as Record<string, unknown>) ?? {};

  // Firebase ID for secured content (UUID style) - PRIORITY 1
  // This uses /api/firebase-stream/:fsId which supports Range requests for seeking
  const firebaseId = (vi._fs_id ?? deVi.fs_id ?? "") as string;
  const hasFirebaseId = typeof firebaseId === "string" && firebaseId.trim().length > 10;

  let videoUrl: string | null = null;
  let contentType: "youtube" | "firebase" | "pdf" | "none" = "none";

  // If we have a Firebase ID, use the proper streaming endpoint
  if (hasFirebaseId) {
    contentType = "firebase";
  } else {
    // Collect all possible video URL fields from both old and new schema
    const rawVideoUrls = [
      vi._vi_url,
      deVi.url,
      vi.url,
      json._vi_url,
      json.video_url,
      vi.video_url,
      deVi._vi_url,
      deVi.video_url,
      deVi._vi_url,
      deVi.url,
    ].filter(Boolean) as string[];

    for (const raw of rawVideoUrls) {
      if (!raw || typeof raw !== "string") continue;
      if (isFirebaseStorageUrl(raw)) {
        // Fallback: proxy Firebase Storage URL (no Range support)
        videoUrl = `/api/media-proxy?url=${encodeURIComponent(convertFirebaseStorageUrl(raw))}`;
        contentType = "youtube"; // treat as playable video
        break;
      }
      if (isYouTubeUrl(raw)) {
        videoUrl = raw;
        contentType = "youtube";
        break;
      }
      if (isDirectVideoUrl(raw)) {
        videoUrl = raw;
        contentType = "youtube";
        break;
      }
    }
  }

  // PDF handling — only trust real PDF-looking resources.
  const pdfCandidates = loadPdfCandidates(json);

  const pdfCandidate = pdfCandidates[0] ?? null;
  const rawPdfPath = (pdfCandidate ?? "").replace(/^\//, "");
  const isCrmHostedPdf = rawPdfPath.startsWith("uploads/");
  let pdfUrl: string | null = null;

  if (pdfCandidate && isCrmHostedPdf) {
    pdfUrl = pdfProxyUrl(pdfCandidate);
    if (!videoUrl && contentType !== "firebase") {
      contentType = "pdf";
    }
  }

  if (!videoUrl && !pdfUrl && pdfCandidate && /^https?:\/\//i.test(pdfCandidate)) {
    pdfUrl = pdfProxyUrl(pdfCandidate);
    if (contentType === "none") contentType = "pdf";
  }

  // FALLBACK: If we have a PDF candidate but it's not a recognized format,
  // try treating it as a CRM path anyway (relative path)
  if (!videoUrl && !pdfUrl && pdfCandidate && !/^https?:\/\//i.test(pdfCandidate)) {
    pdfUrl = pdfProxyUrl(pdfCandidate);
    if (contentType === "none") contentType = "pdf";
  }

  // Keep the first PDF available even when the same chapter also has video media.
  // The content type remains video in that case, while E-Notes can still expose the PDF.
  if (pdfCandidate && !pdfUrl) {
    pdfUrl = pdfProxyUrl(pdfCandidate);
  }

  // AGGRESSIVE: If no videoUrl but we have a pdfCandidate (even if not valid URL), treat as PDF
  // This handles cases where PDF data exists but isn't a proper URL yet
  const hasPdfData = pdfCandidates.length > 0;
  
  // Also update contentType if we have PDF data but no valid URL yet
  if (hasPdfData && !videoUrl && contentType === "none") {
    contentType = "pdf";
  }

  // Determine final type
  const finalType = videoUrl || hasFirebaseId
    ? "video"
    : pdfUrl || hasPdfData
      ? "pdf"
      : "content";

  return {
    id: row.id as number,
    rowId: row.row_id as string,
    title,
    description: "",
    videoUrl,
    pdfUrl,
    pdfUrls: pdfCandidates.map(pdfProxyUrl),
    firebaseId: hasFirebaseId ? firebaseId : null,
    contentType,
    type: finalType,
    courseId: (row.co_refid ?? json._co) as string | null,
    subjectId: String(row.su_refid ?? json._su ?? derivedSubject.rowId).trim() || derivedSubject.rowId,
    isPaid: (json._pr_ty as number) === 1,
    duration: null as string | null,
    thumbnailUrl: null as string | null,
    serialNo: String(json._sno ?? ""),
    createdAt: row.cr_on as string,
  };
}

function parseSlider(row: Record<string, unknown>) {
  const json = (row.json as Record<string, unknown>) ?? {};
  const at = (json._at as Record<string, unknown>) ?? {};
  return {
    id: row.id,
    rowId: row.row_id,
    imageUrl: buildMediaUrl(at.url as string) ?? "",
    name: (json._na ?? "") as string,
    description: (json._de ?? "") as string,
  };
}

function parseUserRow(row: Record<string, unknown>) {
  const json = (row.json as Record<string, unknown>) ?? {};
  return {
    userId: (json._us_id ?? row.row_id) as string,
    name: (json._us_na ?? "") as string,
    mobile: (json._mo ?? "") as string,
    email: (json._em as string) ?? null,
    college: (json._cl as string) ?? null,
    state: (json._st as string) ?? null,
    token: `usr_${json._us_id ?? row.row_id}`,
  };
}

function parseAdminUser(row: Record<string, unknown>) {
  const json = (row.json as Record<string, unknown>) ?? {};
  return {
    id: row.id,
    rowId: row.row_id,
    name: (json._us_na ?? "") as string,
    mobile: (json._mo ?? "") as string,
    email: (json._em as string) ?? null,
    college: (json._cl as string) ?? null,
    state: (json._st as string) ?? null,
    createdAt: row.cr_on,
  };
}

function parseExam(row: Record<string, unknown>) {
  const json = typeof row.json === "string" ? JSON.parse(row.json) as Record<string, unknown> : (row.json as Record<string, unknown>) ?? {};
  const quRefids = (row.qu_refid as string[]) ?? [];
  return {
    examId: row.row_id as string,
    examNo: (row.examno as number) ?? 0,
    name: (json._ex_na ?? "Quiz") as string,
    maxMarks: (json._ma_ma as number) ?? 0,
    negativeMarks: (json._ne_ma as number) ?? 0.25,
    durationMinutes: String(json._ex_du ?? "60"),
    questionCount: quRefids.length,
    validUntil: (json._va_ti as string) ?? null,
    allowForPremium: (json._al_fo_pr as number) === 1,
    startDate: (json._st_da as string) ?? null,
    endDate: (json._en_da as string) ?? null,
  };
}

function parseQuestion(row: Record<string, unknown>) {
  const json = typeof row.json === "string" ? JSON.parse(row.json) as Record<string, unknown> : (row.json as Record<string, unknown>) ?? {};
  const quObj = (json._qu as Record<string, unknown>) ?? {};
  const ops = (json._op as Record<string, Record<string, unknown>>) ?? {};
  const soObj = (json._so as Record<string, unknown>) ?? {};

  return {
    rowId: row.row_id as string,
    questionId: row.id as number,
    questionText: (quObj._qu ?? "") as string,
    optionA: ((ops._op_A ?? {})?._op_ti ?? "") as string,
    optionB: ((ops._op_B ?? {})?._op_ti ?? "") as string,
    optionC: ((ops._op_C ?? {})?._op_ti ?? "") as string,
    optionD: ((ops._op_D ?? {})?._op_ti ?? "") as string,
    correctAnswer: (json._an ?? "") as string,
    explanation: (soObj._ti ?? null) as string | null,
    questionNo: (json._qno as number) ?? null,
  };
}

// GET /api/courses — newest first
router.get("/courses", async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await tncProtectedRequest("fe_co");
    const courses = Array.isArray(data)
      ? (data as Record<string, unknown>[]).map(parseCourse)
      : [];
    // Sort newest first by createdAt
    courses.sort((a, b) => {
      const aTime = String(a.createdAt ?? "");
      const bTime = String(b.createdAt ?? "");
      return bTime.localeCompare(aTime);
    });
    res.json(courses);
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch courses");
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});

// GET /api/subjects — named subjects for a course
router.get("/subjects", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId } = req.query;
    const { subjectData, contentData } = await loadCourseContent(String(courseId ?? ""));
    const subjects: Array<Record<string, unknown> & { rowId: string; name: string; videoCount: number; pdfCount: number; totalCount: number }> = [];
    const subjectById = new Map<string, (typeof subjects)[number]>();
    if (Array.isArray(subjectData)) {
      for (const row of subjectData as Record<string, unknown>[]) {
        const json = recordJson(row.json);
        const rowId = String(row.row_id ?? "").trim();
        if (!rowId) continue;
        const subject = {
          id: row.id,
          rowId,
          courseId: typeof courseId === "string" ? courseId : row.co_refid ?? null,
          name: String(json._na ?? "Subject"),
          serialNo: String(json._sno ?? ""),
          videoCount: 0,
          pdfCount: 0,
          totalCount: 0,
        };
        subjects.push(subject);
        subjectById.set(rowId, subject);
      }
    }
    if (Array.isArray(contentData)) {
      for (const row of contentData as Record<string, unknown>[]) {
        const parsed = parseChapter(row);
        const subjectId = parsed.subjectId?.trim() || "uncategorized";
        let subject = subjectById.get(subjectId);
        if (!subject) {
          const derived = deriveSubject(parsed.title);
          subject = {
            id: 0,
            rowId: subjectId,
            courseId: typeof courseId === "string" ? courseId : null,
            name: derived.name,
            serialNo: String(subjects.length).padStart(4, "0"),
            videoCount: 0,
            pdfCount: 0,
            totalCount: 0,
          };
          subjects.push(subject);
          subjectById.set(subject.rowId, subject);
        }
        subject.totalCount += 1;
        const pdfCount = Array.isArray(parsed.pdfUrls) ? parsed.pdfUrls.length : 0;
        const hasPdf = pdfCount > 0 || Boolean(parsed.pdfUrl) || parsed.contentType === "pdf";
        const hasVideo = parsed.contentType === "youtube" || parsed.contentType === "firebase" || Boolean(parsed.videoUrl);
        subject.pdfCount += pdfCount || Number(hasPdf);
        if (hasVideo || !hasPdf) subject.videoCount += 1;
      }
    }
    subjects.sort((a, b) => {
      const aNo = Number.isFinite(Number(a.serialNo)) ? Number(a.serialNo) : Number.MAX_SAFE_INTEGER;
      const bNo = Number.isFinite(Number(b.serialNo)) ? Number(b.serialNo) : Number.MAX_SAFE_INTEGER;
      return aNo - bNo || a.name.localeCompare(b.name);
    });
    res.json(subjects);
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch subjects");
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
});

// GET /api/pdf?path=... — proxy PDFs from CRM (uploads/ paths)
router.get("/pdf", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { path: pdfPath, url: pdfUrl } = req.query;
    if (!pdfPath && !pdfUrl) {
      res.status(400).json({ error: "Missing path or url" });
      return;
    }
    const targetUrl = typeof pdfUrl === "string" && pdfUrl.startsWith("http")
      ? pdfUrl
      : `${CRM_BASE}/${String(pdfPath).replace(/^\/+/, "")}`;
    const upstream = await fetch(targetUrl);
    if (!upstream.ok) {
      // Try alternative: if path was given, try with uploads/ prefix
      if (pdfPath && !String(pdfPath).startsWith("uploads/")) {
        const altUrl = `${CRM_BASE}/uploads/${String(pdfPath).replace(/^\/+/, "")}`;
        const altUpstream = await fetch(altUrl);
        if (altUpstream.ok) {
          const ct = altUpstream.headers.get("content-type") ?? "application/pdf";
          res.setHeader("Content-Type", ct);
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Cache-Control", "public, max-age=86400");
          res.setHeader("Access-Control-Allow-Origin", "*");
          const buf = await altUpstream.arrayBuffer();
          res.end(Buffer.from(buf));
          return;
        }
      }
      res.status(upstream.status).json({ error: "PDF not found" });
      return;
    }
    const ct = upstream.headers.get("content-type") ?? "application/pdf";
    // Be more permissive - allow any content type for PDF proxy, just serve it
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const buf = await upstream.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    logger.error({ err }, "Failed to proxy PDF");
    res.status(500).json({ error: "Failed to load PDF" });
  }
});

// GET /api/media-proxy?url=... — generic media proxy for Firebase Storage / CORS-blocked URLs
router.get("/media-proxy", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing url" });
      return;
    }
    // Only allow known trusted domains
    const allowedDomains = [
      "firebasestorage.googleapis.com",
      "crm.tncnursing.in",
      "storage.googleapis.com",
      "e2b.app",
    // Added by Ideavo to allow proxying from e2b.app
    ];
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }
    if (!allowedDomains.some((d) => parsedUrl.hostname.endsWith(d))) {
      res.status(403).json({ error: "Domain not allowed" });
      return;
    }

    const upstream = await fetch(url, {
      headers: { "Accept": "*/*" },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Upstream error ${upstream.status}` });
      return;
    }

    const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
    const cl = upstream.headers.get("content-length");
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (cl) res.setHeader("Content-Length", cl);

    const buf = await upstream.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (err) {
    logger.error({ err }, "Media proxy failed");
    res.status(500).json({ error: "Media proxy failed" });
  }
});

// GET /api/notes — PDF-only sessions per course (or newest 60 across all courses)
router.get("/notes", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId, limit: limitParam } = req.query;
    const data = typeof courseId === "string"
      ? (await loadCourseContent(courseId)).contentData
      : await tncProtectedRequest("fe", { json: "*" }, { sch: "t_ch", cond: {}, limit: 1000 });

    if (!Array.isArray(data)) {
      res.json([]);
      return;
    }

    const sessions = (data as Record<string, unknown>[])
      .map(parseChapter)
      .filter((s) => s.pdfUrl || s.pdfUrls.length > 0 || s.contentType === "pdf");

    // Sort by serial number within a course, newest first globally
    sessions.sort((a, b) => {
      if (courseId) {
        const aNo = parseFloat(String(a.serialNo)) || 0;
        const bNo = parseFloat(String(b.serialNo)) || 0;
        return aNo - bNo;
      }
      return String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
    });

    const limit = courseId ? sessions.length : Math.min(parseInt(String(limitParam ?? "60")), 200);
    res.json(sessions.slice(0, limit));
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch notes");
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

// GET /api/sessions — queries t_ch (real video sessions) with pagination + sort
router.get("/sessions", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { courseId, subjectId, limit: limitParam, type, sort, page: pageParam, search } = req.query;
    const data = typeof courseId === "string"
      ? (await loadCourseContent(courseId)).contentData
      : await tncProtectedRequest("fe", { json: "*" }, { sch: "t_ch", cond: {}, limit: 1000 });
    const requestedSubjectId = typeof subjectId === "string" ? subjectId.trim() : "";

    if (!Array.isArray(data)) {
      res.json(courseId ? [] : { sessions: [], total: 0 });
      return;
    }

    let sessions = (data as Record<string, unknown>[]).map(parseChapter);
    if (requestedSubjectId) sessions = sessions.filter((session) => session.subjectId === requestedSubjectId);

    // Filter by search query if provided
    if (search && typeof search === "string" && search.trim().length > 0) {
      const searchLower = search.trim().toLowerCase();
      sessions = sessions.filter((s) => 
        String(s.title ?? "").toLowerCase().includes(searchLower)
      );
    }

    // Filter by content type if requested
    if (type === "video") {
      sessions = sessions.filter((s) => s.contentType === "youtube" || s.contentType === "firebase" || s.videoUrl);
    } else if (type === "pdf") {
      sessions = sessions.filter((s) => s.contentType === "pdf" || s.pdfUrl);
    }

    // Sort
    if (sort === "newest") {
      sessions.sort((a, b) => {
        const aTime = String(a.createdAt ?? "");
        const bTime = String(b.createdAt ?? "");
        return bTime.localeCompare(aTime);
      });
    } else {
      // Default: sort by serial number ascending (lesson order within a course)
      sessions.sort((a, b) => {
        const aNo = parseFloat(String(a.serialNo)) || 0;
        const bNo = parseFloat(String(b.serialNo)) || 0;
        return aNo - bNo;
      });
    }

    // Paginated response when page param given
    if (pageParam) {
      const page = Math.max(1, parseInt(String(pageParam)));
      const limit = Math.min(parseInt(String(limitParam ?? "30")), 100);
      const total = sessions.length;
      const paged = sessions.slice((page - 1) * limit, page * limit);
      res.json({ sessions: paged, total, page, limit });
      return;
    }

    // Limit when no courseId to avoid huge payloads
    if (!courseId) {
      const limit = Math.min(parseInt(String(limitParam ?? "200")), 500);
      sessions = sessions.slice(0, limit);
    }

    res.json(sessions);
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch sessions");
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// GET /api/sessions/:rowId — fetch a single session by rowId
router.get("/sessions/:rowId", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { rowId } = req.params;
    const data = await tncProtectedRequest("fe", { json: "*" }, { sch: "t_ch", cond: { "(row_id)": [rowId] } });
    if (!Array.isArray(data) || data.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(parseChapter((data as Record<string, unknown>[])[0]));
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch session");
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// GET /api/search?q=... — global search across courses, sessions, quizzes
router.get("/search", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = ((req.query.q as string) ?? "").trim().toLowerCase();
    if (!q || q.length < 2) {
      res.json({ courses: [], sessions: [], quizzes: [] });
      return;
    }

    const [coursesData, quizzesData] = await Promise.all([
      tncProtectedRequest("fe_co"),
      tncProtectedRequest("fe_ex"),
    ]);

    const courses = Array.isArray(coursesData)
      ? (coursesData as Record<string, unknown>[])
          .map(parseCourse)
          .filter((c) => String(c.name).toLowerCase().includes(q))
          .slice(0, 10)
      : [];

    const quizzes = Array.isArray(quizzesData)
      ? (quizzesData as Record<string, unknown>[])
          .filter((row) => {
            const json = typeof row.json === "string" ? JSON.parse(row.json) as Record<string, unknown> : (row.json as Record<string, unknown>) ?? {};
            return String(json._ex_na ?? "").toLowerCase().includes(q);
          })
          .map(parseExam)
          .slice(0, 10)
      : [];

    res.json({ courses, sessions: [], quizzes });
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

// GET /api/sliders
router.get("/sliders", async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await crmQuery({
      fn: "common_fn", se: "fe", sch: "t_sl",
      data: { json: "*" }, cond: {},
    });
    res.json(Array.isArray(data) ? (data as Record<string, unknown>[]).map(parseSlider) : []);
  } catch (err) {
    logger.error({ err }, "Failed to fetch sliders");
    res.status(500).json({ error: "Failed to fetch sliders" });
  }
});

// POST /api/auth/login
router.post("/auth/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { mobile, password } = req.body as { mobile: string; password: string };
    if (!mobile || !password) {
      res.status(400).json({ error: "Mobile and password required" });
      return;
    }
    const user = await authenticateAppUser(mobile, password);
    if (!user) {
      res.status(401).json({ error: "Invalid mobile number or password" });
      return;
    }
    res.json(user);
  } catch (err) {
    logger.error({ err }, "Login failed");
    res.status(500).json({ error: "Login failed" });
  }
});

// Shared upstream TNC student session used by course and test-series requests.
router.get("/tnc/auth/session", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getSharedTncSessionStatus());
  } catch (err) {
    logger.error({ err }, "Failed to read shared TNC session");
    res.status(503).json({ error: "TNC session storage is unavailable" });
  }
});

router.post("/tnc/auth/login", async (req: Request, res: Response): Promise<void> => {
  const { mobile, password } = req.body as { mobile?: string; password?: string };
  if (!mobile || !password) {
    res.status(400).json({ error: "Mobile and password required" });
    return;
  }
  try {
    await loginSharedTncStudent(mobile, password);
    invalidateAdminDirectoryCache();
    res.json({ available: true });
  } catch (err) {
    if (err instanceof TncApiError && err.message === "Already Logged In") {
      res.status(409).json({ error: err.message, code: "TNC_DEVICE_CONFLICT" });
      return;
    }
    if (err instanceof TncApiError && /invalid credentials/i.test(err.message)) {
      res.status(401).json({ error: "Invalid TNC mobile number or password" });
      return;
    }
    logger.error({ err }, "TNC student login failed");
    res.status(502).json({ error: err instanceof Error ? err.message : "TNC login failed" });
  }
});

router.post("/tnc/auth/send-otp", async (req: Request, res: Response): Promise<void> => {
  const { mobile } = req.body as { mobile?: string };
  if (!mobile) {
    res.status(400).json({ error: "Mobile required" });
    return;
  }
  try {
    res.json(await tncPublicRequest("se_ot", { mob: mobile }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not send OTP" });
  }
});

router.post("/tnc/auth/reset-device", async (req: Request, res: Response): Promise<void> => {
  const { mobile, password, otp } = req.body as { mobile?: string; password?: string; otp?: string };
  if (!mobile || !password || !otp) {
    res.status(400).json({ error: "Mobile, password, and OTP required" });
    return;
  }
  try {
    await resetTncDeviceAndLogin(mobile, password, otp);
    invalidateAdminDirectoryCache();
    res.json({ available: true });
  } catch (err) {
    logger.warn({ err }, "TNC device reset failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not reset TNC device" });
  }
});

// POST /api/auth/register
router.post("/auth/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, mobile, password, email, college, state, city, gender, dob } = req.body as Record<string, string>;
    if (!name || !mobile || !password) {
      res.status(400).json({ error: "Name, mobile, and password are required" });
      return;
    }
    const existing = await findAppUser(mobile);
    if (existing) {
      res.status(409).json({ error: "Mobile number already registered" });
      return;
    }
    const user = await createAppUser({ name, mobile, password, email, college, state });
    res.status(201).json(user);
  } catch (err) {
    logger.error({ err }, "Registration failed");
    res.status(500).json({ error: "Registration failed" });
  }
});

// GET /api/purchases/:userId
router.get("/purchases/:userId", async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await crmQuery({
      fn: "common_fn", se: "fe", sch: "t_cu",
      data: { json: "*" }, cond: { us_refid: req.params.userId },
    });
    if (!Array.isArray(data)) {
      res.json([]);
      return;
    }
    res.json(
      (data as Record<string, unknown>[]).map((row) => {
        const json = (row.json as Record<string, unknown>) ?? {};
        return {
          id: row.id, rowId: row.row_id, userId: row.us_refid,
          courseId: (json._co_id as string) ?? "",
          courseName: (json._co_na ?? json._na ?? "") as string,
          amount: (json._am as number) ?? null,
          paymentId: (json._pa_id as string) ?? null,
          createdAt: row.cr_on,
        };
      })
    );
  } catch (err) {
    logger.error({ err }, "Failed to fetch purchases");
    res.status(500).json({ error: "Failed to fetch purchases" });
  }
});

// POST /api/purchases
router.post("/purchases", async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, courseId, courseName, amount, paymentId } = req.body as Record<string, unknown>;
    if (!userId || !courseId || !courseName) {
      res.status(400).json({ error: "userId, courseId, and courseName are required" });
      return;
    }
    const rowId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await crmQuery({
      fn: "common_fn", se: "in", sch: "t_cu",
      data: {
        row_id: rowId, us_refid: userId,
        json: { _co_id: courseId, _co_na: courseName, _am: amount ?? 0, _pa_id: paymentId ?? "" },
      },
      cond: {},
    });
    res.status(201).json({
      id: Date.now(), rowId, userId, courseId, courseName,
      amount: (amount as number) ?? null, paymentId: (paymentId as string) ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to create purchase");
    res.status(500).json({ error: "Failed to create purchase" });
  }
});

// POST /api/admin/login
router.post("/admin/login", (req: Request, res: Response): void => {
  const { password } = req.body as { password: string };
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid admin password" });
    return;
  }
  res.json({ token: ADMIN_TOKEN, message: "Admin logged in successfully" });
});

// GET /api/admin/users — List registered app students without credential data
router.get("/admin/users", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const { users: allUsers, unavailableSources } = await listAdminDirectoryUsers();
    const filtered = search
      ? allUsers.filter((user) => JSON.stringify(user).toLowerCase().includes(search))
      : allUsers;
    const start = (page - 1) * limit;
    res.json({
      users: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      sources: { app: "Registered accounts", telegram: "Telegram users", mobile: "Mobile installs", crm: "CRM users" },
      unavailableSources,
      redactedFields: ["passwords", "tokens", "secrets", "credentials", "API keys", "OTPs"],
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch app students");
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// GET /api/admin/stats
router.get("/admin/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [coursesData, purchasesData, botStats] = await Promise.all([
      crmQuery({ fn: "common_fn", se: "fe", sch: "t_co", data: { json: "*" }, cond: {} }),
      crmQuery({ fn: "common_fn", se: "fe", sch: "t_cu", data: { json: "*" }, cond: {} }),
      getBotStats(),
    ]);
    const courses = Array.isArray(coursesData) ? coursesData as Record<string, unknown>[] : [];
    const purchases = Array.isArray(purchasesData) ? purchasesData as Record<string, unknown>[] : [];

    res.json({
      totalUsers: botStats.total,
      totalCourses: courses.length,
      totalSessions: 59806,
      totalPurchases: purchases.length,
      recentUsers: [],
      bannedUsers: botStats.banned,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch admin stats");
    res.status(500).json({ error: "Failed to fetch admin stats" });
  }
});

// GET /api/promo/status
router.get("/promo/status", (_req: Request, res: Response): void => {
  const now = new Date();
  if (promoState.expiresAt && new Date(promoState.expiresAt) < now) {
    promoState.enabled = false;
    promoState.expiresAt = null;
  }
  res.json({
    enabled: promoState.enabled,
    expiresAt: promoState.expiresAt,
    message: promoState.enabled
      ? `Promo active — all content unlocked until ${new Date(promoState.expiresAt!).toLocaleDateString("en-IN")}`
      : "Promotional mode is inactive",
  });
});

// POST /api/promo/toggle
router.post("/promo/toggle", (req: Request, res: Response): void => {
  const { enabled, durationDays, adminToken } = req.body as { enabled: boolean; durationDays?: number; adminToken: string };
  if (adminToken !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  promoState.enabled = Boolean(enabled);
  if (promoState.enabled) {
    const days = durationDays ?? PROMO_EXPIRES_DAYS;
    promoState.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else {
    promoState.expiresAt = null;
  }
  res.json({
    enabled: promoState.enabled,
    expiresAt: promoState.expiresAt,
    message: promoState.enabled
      ? `Promotional mode enabled for ${durationDays ?? PROMO_EXPIRES_DAYS} days`
      : "Promotional mode disabled",
  });
});

// POST /api/promo/extend
router.post("/promo/extend", (req: Request, res: Response): void => {
  const { durationDays, adminToken } = req.body as { durationDays: number; adminToken: string };
  if (adminToken !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!durationDays || durationDays < 1) {
    res.status(400).json({ error: "Invalid durationDays" });
    return;
  }
  const base = promoState.expiresAt && new Date(promoState.expiresAt) > new Date()
    ? new Date(promoState.expiresAt)
    : new Date();
  promoState.enabled = true;
  promoState.expiresAt = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  res.json({
    enabled: promoState.enabled,
    expiresAt: promoState.expiresAt,
    message: `Free period extended by ${durationDays} days — now active until ${new Date(promoState.expiresAt).toLocaleDateString("en-IN")}`,
  });
});

// GET /api/quizzes — list exam sets from t_ex, newest first
router.get("/quizzes", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = ((req.query.search as string) ?? "").toLowerCase();

    const data = await tncProtectedRequest("fe_ex");

    if (!Array.isArray(data)) {
      res.json({ quizzes: [], total: 0, page, limit });
      return;
    }

    let valid = (data as Record<string, unknown>[]).filter((row) => {
      const ids = (row.qu_refid as string[]) ?? [];
      return ids.length > 0;
    });

    if (search) {
      valid = valid.filter((row) => {
        const json = (row.json as Record<string, unknown>) ?? {};
        return String(json._ex_na ?? "").toLowerCase().includes(search);
      });
    }

    // Sort newest first (examno descending)
    const sorted = [...valid].sort((a, b) =>
      ((b.examno as number) ?? 0) - ((a.examno as number) ?? 0)
    );

    const total = sorted.length;
    const paged = sorted.slice((page - 1) * limit, page * limit);

    res.json({ quizzes: paged.map(parseExam), total, page, limit });
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch quizzes");
    res.status(500).json({ error: "Failed to fetch quizzes" });
  }
});

// GET /api/quiz/:examId — fetch exam with ALL questions (actual count, no hardcode)
router.get("/quiz/:examId", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { examId } = req.params;

    const data = await tncProtectedRequest("fe_ex", { examids: [examId], type: "with_label" });

    if (!Array.isArray(data) || data.length === 0) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }

    const exam = (data as Record<string, unknown>[])[0];
    const quRefids = (exam.qu_refid as string[]) ?? [];
    const actualQuestionCount = quRefids.length;

    // Fetch ALL questions in parallel batches of 50 (no hardcoded cap)
    const BATCH_SIZE = 50;
    const batches: string[][] = [];
    for (let i = 0; i < actualQuestionCount; i += BATCH_SIZE) {
      batches.push(quRefids.slice(i, i + BATCH_SIZE));
    }

    const batchResults = await Promise.all(
      batches.map((ids) =>
        tncProtectedRequest("fe", { json: "*" }, { sch: "t_qu", cond: { "(row_id)": ids } })
      )
    );

    const questions = batchResults
      .flatMap((r) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : []))
      .map(parseQuestion)
      .filter((q) => q.questionText.trim().length > 0);

    // Sort by questionNo if available, else preserve CRM order
    questions.sort((a, b) => {
      if (a.questionNo !== null && b.questionNo !== null) return a.questionNo - b.questionNo;
      return 0;
    });

    const examMeta = parseExam(exam);
    res.json({
      ...examMeta,
      questionCount: actualQuestionCount,
      questions,
    });
  } catch (err) {
    if (sendTncLoginRequired(res, err)) return;
    logger.error({ err }, "Failed to fetch quiz");
    res.status(500).json({ error: "Failed to fetch quiz" });
  }
});

// GET /api/firebase-stream/:fsId — proxy-stream a Firebase secured video to the browser
// Works with user email/password auth OR service account (no service account needed if email/pass set)
router.get("/firebase-stream/:fsId", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  const fsId = String(req.params.fsId);

  if (!isFirebaseConfigured()) {
    res.status(503).json({
      error: "Firebase not configured",
      options: {
        easy: "Set FIREBASE_USER_EMAIL + FIREBASE_USER_PASSWORD env vars (any TNC account)",
        advanced: "Set FIREBASE_SERVICE_ACCOUNT env var (service account JSON from Firebase Console)",
      },
    });
    return;
  }

  try {
    await streamFirebaseVideo(fsId, req.headers.range, res);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "no_auth") {
      res.status(503).json({ error: "Firebase auth failed — check credentials" });
    } else if (msg === "not_found") {
      res.status(404).json({ error: "Video not found in Firebase Storage" });
    } else if (msg.startsWith("upstream_")) {
      const status = Number(msg.slice("upstream_".length));
      res.status(Number.isInteger(status) && status >= 400 && status < 600 ? status : 502).json({
        error: "Firebase video request failed",
      });
    } else {
      logger.error({ err, fsId }, "Firebase stream failed");
      res.status(500).json({ error: "Stream failed" });
    }
  }
});

// GET /api/firebase-video/:fsId — get a direct download URL (service account only)
router.get("/firebase-video/:fsId", requireApprovedSiteUser, async (req: Request, res: Response): Promise<void> => {
  const fsId = String(req.params.fsId);
  if (!isServiceAccountConfigured()) {
    res.status(503).json({ error: "Requires FIREBASE_SERVICE_ACCOUNT. Use /api/firebase-stream/:fsId for email/password auth." });
    return;
  }
  try {
    const result = await getCachedFirebaseVideoUrl(fsId);
    if (!result) { res.status(404).json({ error: "Video not found" }); return; }
    res.json({ url: result.url, path: result.path });
  } catch (err) {
    logger.error({ err, fsId }, "Firebase video URL resolution failed");
    res.status(500).json({ error: "Failed to resolve Firebase video" });
  }
});

// POST /api/firebase-auth — test Firebase email/password sign-in
router.post("/firebase-auth", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password required" });
    return;
  }
  try {
    const tokens = await signInWithEmailPassword(email, password);
    res.json({ success: true, expiresAt: new Date(tokens.expiresAt).toISOString() });
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

// GET /api/firebase-status — check what Firebase auth is configured
router.get("/firebase-status", (_req: Request, res: Response): void => {
  res.json({
    configured: isFirebaseConfigured(),
    method: isUserAuthConfigured() ? "email_password" : isServiceAccountConfigured() ? "service_account" : null,
    projectId: "team-nursing-classes-818e5",
    bucket: "team-nursing-classes-818e5.appspot.com",
    setup: isFirebaseConfigured() ? null : {
      option1: "Set FIREBASE_USER_EMAIL + FIREBASE_USER_PASSWORD (any TNC account email+password)",
      option2: "Set FIREBASE_SERVICE_ACCOUNT (service account JSON from Firebase Console)",
    },
  });
});

export default router;
