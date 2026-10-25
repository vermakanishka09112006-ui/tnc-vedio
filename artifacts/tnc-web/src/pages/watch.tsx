import { useParams, Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useGetSession, useGetPromoStatus, useGetUserPurchases, getGetUserPurchasesQueryKey, useListSessions, getListSessionsQueryKey } from "@/lib/api-client";
import { ArrowLeft, Lock, Video, FileText, AlertCircle, ChevronRight, PlayCircle, Loader2, Maximize, Settings, Volume2, Clock, X, SkipBack, SkipForward, VolumeX, Volume1, RotateCw, RotateCcw, CheckCircle2 } from "lucide-react";
import Layout from "@/components/Layout";
import { getUser } from "@/lib/auth";
import { isVideoCompleted, markVideoWatched, toggleVideoCompleted } from "@/lib/streak";
import { getTelegramUser } from "@/lib/telegram";
import { useSiteAuth } from "@/components/SiteAuthProvider";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function getApiUrl(path: string) {
  return `${BASE}${path}`;
}

function requestVideoFullscreen(video: HTMLVideoElement) {
  type VideoWithWebkit = HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitRequestFullscreen?: () => void;
  };
  const v = video as VideoWithWebkit;
  if (v.requestFullscreen) {
    v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
  } else if (v.webkitEnterFullscreen) {
    v.webkitEnterFullscreen(); // iOS Safari / Telegram WebView
  } else if (v.webkitRequestFullscreen) {
    v.webkitRequestFullscreen();
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function HlsPlayer({ src, sessionId }: { src: string; sessionId?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(false);
    setBuffering(true);
    let cleanup: (() => void) | undefined;

    const isHls = src.includes(".m3u8");
    const isProxied = src.startsWith("/api/media-proxy");

    const onCanPlay = () => setBuffering(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => setDuration(video.duration);
    const onVolumeChange = () => {
      setIsMuted(video.muted);
      setVolume(video.volume);
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("volumechange", onVolumeChange);

    if (isHls && !isProxied) {
      import("hls.js").then(({ default: Hls }) => {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            startLevel: -1,           // auto quality
            maxBufferLength: 30,      // 30s buffer
            maxMaxBufferLength: 60,
            backBufferLength: 10,
            abrEwmaFastLive: 3.0,
            abrEwmaSlowLive: 9.0,
            progressive: true,
          });
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setBuffering(false);
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setError(true);
          });
          cleanup = () => hls.destroy();
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
        }
      });
    } else {
      video.src = src;
      video.onerror = () => setError(true);
    }

    if (sessionId) {
      const onPlay = () => markVideoWatched(sessionId);
      video.addEventListener("play", onPlay);
      const prevCleanup = cleanup;
      cleanup = () => {
        video.removeEventListener("play", onPlay);
        prevCleanup?.();
      };
    }

    return () => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("volumechange", onVolumeChange);
      cleanup?.();
    };
  }, [src, sessionId]);

  const handleRewind = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    }
  };

  const handleForward = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10);
    }
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const handleFullscreen = () => {
    if (videoRef.current) {
      requestVideoFullscreen(videoRef.current);
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
    }
  };

  if (error) {
    return (
      <div className="w-full h-64 bg-black rounded-xl flex flex-col items-center justify-center text-white/60 gap-3">
        <AlertCircle size={36} />
        <p className="text-sm">Video failed to load. Try refreshing.</p>
        <button
          onClick={() => { setError(false); if (videoRef.current) videoRef.current.load(); }}
          className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black shadow-2xl">
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10 pointer-events-none">
          <Loader2 size={40} className="text-white animate-spin" />
        </div>
      )}
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        className="absolute inset-0 z-0 w-full h-full bg-black"
        data-testid="video-player"
        controlsList="nodownload"
        style={{ objectFit: "contain" }}
      >
        Your browser does not support video playback.
      </video>
      {/* Enhanced video controls overlay for better visibility and Telegram compatibility */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 to-black/50 p-4 z-20">
        {/* Progress bar */}
        <div className="mb-3 w-full bg-white/20 rounded-full h-1.5">
          <div 
            className="bg-white h-1.5 rounded-full transition-all duration-300"
            style={{ 
              width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' 
            }}
          />
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRewind}
              className="p-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all duration-200 backdrop-blur-sm"
              aria-label="Rewind 10 seconds"
              data-testid="btn-rewind"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={handlePlayPause}
              className="p-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all duration-200 backdrop-blur-sm"
              aria-label="Play/Pause"
              data-testid="btn-play-pause"
            >
              <PlayCircle size={18} />
            </button>
            <button
              onClick={handleForward}
              className="p-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all duration-200 backdrop-blur-sm"
              aria-label="Forward 10 seconds"
              data-testid="btn-forward"
            >
              <SkipForward size={18} />
            </button>
            
            {/* Timestamp display */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-white text-xs font-mono">
              <Clock size={12} className="text-white/70" />
              <span>{formatTime(currentTime)} / {formatTime(duration || 0)}</span>
            </div>
          </div>
          
          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* Volume control */}
            <div className="relative group">
              <button
                onClick={handleMute}
                className="p-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all duration-200 backdrop-blur-sm"
                aria-label="Mute"
                data-testid="btn-mute"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX size={18} />
                ) : volume < 0.5 ? (
                  <Volume1 size={18} />
                ) : (
                  <Volume2 size={18} />
                )}
              </button>
              <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 hidden group-hover:block bg-black/90 backdrop-blur-sm rounded-lg p-3 shadow-xl border border-white/10 min-w-[120px]">
                <div className="flex items-center gap-2">
                  <VolumeX size={14} className="text-white/70" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1.5 bg-white/20 rounded-full appearance-none slider"
                  />
                </div>
              </div>
            </div>
            
            {/* Settings button */}
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all duration-200 backdrop-blur-sm"
                aria-label="Settings"
                data-testid="btn-settings"
              >
                <Settings size={18} />
              </button>
              {showSettings && (
                <div className="absolute bottom-12 right-0 bg-black/90 backdrop-blur-sm rounded-lg p-4 shadow-xl border border-white/10 min-w-[180px]">
                  <div className="text-white text-xs font-medium mb-3">Playback Speed</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2, 2.25, 2.5].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => {
                          handlePlaybackRateChange(rate);
                          setShowSettings(false);
                        }}
                        className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${playbackRate === rate ? 'bg-white text-black' : 'bg-white/20 text-white hover:bg-white/30'}`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="text-white text-xs font-medium mb-2">Quality</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowQuality(!showQuality)}
                        className="px-2 py-1 rounded text-xs font-medium bg-white/20 text-white hover:bg-white/30 transition-colors"
                      >
                        Auto
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Explicit fullscreen button for Telegram WebView / iOS where native controls fullscreen is blocked */}
            <button
              onClick={handleFullscreen}
              className="p-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all duration-200 backdrop-blur-sm"
              aria-label="Fullscreen"
              data-testid="btn-fullscreen"
            >
              <Maximize size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function YouTubeEmbed({ url }: { url: string }) {
  const videoId = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
  if (!videoId) {
    return (
      <div className="h-40 flex items-center justify-center text-white/50 text-sm bg-black rounded-xl">
        Could not parse YouTube video ID
      </div>
    );
  }
  return (
    <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1&autoplay=0`}
        className="absolute inset-0 w-full h-full rounded-xl"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        data-testid="youtube-embed"
        title="Video lecture"
      />
    </div>
  );
}

