import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import TripSetup from "./pages/TripSetup";
import Recording from "./pages/Recording";
import TripSummary from "./pages/TripSummary";
import SavedTrips from "./pages/SavedTrips";
import AnalyticsEngine from "./pages/AnalyticsEngine";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/"             element={<Dashboard />} />
        <Route path="/trip-setup"   element={<TripSetup />} />
        <Route path="/record"       element={<Recording />} />
        <Route path="/summary"      element={<TripSummary />} />
        <Route path="/saved-trips"  element={<SavedTrips />} />
        <Route path="/analytics"    element={<AnalyticsEngine />} />
        <Route path="*"             element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
