import { useParams, Link } from "wouter";
import { useGetSession, useGetPromoStatus, useGetUserPurchases, getGetUserPurchasesQueryKey } from "@/lib/api-client";
import { ArrowLeft, Lock, ExternalLink, FileText, Loader2 } from "lucide-react";
import Layout from "@/components/Layout";
import { getUser } from "@/lib/auth";
import { useEffect, useState } from "react";
import { customFetch } from "@/lib/api-client/custom-fetch";

export default function PdfViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const user = getUser();
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState(false);

  // Use single-session endpoint instead of fetching all sessions
  const { data: session, isLoading } = useGetSession(sessionId ?? "");

  const { data: promo } = useGetPromoStatus();
  const { data: purchases } = useGetUserPurchases(user?.userId ?? "", {
    query: { enabled: !!user, queryKey: getGetUserPurchasesQueryKey(user?.userId ?? "") },
  });

  const purchasedIds = new Set((purchases ?? []).map((p) => p.courseId));
  // Free sessions are accessible to all; paid need unlock
  const isCourseUnlocked = promo?.enabled || (!!session?.courseId && purchasedIds.has(session.courseId));
  const isUnlocked = !session?.isPaid || isCourseUnlocked;

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="h-8 skeleton rounded w-1/3 mb-4" />
          <div className="h-[70vh] skeleton rounded-2xl" />
        </div>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <div className="text-center py-20">
          <FileText size={48} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">PDF not found</p>
          <Link href="/enotes" className="text-blue-600 text-sm mt-2 inline-block">Back to E-Notes</Link>
        </div>
      </Layout>
    );
  }

  // Build full proxied PDF URL
  const pdfUrl = session.pdfUrl
    ? (session.pdfUrl.startsWith("http") ? session.pdfUrl : `${base}${session.pdfUrl}`)
    : null;

  useEffect(() => {
    if (!pdfUrl || !isUnlocked) {
      setPdfObjectUrl(null);
      setPdfLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setPdfLoading(true);
    setPdfError(false);
    setPdfObjectUrl(null);
    void customFetch<Blob>(pdfUrl, { responseType: "blob" }).then((file) => {
      objectUrl = URL.createObjectURL(file);
      if (cancelled) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setPdfObjectUrl(objectUrl);
      setPdfLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setPdfError(true);
      setPdfLoading(false);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isUnlocked, pdfUrl]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <Link
            href={session.courseId ? `/courses/${session.courseId}` : "/enotes"}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 w-fit"
            data-testid="link-back-pdf"
          >
            <ArrowLeft size={14} /> Back to Course
          </Link>
          {pdfObjectUrl && isUnlocked && (
            <a
              href={pdfObjectUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              data-testid="btn-open-pdf-external"
            >
              Open in new tab <ExternalLink size={12} />
            </a>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50 flex items-center gap-3">
            <FileText size={18} className="text-red-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold text-gray-900 truncate" data-testid="pdf-title">{session.title}</h1>
              {!session.isPaid && (
                <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">FREE</span>
              )}
            </div>
          </div>

          {!isUnlocked ? (
            <div className="p-12 text-center">
              <Lock size={48} className="mx-auto text-gray-300 mb-4" />
              <h2 className="text-lg font-bold text-gray-700 mb-2">Content Locked</h2>
              <p className="text-gray-500 text-sm mb-4">Purchase the course to view this PDF note</p>
              <Link href="/buy" className="px-6 py-2 rounded-xl tnc-brand-gradient text-white text-sm font-semibold inline-block" data-testid="btn-buy-pdf">
                Buy Course
              </Link>
            </div>
          ) : !pdfUrl ? (
            <div className="p-12 text-center">
              <FileText size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-gray-500 text-sm">This session doesn't have a PDF attached.</p>
              <p className="text-xs text-gray-400 mt-1">It may be available only in the mobile app.</p>
            </div>
          ) : pdfError ? (
            <div className="p-12 text-center">
              <FileText size={40} className="mx-auto text-red-300 mb-3" />
              <p className="text-gray-700 text-sm font-semibold">PDF could not be loaded</p>
              <p className="mt-1 text-xs text-gray-500">Check your connection and try opening this note again.</p>
            </div>
          ) : (
            <div className="relative" style={{ height: "80vh" }}>
              {/* Loading overlay */}
              {pdfLoading && (
                <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center z-10">
                  <Loader2 size={32} className="animate-spin text-blue-600 mb-3" />
                  <p className="text-gray-600 text-sm">Loading PDF...</p>
                  <p className="text-xs text-gray-400 mt-1">This may take a few seconds</p>
                </div>
              )}
              <iframe
                src={pdfObjectUrl ?? undefined}
                className="w-full h-full border-0"
                title={session.title}
                data-testid="pdf-iframe"
                onLoad={() => setPdfLoading(false)}
                style={{ display: pdfLoading ? "none" : "block" }}
              />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
