import { useEffect } from "react";
import { useLocation } from "wouter";
import PageLoader from "@/components/PageLoader";
import { useSiteAuth } from "@/components/SiteAuthProvider";

export default function OAuthCallbackPage() {
  const [, setLocation] = useLocation();
  const { session, loading } = useSiteAuth();
  const requestedPath = new URLSearchParams(window.location.search).get("next") ?? "/videos";
  const nextPath = requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/videos";

  useEffect(() => {
    if (!loading && session) setLocation(nextPath);
    if (!loading && !session) setLocation(`/login?next=${encodeURIComponent(nextPath)}`);
  }, [loading, session, nextPath, setLocation]);

  return <PageLoader />;
}