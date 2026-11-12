import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./session";
import { AppShell, TripLayout } from "./components/Layout";
import { YourTripsPage } from "./pages/YourTripsPage";
import { NewTripPage, TripSetupPage } from "./pages/TripSetupPage";
import { PreferencesPage } from "./pages/PreferencesPage";
import { GroupPlanPage } from "./pages/GroupPlanPage";
import { ComingSoonPage, JoinPage, TripOverviewPage } from "./pages/TripPages";
import { ItineraryRoute } from "./pages/ItineraryPage";
import "./styles.css";
import "./design.css";

/**
 * Workflow 1 (Design A: Group Trip Planning) route map:
 *   1  /                               Your trips
 *   2  /trips/new, /trips/:id/setup/*  Create trip -> Invite members -> Review
 *   3  /trips/:id/preferences          My travel preferences
 *   4–6 /trips/:id/plan                Ready to generate -> Review and vote -> Majority approved
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<YourTripsPage />} />
            <Route path="trips/new" element={<NewTripPage />} />
            <Route path="trips/:tripId/setup/:step" element={<TripSetupPage />} />
            <Route path="join/:code" element={<JoinPage />} />
            <Route path="trips/:tripId" element={<TripLayout />}>
              <Route index element={<TripOverviewPage />} />
              <Route path="preferences" element={<PreferencesPage />} />
              <Route path="plan" element={<GroupPlanPage />} />
              <Route path="flights" element={<ComingSoonPage title="Flights" system="SYS-03" />} />
              <Route path="stays" element={<ComingSoonPage title="Stays" system="SYS-03" />} />
              <Route path="itinerary" element={<ItineraryRoute />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
