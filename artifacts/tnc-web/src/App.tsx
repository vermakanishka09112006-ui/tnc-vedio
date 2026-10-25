import { Component, type ErrorInfo, type ReactNode, useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import BannedScreen from "@/components/BannedScreen";
import PageLoader from "@/components/PageLoader";
import SecurityGuard from "@/components/SecurityGuard";
import { getTelegramInitData, getTelegramUser, readyTelegramApp, expandTelegramApp, isTelegramWebApp } from "@/lib/telegram";

import HomePage from "@/pages/home";
import CoursesPage from "@/pages/courses";
import CourseDetailPage from "@/pages/course-detail";
import SubjectDetailPage from "@/pages/subject-detail";
import VideosPage from "@/pages/videos";
import WatchedPage from "@/pages/watched";
import EnotesPage from "@/pages/enotes";
import AdminPage from "@/pages/admin";
import WatchPage from "@/pages/watch";
import PdfViewerPage from "@/pages/pdf-viewer";
import NotFound from "@/pages/not-found";
import LeaderboardPage from "@/pages/leaderboard";
import BuyPage from "@/pages/buy";
import WinterEffectsProvider, { useWinterEffects } from "@/components/WinterEffectsProvider";
import WinterSnowfall from "@/components/WinterSnowfall";
import { ApiError } from "@/lib/api-client/custom-fetch";
import { initializeVisitorIdentity } from "@/lib/visitor-identity";
import SiteLoginPage from "@/pages/site-login";
import OAuthCallbackPage from "@/pages/oauth-callback";
import OAuthConsentPage from "@/pages/oauth-consent";
import { SiteAuthProvider } from "@/components/SiteAuthProvider";
import ProtectedSitePage from "@/components/ProtectedSitePage";
import { setAuthTokenGetter } from "@/lib/api-client/custom-fetch";
import { getSupabaseClient } from "@/lib/supabase";

setAuthTokenGetter(async () => {
  const client = await getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 428) return false;
        return failureCount < 1;
      },
    },
  },
});

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const TEST_SITE_URL = "https://test.tncnursing.site/tnc-tests/";

function RedirectToTests() {
  useEffect(() => {
    window.location.replace(TEST_SITE_URL);
  }, []);

  return <div className="px-4 py-12 text-center text-sm text-gray-500">Opening the test site...</div>;
}

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { hasError: boolean };

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled application error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 px-4 py-20 text-center">
          <h1 className="text-xl font-black text-gray-900">This page could not be loaded</h1>
          <p className="mt-2 text-sm text-gray-500">Please try again or return to your courses.</p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
            <a href={`${BASE}/courses`} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700">
              Back to courses
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/courses" component={CoursesPage} />
      <Route path="/login" component={SiteLoginPage} />
      <Route path="/auth/callback" component={OAuthCallbackPage} />
      <Route path="/oauth/consent" component={OAuthConsentPage} />
      <Route path="/courses/:courseId/subjects/:subjectId"><ProtectedSitePage><SubjectDetailPage /></ProtectedSitePage></Route>
      <Route path="/courses/:courseId"><ProtectedSitePage><CourseDetailPage /></ProtectedSitePage></Route>
      <Route path="/videos"><ProtectedSitePage><VideosPage /></ProtectedSitePage></Route>
      <Route path="/watched"><ProtectedSitePage><WatchedPage /></ProtectedSitePage></Route>
      <Route path="/enotes"><ProtectedSitePage><EnotesPage /></ProtectedSitePage></Route>
      <Route path="/leaderboard"><ProtectedSitePage><LeaderboardPage /></ProtectedSitePage></Route>
      <Route path="/quiz"><ProtectedSitePage><RedirectToTests /></ProtectedSitePage></Route>
      <Route path="/quiz/:examId"><ProtectedSitePage><RedirectToTests /></ProtectedSitePage></Route>
      <Route path="/buy"><ProtectedSitePage><BuyPage /></ProtectedSitePage></Route>
      <Route path="/admin" component={AdminPage} />
      <Route path="/watch/:sessionId"><ProtectedSitePage><WatchPage /></ProtectedSitePage></Route>
      <Route path="/pdf/:sessionId"><ProtectedSitePage><PdfViewerPage /></ProtectedSitePage></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function WinterSiteRouter() {
  const { enabled } = useWinterEffects();

  return (
    <div className="winter-site min-h-screen">
      <WinterSnowfall enabled={enabled} />
      <AppErrorBoundary>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
      </AppErrorBoundary>
    </div>
  );
}

function App() {
  const [banned, setBanned] = useState(false);
  const [checking, setChecking] = useState(true);
  const [visitorIdentityReady, setVisitorIdentityReady] = useState(false);

  useEffect(() => {
    let active = true;
    void initializeVisitorIdentity().finally(() => {
      if (active) setVisitorIdentityReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // If inside Telegram, do Telegram-specific setup
    if (isTelegramWebApp()) {
      readyTelegramApp();
      expandTelegramApp();
    }

    const tgUser = getTelegramUser();
    const initData = getTelegramInitData();

    if (tgUser) {
      fetch(`${BASE}/api/bot/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId: tgUser.id,
          firstName: tgUser.first_name,
          lastName: tgUser.last_name,
          username: tgUser.username,
          initData,
        }),
      })
        .then((r) => r.json())
        .then((data: { banned?: boolean }) => {
          if (data.banned) setBanned(true);
        })
        .catch(() => {
          // If check fails, allow access
        })
        .finally(() => setChecking(false));
    } else {
      // Non-Telegram browser — skip registration, go straight to app
      setChecking(false);
    }
  }, []);

  // Security guard - runs on every page load
  // This component handles keyboard blocking, devtools detection, and request blocking
  // It renders null but sets up all security measures in useEffect

  if (checking || !visitorIdentityReady) return <PageLoader />;
  if (banned) return <BannedScreen />;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WinterEffectsProvider>
          <SecurityGuard />
          <SiteAuthProvider><WinterSiteRouter /></SiteAuthProvider>
          <Toaster />
        </WinterEffectsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
