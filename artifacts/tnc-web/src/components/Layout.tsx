import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, Video, FileText, Home, LogOut, Shield, Menu, X, ChevronRight, Brain, Trophy, Maximize2, Minimize2, MessageCircle, Send, History, Moon, Sun, Snowflake } from "lucide-react";
import { getUser, isAdmin, clearAdminToken } from "@/lib/auth";
import { getTelegramUser, isTelegramWebApp, openExternalLink, openTelegramLink } from "@/lib/telegram";
import TncLoginPrompt from "@/components/TncLoginPrompt";
import { useWinterEffects } from "@/components/WinterEffectsProvider";
import { useSiteAuth } from "@/components/SiteAuthProvider";

interface LayoutProps {
  children: React.ReactNode;
}

const SUPPORT_URL = "https://t.me/testsagarbot";
const CHANNEL_URL = "https://t.me/tnc_test_series_free";
const TEST_SITE_URL = "https://test.tncnursing.site/tnc-tests/";

type NavItem =
  | { path: string; label: string; icon: React.ElementType; external?: undefined }
  | { path: string; label: string; icon: React.ElementType; external: string };

const navItems: NavItem[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/videos", label: "Videos", icon: Video },
  { path: "/watched", label: "Watched", icon: History },
  { path: "/quiz", label: "Tests", icon: Brain, external: TEST_SITE_URL },
  { path: "/enotes", label: "E-Notes", icon: FileText },
  { path: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { path: "/courses", label: "Courses", icon: BookOpen },
];

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const DARK_MODE_KEY = "tnc-dark-mode";
const CHANNEL_JOIN_CLICKED_AT_KEY = "tnc_channel_join_clicked_at";
const CHANNEL_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function shouldShowChannelPrompt(): boolean {
  try {
    const lastJoinedClickAt = Number(localStorage.getItem(CHANNEL_JOIN_CLICKED_AT_KEY));
    if (Number.isFinite(lastJoinedClickAt) && lastJoinedClickAt > 0 && Date.now() - lastJoinedClickAt < CHANNEL_PROMPT_COOLDOWN_MS) {
      return false;
    }
  } catch {
    return true;
  }
  return true;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

function VisitorGreeting() {
  const { session } = useSiteAuth();
  const user = getUser();
  const telegramUser = getTelegramUser();
  const [animeImageUrl, setAnimeImageUrl] = useState<string | null>(null);
  const metadata = session?.user.user_metadata ?? {};
  const googleName = [metadata.full_name, metadata.name, metadata.given_name].find((value) => typeof value === "string" && value.trim());
  const name = typeof googleName === "string" ? googleName : user?.name || telegramUser?.first_name || "";

  useEffect(() => {
    let active = true;
    fetch("https://api.waifu.im/images?IncludedTags=waifu&IsNsfw=False&PageSize=1", { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() as Promise<{ items?: Array<{ url?: string }> }> : null)
      .then((data) => {
        const imageUrl = data?.items?.[0]?.url;
        if (active && imageUrl?.startsWith("https://")) setAnimeImageUrl(imageUrl);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!name) return null;

  return (
    <section className="mx-auto my-5 flex max-w-6xl items-center gap-3 px-4" data-testid="visitor-greeting">
      {animeImageUrl
        ? <img src={animeImageUrl} alt="Anime study companion" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full border-2 border-[hsl(var(--secondary))] object-cover" loading="lazy" />
        : <div aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-800">{name.slice(0, 1).toUpperCase()}</div>}
      <div>
        <p className="text-lg font-black text-gray-900">{getGreeting()}, {name}.</p>
        <p className="text-sm text-gray-500">Ready for a focused study session?</p>
      </div>
    </section>
  );
}

export default function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(DARK_MODE_KEY) === "true");
  const [showChannelPrompt, setShowChannelPrompt] = useState(shouldShowChannelPrompt);
  const { enabled: winterEffectsEnabled, toggle: toggleWinterEffects } = useWinterEffects();
  const admin = isAdmin();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key === DARK_MODE_KEY) setDarkMode(event.newValue === "true");
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  function toggleDarkMode() {
    const next = !darkMode;
    localStorage.setItem(DARK_MODE_KEY, String(next));
    setDarkMode(next);
  }

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const target = document.documentElement;
      if (target.requestFullscreen) {
        await target.requestFullscreen();
      }
    } catch {
      // Ignore unsupported or blocked fullscreen requests.
    }
  }

  function handleAdminLogout() {
    clearAdminToken();
    setLocation("/");
    setMobileMenuOpen(false);
  }

  function handleJoinChannel(event: React.MouseEvent<HTMLAnchorElement>) {
    try {
      localStorage.setItem(CHANNEL_JOIN_CLICKED_AT_KEY, String(Date.now()));
    } catch {
      // Keep the prompt visible on the next page load if storage is unavailable.
    }
    setShowChannelPrompt(false);
    if (isTelegramWebApp()) {
      event.preventDefault();
      openTelegramLink(CHANNEL_URL);
    }
  }

  return (
    <div className="winter-season min-h-screen flex flex-col" style={{ backgroundColor: "hsl(var(--background))" }}>
      {/* Desktop Top Nav */}
      <header className="sticky top-0 z-50 hidden border-b border-white/10 bg-[hsl(var(--primary))] shadow-lg md:block">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <span className="winter-brand-mark" aria-hidden="true">
                <img src={`${BASE}/logo.svg`} alt="" className="winter-brand-logo" />
                <Snowflake size={13} className="winter-brand-snow" />
              </span>
              <div className="text-white">
                <div className="font-black text-base leading-none tracking-tight">TNC / NURSING</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-white/60">Study desk</div>
              </div>
            </Link>

            {/* Nav links */}
            <nav className="flex items-center gap-1">
              {navItems.map(({ path, label, icon: Icon, external }) => {
                const active = !external && (location === path || (path !== "/" && location.startsWith(path)));
                const baseClass = `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  active ? "bg-white/20 text-white" : "text-white/80 hover:text-white hover:bg-white/10"
                }`;
                if (external) {
                  return (
                    <button
                      key={path}
                      onClick={() => openExternalLink(external)}
                      className={baseClass}
                      data-testid={`nav-${label.toLowerCase()}`}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  );
                }
                return (
                  <Link key={path} href={path} className={baseClass} data-testid={`nav-${label.toLowerCase()}`}>
                    <Icon size={16} />
                    {label}
                  </Link>
                );
              })}
            </nav>

            {/* Admin link */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleDarkMode}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                aria-pressed={darkMode}
                data-testid="btn-theme-toggle"
              >
                {darkMode ? <Sun size={15} /> : <Moon size={15} />}
                {darkMode ? "Light mode" : "Dark mode"}
              </button>
              <button
                type="button"
                onClick={toggleWinterEffects}
                className="winter-effect-toggle"
                title={winterEffectsEnabled ? "Turn snowfall off" : "Turn snowfall on"}
                aria-label={winterEffectsEnabled ? "Turn snowfall off" : "Turn snowfall on"}
                aria-pressed={winterEffectsEnabled}
                data-testid="btn-winter-effects"
              >
                <Snowflake size={16} />
              </button>
              {admin ? (
                <>
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-yellow-400/20 text-yellow-200 hover:bg-yellow-400/30 transition-colors border border-yellow-400/30"
                    data-testid="nav-admin"
                  >
                    <Shield size={14} />
                    Admin
                  </Link>
                  <button
                    onClick={handleAdminLogout}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                    data-testid="btn-logout"
                  >
                    <LogOut size={14} />
                    Logout
                  </button>
                </>
              ) : (
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                  data-testid="nav-support"
                >
                  <MessageCircle size={14} />
                  Support
                </a>
              )}
              <a
                href={CHANNEL_URL}
                onClick={handleJoinChannel}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white hover:bg-white/25 transition-colors"
                data-testid="nav-join-channel"
              >
                <Send size={14} />
                Join Channel
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Top Bar */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[hsl(var(--primary))] shadow-lg md:hidden">
        <div className="flex items-center justify-between h-14 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="winter-brand-mark winter-brand-mark--mobile" aria-hidden="true">
              <img src={`${BASE}/logo.svg`} alt="" className="winter-brand-logo" />
              <Snowflake size={11} className="winter-brand-snow" />
            </span>
            <span className="text-white font-black text-sm tracking-tight">TNC / NURSING</span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDarkMode}
              className="text-white p-1.5 rounded-lg bg-white/15"
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={darkMode}
              data-testid="btn-theme-toggle"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={toggleFullscreen}
              className="text-white p-1.5 rounded-lg bg-white/15"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              data-testid="btn-fullscreen"
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            {admin && (
              <Link href="/admin" className="text-yellow-300 text-xs font-semibold px-2 py-1 rounded-lg bg-yellow-400/15">
                Admin
              </Link>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="text-white p-1"
              data-testid="btn-mobile-menu"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileMenuOpen && (
          <div className="absolute top-14 left-0 right-0 bg-white shadow-xl border-b z-50 py-2">
            {navItems.map(({ path, label, icon: Icon, external }) => {
              if (external) {
                return (
                  <button
                    key={path}
                    onClick={() => { openExternalLink(external); setMobileMenuOpen(false); }}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    data-testid={`mobile-nav-${label.toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {label}
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                );
              }
              return (
                <Link
                  key={path}
                  href={path}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  data-testid={`mobile-nav-${label.toLowerCase()}`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} />
                    {label}
                  </div>
                  <ChevronRight size={16} className="text-gray-400" />
                </Link>
              );
            })}
            <div className="mx-4 my-2 flex items-center justify-between border-y border-sky-100/70 py-2.5">
              <div className="flex items-center gap-3 text-sm font-medium text-gray-700">
                <Snowflake size={18} className="text-sky-600" />
                Winter snowfall
              </div>
              <button
                type="button"
                onClick={toggleWinterEffects}
                className={`winter-switch ${winterEffectsEnabled ? "is-on" : ""}`}
                role="switch"
                aria-checked={winterEffectsEnabled}
                aria-label="Toggle winter snowfall"
                data-testid="btn-winter-effects-mobile"
              >
                <span />
              </button>
            </div>
            {admin && (
              <div className="border-t mt-2 pt-2 px-4 space-y-1">
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 px-1 py-2 text-sm font-semibold text-yellow-600"
                >
                  <Shield size={16} />
                  Admin Panel
                </Link>
                <button
                  onClick={handleAdminLogout}
                  className="w-full flex items-center gap-2 px-1 py-2 text-sm text-red-600 font-medium"
                  data-testid="mobile-btn-logout"
                >
                  <LogOut size={16} />
                  Logout Admin
                </button>
              </div>
            )}
            {/* Support link */}
            <div className="border-t mt-2 pt-2 px-4">
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-1 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <MessageCircle size={16} />
                Contact Admin / Support
              </a>
              <a
                href={CHANNEL_URL}
                onClick={handleJoinChannel}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-1 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                data-testid="mobile-join-channel"
              >
                <Send size={16} />
                Join Channel for Updates
              </a>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="study-grid flex-1">
        <VisitorGreeting />
        {children}
      </main>
      <TncLoginPrompt enabled={location === "/courses" || location.startsWith("/courses/")} />

      {showChannelPrompt && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="channel-join-title" data-testid="channel-join-modal">
          <div className="relative w-full max-w-sm rounded-2xl border border-sky-100 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 h-36 w-36 overflow-hidden rounded-2xl border border-gray-200 bg-black shadow-sm">
              <img src={`${BASE}/dark-logo-1.jpg`} alt="TNC channel logo" className="h-full w-full object-cover" />
            </div>
            <h2 id="channel-join-title" className="text-xl font-black text-gray-900">Join our Telegram channel</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">Join the TNC Nursing channel to continue. Get course announcements and study updates there.</p>
            <a
              href={CHANNEL_URL}
              onClick={handleJoinChannel}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
              data-testid="btn-join-telegram-channel"
            >
              <Send size={16} />
              Join Channel
            </a>
          </div>
        </div>
      )}

      {/* Mobile Bottom Tabs */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-40 flex" style={{ backgroundColor: "hsl(var(--card))" }}>
        {navItems.map(({ path, label, icon: Icon, external }) => {
          const active = !external && (location === path || (path !== "/" && location.startsWith(path)));
          const baseClass = `flex-1 flex flex-col items-center justify-center py-2 text-xs font-medium transition-colors ${
            active ? "text-blue-600" : "text-gray-500"
          }`;
          if (external) {
            return (
              <button
                key={path}
                onClick={() => openExternalLink(external)}
                className={baseClass}
                data-testid={`tab-${label.toLowerCase()}`}
              >
                <Brain size={20} strokeWidth={1.8} />
                <span className="mt-0.5 text-[10px]">{label}</span>
              </button>
            );
          }
          return (
            <Link
              key={path}
              href={path}
              className={baseClass}
              data-testid={`tab-${label.toLowerCase()}`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span className="mt-0.5 text-[10px]">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom padding for mobile tabs */}
      <div className="md:hidden h-16" />
    </div>
  );
}
