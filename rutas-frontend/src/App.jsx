import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { authService } from "./services/authService";
import ErrorBoundary  from "./components/ErrorBoundary";

import Login            from "./pages/Login";
import Signup           from "./pages/Signup";
import PublicDashboard  from "./pages/PublicDashboard";
import Dashboard        from "./pages/Dashboard";
import TripSetup        from "./pages/TripSetup";
import Recording        from "./pages/Recording";
import TripSummary      from "./pages/TripSummary";
import SavedTrips       from "./pages/SavedTrips";
import AnalyticsEngine  from "./pages/AnalyticsEngine";
import AdminDashboard   from "./pages/AdminDashboard";

// Must be logged in
function RequireAuth({ children }) {
  if (!authService.isLoggedIn()) return <Navigate to="/login" replace />;
  return children;
}

// Conductor only
function RequireConductor({ children }) {
  if (!authService.isLoggedIn())  return <Navigate to="/login" replace />;
  if (!authService.isConductor()) return <Navigate to="/login" replace />;
  return children;
}

// Admin only
function RequireAdmin({ children }) {
  if (!authService.isLoggedIn()) return <Navigate to="/login" replace />;
  if (!authService.isAdmin())    return <Navigate to="/login" replace />;
  return children;
}

// Sends each role to their home screen
function RootRedirect() {
  if (!authService.isLoggedIn()) return <Navigate to="/login" replace />;
  return <Navigate to={authService.getHomeRoute()} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
        {/* Public — no login required */}
        <Route path="/route/:routeId" element={<PublicDashboard />} />
        <Route path="/route"          element={<PublicDashboard />} />
        <Route path="/login"          element={<Login />} />
        <Route path="/signup"         element={<Signup />} />
        <Route path="/"               element={<RootRedirect />} />

        {/* Conductor */}
        <Route path="/dashboard"   element={<RequireConductor><Dashboard /></RequireConductor>} />
        <Route path="/trip-setup"  element={<RequireConductor><TripSetup /></RequireConductor>} />
        <Route path="/record"      element={<RequireConductor><Recording /></RequireConductor>} />
        <Route path="/summary"     element={<RequireConductor><TripSummary /></RequireConductor>} />
        <Route path="/saved-trips" element={<RequireConductor><SavedTrips /></RequireConductor>} />

        {/* Analytics — Admin AND Analyst both land here */}
        <Route path="/analytics" element={<RequireAuth><AnalyticsEngine /></RequireAuth>} />

        {/* Admin panel — Admin only, Analyst never sees this */}
        <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
    </ErrorBoundary>
  );
}
