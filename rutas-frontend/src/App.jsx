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
import AdminShell       from "./pages/admin/AdminShell";
import AdminOverview    from "./pages/admin/AdminOverview";
import AdminMap         from "./pages/admin/AdminMap";
import AdminTrips       from "./pages/admin/AdminTrips";
import AdminCorridors   from "./pages/admin/AdminCorridors";
import AdminZoneMgmt    from "./pages/admin/AdminZoneMgmt";
import AdminStopZones   from "./pages/admin/AdminStopZones";
import AdminExport      from "./pages/admin/AdminExport";
import AdminResearch    from "./pages/admin/AdminResearch";
import AdminPipeline    from "./pages/admin/AdminPipeline";
import AdminSensitivity from "./pages/admin/AdminSensitivity";
import AdminEvaluate    from "./pages/admin/AdminEvaluate";
import AdminOverlap     from "./pages/admin/AdminOverlap";
import AdminConductors  from "./pages/admin/AdminConductors";

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

        {/* Admin area — ADMIN only, Analyst never sees this.

            AdminShell is mounted by a pathless layout route so that both
            /admin/* and /analytics render inside it. The manuscript (section
            3.3.2) lists Analytics Engine as one of the administrative
            dashboard's sections, but it used to be a standalone page outside
            the shell: reaching it from the sidebar dropped the sidebar, and
            the only way back was a bespoke "← Admin Panel" button. Keeping
            its /analytics URL avoids breaking existing links and the
            ?trip= / ?tab= deep links.

            The backend scopes every /analytics/* and /api/clusters/* route to
            ADMIN, so a conductor reaching this page would only see failed
            requests. The guard matches; an earlier comment claiming an
            "Analyst" also lands here was stale — ANALYST cannot authenticate
            and is authorized nowhere.

            Phase UI-1 renamed the corridor analytics route from /corridors to
            /demand so the path matches the sidebar label "Demand and Load
            Factor". /corridors is kept as a redirect: it is the path the
            earlier build used and may be bookmarked or referenced elsewhere.
            Every other pre-existing path is unchanged. */}
        <Route element={<RequireAdmin><AdminShell /></RequireAdmin>}>
          <Route path="/analytics" element={<AnalyticsEngine />} />

          <Route path="/admin">
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview"   element={<AdminOverview />} />
            <Route path="map"        element={<AdminMap />} />
            <Route path="trips"      element={<AdminTrips />} />
            <Route path="demand"     element={<AdminCorridors />} />
            <Route path="corridors"  element={<Navigate to="/admin/demand" replace />} />
            <Route path="export"     element={<AdminExport />} />
            <Route path="zones"      element={<AdminZoneMgmt />} />
            <Route path="stop-zones"   element={<AdminStopZones />} />
            <Route path="research"     element={<AdminResearch />} />
            <Route path="pipeline"     element={<AdminPipeline />} />
            <Route path="sensitivity"  element={<AdminSensitivity />} />
            <Route path="evaluate"     element={<AdminEvaluate />} />
            <Route path="overlap"      element={<AdminOverlap />} />
            <Route path="conductors"   element={<AdminConductors />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
    </ErrorBoundary>
  );
}