function PdfViewer({ url, title }: { url: string; title: string }) {
  const fullUrl = url.startsWith("http") ? url : getApiUrl(url);
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-gray-50">
          <FileText size={18} className="text-red-500" />
          <span className="text-sm font-semibold text-gray-700 truncate flex-1">{title}</span>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 font-medium hover:underline shrink-0"
          >
            Open in new tab ↗
          </a>
        </div>
        <iframe
          src={fullUrl}
          className="w-full"
          style={{ height: "75vh" }}
          title={title}
          loading="lazy"
          data-testid="pdf-viewer"
        />
      </div>
    </div>
  );
}

function FsVideoPlayer({ firebaseId, title }: { firebaseId: string; title: string }) {
  const playerUrl = `https://videoplay.tncnursing.in/videos/fs/index.html?${encodeURIComponent(firebaseId)}`;
  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-xl" style={{ paddingTop: "56.25%" }}>
      <iframe
        src={playerUrl}
        className="absolute inset-0 w-full h-full"
        allowFullScreen
        allow="autoplay; fullscreen; picture-in-picture"
        title={title}
        loading="eager"
        data-testid="fs-video-player"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

function NoContentCard({ title }: { title: string }) {
  return (
    <div className="bg-gray-50 rounded-2xl border border-gray-100 p-8 text-center">
      <AlertCircle size={40} className="mx-auto text-gray-300 mb-3" />
      <h2 className="text-base font-semibold text-gray-600 mb-1">{title}</h2>
      <p className="text-sm text-gray-400">No viewable content is attached to this session yet.</p>
    </div>
  );
}

function VideoPlayer({ session, sessionId }: { session: { videoUrl: string | null; contentType: string; title: string }; sessionId: string }) {
  const { videoUrl } = session;
  if (!videoUrl) return null;

  const isYT = videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be");

  return (
    <div className="bg-black rounded-2xl overflow-hidden shadow-2xl">
      {isYT ? (
        <YouTubeEmbed url={videoUrl} />
      ) : (
        <HlsPlayer src={videoUrl.startsWith("/api/") ? getApiUrl(videoUrl) : videoUrl} sessionId={sessionId} />
      )}
    </div>
  );
}

function CoursePlaylist({ courseId, currentSessionId }: { courseId: string; currentSessionId: string }) {
  const [showAll, setShowAll] = useState(false);
  const { data: sessionsRaw } = useListSessions(
    { courseId },
    { query: { queryKey: getListSessionsQueryKey({ courseId }) } }
  );

  const sessions = Array.isArray(sessionsRaw) ? sessionsRaw : [];
  const displaySessions = showAll ? sessions : sessions.slice(0, 12);

  if (!sessions.length) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">Course Playlist</h3>
        <span className="text-xs text-gray-400">{sessions.length} lessons</span>
      </div>
      <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
        {displaySessions.map((s) => {
          const isCurrent = s.rowId === currentSessionId;
          const isVideo = s.contentType === "youtube" || s.contentType === "firebase" || s.videoUrl;
          const isPdf = s.contentType === "pdf" || s.pdfUrl;
          const href = isVideo
            ? `/watch/${s.rowId}`
            : isPdf
              ? `/pdf/${s.rowId}`
              : `/watch/${s.rowId}`;

          return (
            <Link
              key={s.rowId}
              href={href}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors ${isCurrent ? "bg-blue-50 border-l-2 border-blue-600" : ""}`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isCurrent ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-400"}`}>
                {isVideo ? <PlayCircle size={14} /> : isPdf ? <FileText size={13} /> : <Video size={13} />}
              </div>
              <p className={`text-xs font-medium truncate flex-1 ${isCurrent ? "text-blue-700" : "text-gray-700"}`}>{s.title}</p>
              {isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0" />}
            </Link>
          );
        })}
      </div>
      {sessions.length > 12 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50 border-t transition-colors"
        >
          {showAll ? "Show less" : `Show all ${sessions.length} lessons`}
        </button>
      )}
    </div>
  );
}

