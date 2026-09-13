import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";

import AppLayout from "./components/AppLayout.tsx";
import LandingPage from "./pages/LandingPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import TripsPage from "./pages/TripsPage.tsx";
import TripWorkspacePage from "./pages/TripWorkspacePage.tsx";
import NewTripPage from "./pages/NewTripPage.tsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import GoogleAuthSuccess from "./pages/GoogleAuthSuccess.jsx";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--muted)]">
        <div className="animate-pulse text-lg">Loading...</div>
      </div>
    );
  }
  if (!user) {
    // Preserve the query string so login/signup can redirect back with it
    const redirect = `/login${location.search || ""}`;
    return <Navigate to={redirect} />;
  }
  return <>{children}</>;
}

function AppContent() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen text-[var(--ink)]">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />

        <Route
          path="/trips"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TripsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/trip/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <TripWorkspacePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <NewTripPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/chat/:conversationId"
          element={
            <ProtectedRoute>
              <AppLayout>
                <NewTripPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ProfilePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            user ? <Navigate to="/trips" replace /> : <Navigate to="/" replace />
          }
        />
      </Routes>
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
