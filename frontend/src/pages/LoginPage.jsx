import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Compass, ArrowRight } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { AuthImagePanel } from "../components/landing/AuthImagePanel";
import "./AuthPage.css";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default function LoginPage() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { login, isAuthenticated, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const pendingQuery = searchParams.get("q") || "";

  const postAuthPath = pendingQuery ? `/new?q=${encodeURIComponent(pendingQuery)}` : "/trips";
  const signupLink = pendingQuery ? `/signup?q=${encodeURIComponent(pendingQuery)}` : "/signup";

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate(postAuthPath, { replace: true });
    }
  }, [navigate, isAuthenticated, loading, postAuthPath]);

  useEffect(() => {
    if (searchParams.get("error") === "google_signin_failed") {
      setError("Google sign-in failed. Please try again.");
    }
  }, [searchParams]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      if (!formData.email || !formData.password) throw new Error("All fields are required");
      const user = await login(formData.email, formData.password);
      if (user) navigate(postAuthPath, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = () => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const redirect = encodeURIComponent(postAuthPath);
    window.location.href = `${API_URL}/api/auth/google?redirect=${redirect}`;
  };

  if (loading) {
    return (
      <div className="auth-page" style={{ alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--auth-muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        <div className="auth-form-side">
          <div className="auth-form">
            <div className="auth-logo">
              <Compass size={32} strokeWidth={1.4} aria-hidden="true" />
            </div>
            <h1 className="auth-heading">Welcome back to TripWhat</h1>
            <p className="auth-subtitle">Log in to pick up where you left off and keep planning your next trip.</p>

            <button className="auth-google-btn" type="button" onClick={handleGoogle} disabled={isLoading}>
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="auth-divider">or</div>

            {error && (
              <div className="auth-error" style={{ marginTop: 18 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-field-group">
              <div>
                <label htmlFor="email" className="auth-field-label">Email</label>
                <input
                  id="email" name="email" type="email" placeholder="you@example.com"
                  value={formData.email} onChange={handleChange} required disabled={isLoading}
                  className="auth-input" style={{ marginTop: 6 }}
                />
              </div>
              <div>
                <label htmlFor="password" className="auth-field-label">Password</label>
                <input
                  id="password" name="password" type="password" placeholder="Enter your password"
                  value={formData.password} onChange={handleChange} required disabled={isLoading}
                  className="auth-input" style={{ marginTop: 6 }}
                />
              </div>
              <button type="submit" className="auth-continue-btn" disabled={isLoading}>
                {isLoading ? "Logging in..." : "Log in"} <ArrowRight size={17} aria-hidden="true" />
              </button>
            </form>

            <p className="auth-switch">
              Don't have an account? <Link to={signupLink}>Sign up</Link>
            </p>
            <p className="auth-terms">
              By continuing, you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>
            </p>
          </div>
        </div>
        <div className="auth-image-side">
          <AuthImagePanel />
        </div>
      </div>
    </div>
  );
}
