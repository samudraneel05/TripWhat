import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * Handles the redirect back from Google OAuth.
 * The backend redirects here with #token=...&redirect=... (a URL fragment, so
 * the token never reaches server logs). ?token= is still read for one release.
 * We store the token and let AuthContext pick it up, then navigate.
 */
export default function GoogleAuthSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const params = hashParams.get("token") ? hashParams : searchParams;
    const token = params.get("token");
    const redirect = params.get("redirect") || "/trips";
    if (token) {
      localStorage.setItem("tripwhat_token", token);
    }
    window.history.replaceState(null, "", window.location.pathname);
    // Navigate to the redirect path; AuthProvider will fetch the user
    navigate(redirect.startsWith("/") ? redirect : `/${redirect}`, { replace: true });
  }, [navigate, searchParams]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#78716C" }}>Finishing sign-in…</p>
    </div>
  );
}
