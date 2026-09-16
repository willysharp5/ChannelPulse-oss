import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import {
  Dashboard,
  App,
  SystemPrompts,
  ViewChat,
  Settings,
  Shortcuts,
  Audio,
  Screenshot,
  Chats,
  Responses,
  Memory,
  Profile,
  InterviewPractice,
  ReportBug,
  Login,
} from "@/pages";
import { DashboardLayout } from "@/layouts";

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        {/* Outside DashboardLayout on purpose — it is where the layout sends an
            unauthenticated visitor, so it cannot sit behind the same gate. Kept
            here as well as in src/routes/web.tsx so the redirect resolves on
            desktop instead of landing on an empty route. */}
        <Route path="/login" element={<Login />} />
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/personas" element={<SystemPrompts />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/interview-practice" element={<InterviewPractice />} />
          {/* No /tutorials route here. The guided curriculum belongs to the
              hosted app and is not part of this edition — the pages, the
              bundled course content and their auth guard were all removed
              rather than shipped as dead weight behind a gate. */}
          <Route path="/chats/view/:conversationId" element={<ViewChat />} />
          <Route path="/shortcuts" element={<Shortcuts />} />
          <Route path="/screenshot" element={<Screenshot />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/report-bug" element={<ReportBug />} />
          <Route path="/audio" element={<Audio />} />
          <Route path="/responses" element={<Responses />} />
        </Route>
      </Routes>
    </Router>
  );
}
