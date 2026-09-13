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

export default function SignupPage() {
  const [formData, setFormData] = useState({ name: "", email: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailExists, setEmailExists] = useState(false);
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [searchParams] = useSearchParams();
  const pendingQuery = searchParams.get("q") || "";

  const postAuthPath = pendingQuery ? `/new?q=${encodeURIComponent(pendingQuery)}` : "/trips";
  const loginLink = pendingQuery ? `/login?q=${encodeURIComponent(pendingQuery)}` : "/login";

  useEffect(() => {
    const token = localStorage.getItem("tripwhat_token");
    if (token) navigate(postAuthPath, { replace: true });
  }, [navigate, postAuthPath]);

  useEffect(() => {
    if (searchParams.get("error") === "google_signin_failed") {
      setError("Google sign-in failed. Please try again.");
    }
  }, [searchParams]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
    if (emailExists) setEmailExists(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setEmailExists(false);
    try {
      if (!formData.name || !formData.email || !formData.password) throw new Error("All fields are required");
      if (formData.password.length < 6) throw new Error("Password must be at least 6 characters long");
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) throw new Error("Please enter a valid email address");
      await signup(formData.email, formData.password, { name: formData.name });
      navigate(postAuthPath, { replace: true });
    } catch (err) {
      const msg = err.message || "Signup failed";
      setError(msg);
      if (msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("already registered")) {
        setEmailExists(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = () => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const redirect = encodeURIComponent(postAuthPath);
    window.location.href = `${API_URL}/api/auth/google?redirect=${redirect}`;
  };

  return (
    <div className="auth-page">
      <div className="auth-split">
        <div className="auth-form-side">
          <div className="auth-form">
            <div className="auth-logo">
              <Compass size={32} strokeWidth={1.4} aria-hidden="true" />
            </div>
            <h1 className="auth-heading">Get started with TripWhat</h1>
            <p className="auth-subtitle">Create an account to save trips, sync your plans, and personalize how you travel.</p>

            <button className="auth-google-btn" type="button" onClick={handleGoogle} disabled={isLoading}>
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="auth-divider">or</div>

            {error && (
              <div className="auth-error" style={{ marginTop: 18 }}>
                {emailExists ? (
                  <>
                    This email is already registered.{" "}
                    <Link to={loginLink}>Sign in instead?</Link>
                  </>
                ) : error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-field-group">
              <div>
                <label htmlFor="name" className="auth-field-label">Name</label>
                <input
                  id="name" name="name" type="text" placeholder="Your full name"
                  value={formData.name} onChange={handleChange} required disabled={isLoading}
                  className="auth-input" style={{ marginTop: 6 }}
                />
              </div>
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
                  id="password" name="password" type="password" placeholder="Create a password"
                  value={formData.password} onChange={handleChange} required disabled={isLoading} minLength={6}
                  className="auth-input" style={{ marginTop: 6 }}
                />
              </div>
              <button type="submit" className="auth-continue-btn" disabled={isLoading}>
                {isLoading ? "Creating account..." : "Create account"} <ArrowRight size={17} aria-hidden="true" />
              </button>
            </form>

            <p className="auth-switch">
              Already have an account? <Link to={loginLink}>Log in</Link>
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
