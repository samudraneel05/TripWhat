import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";

/**
 * Handles the redirect back from Google OAuth.
 * The backend redirects here with #token=...&redirect=... (a URL fragment, so
 * the token never reaches server logs). ?token= is still read for one release.
 * We authenticate via the context — ProtectedRoute needs `user` set before we
 * navigate, otherwise it bounces us to /login.
 */
export default function GoogleAuthSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const params = hashParams.get("token") ? hashParams : searchParams;
    const token = params.get("token");
    const redirect = params.get("redirect") || "/trips";
    const target = redirect.startsWith("/") ? redirect : `/${redirect}`;
    window.history.replaceState(null, "", window.location.pathname);

    (async () => {
      if (token) {
        await loginWithToken(token);
      }
      navigate(target, { replace: true });
    })();
  }, [navigate, searchParams, loginWithToken]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#78716C" }}>Finishing sign-in…</p>
    </div>
  );
}