export default function WatchPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const user = getUser();
  const { session: googleSession } = useSiteAuth();
  const [isCompleted, setIsCompleted] = useState(() => Boolean(sessionId && isVideoCompleted(sessionId)));

  const { data: session, isLoading } = useGetSession(sessionId ?? "");
  const { data: promo } = useGetPromoStatus();
  const { data: purchases } = useGetUserPurchases(user?.userId ?? "", {
    query: { enabled: !!user, queryKey: getGetUserPurchasesQueryKey(user?.userId ?? "") },
  });

  const purchasedIds = new Set((Array.isArray(purchases) ? purchases : []).map((p) => p.courseId));
  const isCourseUnlocked = promo?.enabled || (!!session?.courseId && purchasedIds.has(session.courseId));
  const isUnlocked = !session?.isPaid || isCourseUnlocked;

  useEffect(() => {
    const syncCompletion = () => setIsCompleted(Boolean(sessionId && isVideoCompleted(sessionId)));
    syncCompletion();
    window.addEventListener("tnc-watched-videos-updated", syncCompletion);
    window.addEventListener("storage", syncCompletion);
    return () => {
      window.removeEventListener("tnc-watched-videos-updated", syncCompletion);
      window.removeEventListener("storage", syncCompletion);
    };
  }, [sessionId]);

  useEffect(() => {
    const telegramUser = getTelegramUser();
    const metadata = googleSession?.user.user_metadata ?? {};
    const profileName = [metadata.full_name, metadata.name, metadata.given_name].find((value) => typeof value === "string" && value.trim());
    const resolvedVisitorName = typeof profileName === "string"
      ? profileName
      : user?.name || googleSession?.user.email?.split("@")[0] || "Student";
    const visitorId = googleSession ? `google_${googleSession.user.id}` : localStorage.getItem("tnc_visitor_id");
    if ((!telegramUser && (!visitorId || !resolvedVisitorName)) || !isUnlocked || !sessionId) return;
    let lastSent = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.round((Date.now() - lastSent) / 1000);
      lastSent = Date.now();
      if (document.visibilityState !== "visible") return;
      fetch(`${BASE}/api/bot/study/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(googleSession ? { Authorization: `Bearer ${googleSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          ...(telegramUser ? { telegramId: telegramUser.id } : { visitorId, visitorName: resolvedVisitorName }),
          sessionId,
          seconds: elapsed,
        }),
      }).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [googleSession, isUnlocked, sessionId, user?.name]);

  useEffect(() => {
    if (!session || !isUnlocked || !sessionId) return;
    const contentType = session.contentType ?? (session.videoUrl ? "youtube" : "none");
    if (contentType !== "youtube" && contentType !== "firebase" && !session.videoUrl) return;
    markVideoWatched(sessionId, { title: session.title, courseId: session.courseId ?? null });
  }, [isUnlocked, session, sessionId]);

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="h-80 skeleton rounded-2xl mb-4" />
          <div className="h-6 skeleton rounded w-1/2 mb-2" />
          <div className="h-4 skeleton rounded w-3/4" />
        </div>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout>
        <div className="text-center py-20">
          <Video size={48} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">Session not found</p>
          <Link href="/courses" className="text-blue-600 text-sm mt-2 inline-block">Back to courses</Link>
        </div>
      </Layout>
    );
  }

  const contentType = session.contentType ?? (session.videoUrl ? "youtube" : "none");
  const isVideoContent = contentType === "youtube" || contentType === "firebase" || Boolean(session.videoUrl);
  const backHref = session.courseId ? `/courses/${session.courseId}` : "/courses";

  const firebaseId = (session as unknown as Record<string, unknown>).firebaseId as string | null ?? null;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <Link
          href={backHref}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4 w-fit"
          data-testid="link-back-session"
        >
          <ArrowLeft size={14} /> Back to Course
        </Link>

        <div className="flex flex-col lg:flex-row gap-5">
          <div className="flex-1 min-w-0">
            {!isUnlocked ? (
              <div className="bg-gray-100 rounded-2xl p-12 text-center">
                <Lock size={48} className="mx-auto text-gray-300 mb-4" />
                <h2 className="text-lg font-bold text-gray-700 mb-2">Content Locked</h2>
                <p className="text-gray-500 text-sm mb-4">Purchase the course to access this paid session</p>
                <Link href="/buy" className="px-6 py-2 rounded-xl tnc-brand-gradient text-white text-sm font-semibold inline-block" data-testid="btn-buy-unlock">
                  Buy Course
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {isVideoContent ? (
                  <div className="relative">
                    {contentType === "youtube" && session.videoUrl ? (
                      <VideoPlayer session={{ ...session, videoUrl: session.videoUrl ?? null }} sessionId={sessionId ?? ""} />
                    ) : contentType === "firebase" && firebaseId ? (
                      <FsVideoPlayer firebaseId={firebaseId} title={session.title} />
                    ) : (
                      <NoContentCard title={session.title} />
                    )}
                    <button
                      type="button"
                      onClick={() => setIsCompleted(toggleVideoCompleted(sessionId ?? "", { title: session.title, courseId: session.courseId ?? null }))}
                      aria-pressed={isCompleted}
                      aria-label={isCompleted ? "Mark lecture incomplete" : "Mark lecture complete"}
                      className={`absolute right-3 top-3 z-30 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold shadow-lg transition-colors ${
                        isCompleted
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-white/95 text-gray-800 hover:bg-white"
                      }`}
                      data-testid="btn-toggle-lecture-complete"
                    >
                      <CheckCircle2 size={17} />
                      {isCompleted ? "Completed" : "Mark complete"}
                    </button>
                  </div>
                ) : contentType === "pdf" && session.pdfUrl ? (
                  <PdfViewer url={session.pdfUrl} title={session.title} />
                ) : (
                  <NoContentCard title={session.title} />
                )}

                {contentType !== "pdf" && (
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="text-lg font-black text-gray-900 leading-snug" data-testid="session-title">
                        {session.title}
                      </h1>
                      {!session.isPaid && (
                        <span className="bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">FREE</span>
                      )}
                    </div>
                    {session.courseId && (
                      <Link href={`/courses/${session.courseId}`} className="text-xs text-blue-600 mt-2 inline-flex items-center gap-1 hover:underline">
                        View full course <ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {session.courseId && (
            <div className="lg:w-72 flex-shrink-0">
              <CoursePlaylist courseId={session.courseId} currentSessionId={sessionId ?? ""} />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
