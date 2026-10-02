import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext.jsx";

import AppLayout from "./components/AppLayout.tsx";
import LandingPage from "./pages/LandingPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";

// App pages are lazy-loaded — the workspace pulls in mapbox + the whole
// itinerary UI, which shouldn't ship in the landing bundle.
const TripsPage = lazy(() => import("./pages/TripsPage.tsx"));
const ChatsPage = lazy(() => import("./pages/ChatsPage.tsx"));
const TripWorkspacePage = lazy(() => import("./pages/TripWorkspacePage.tsx"));
const NewTripPage = lazy(() => import("./pages/NewTripPage.tsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const GoogleAuthSuccess = lazy(() => import("./pages/GoogleAuthSuccess.jsx"));

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-[var(--muted)]">
      <div className="animate-pulse text-sm">Loading…</div>
    </div>
  );
}

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

// Keyed wrappers: /new, /chat/:id, and /trip/:id each need a fresh component
// instance per conversation/trip — without keys React Router reuses the same
// instance and stale chat/trip state bleeds across conversations.
function KeyedNewTripPage() {
  const { conversationId } = useParams();
  return <NewTripPage key={conversationId ?? "new"} />;
}

function KeyedTripWorkspacePage() {
  const { id } = useParams();
  return <TripWorkspacePage key={id} />;
}

function AppContent() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen text-[var(--ink)]">
      <Suspense fallback={<PageFallback />}>
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
          path="/chats"
          element={
            <ProtectedRoute>
              <AppLayout>
                <ChatsPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/trip/:id"
          element={
            <ProtectedRoute>
              <AppLayout>
                <KeyedTripWorkspacePage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/new"
          element={
            <ProtectedRoute>
              <AppLayout>
                <KeyedNewTripPage />
              </AppLayout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/chat/:conversationId"
          element={
            <ProtectedRoute>
              <AppLayout>
                <KeyedNewTripPage />
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
      </Suspense>
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
