import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import TripSetup from "./pages/TripSetup";
import Recording from "./pages/Recording";
import TripSummary from "./pages/TripSummary";
import SavedTrips from "./pages/SavedTrips";

function App() {
  return (
    <Router>
      <Routes>

        {/* Dashboard is default landing */}
        <Route path="/" element={<Dashboard />} />

        {/* Trip Setup */}
        <Route path="/trip-setup" element={<TripSetup />} />

        {/* Recording (no route guard here) */}
        <Route path="/record" element={<Recording />} />

        {/* Trip Summary */}
        <Route path="/summary" element={<TripSummary />} />

        {/* Saved Trips */}
        <Route path="/saved-trips" element={<SavedTrips />} />

        {/* Catch All */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </Router>
  );
}

export default App;
