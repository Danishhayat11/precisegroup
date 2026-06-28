import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/lib/auth";

import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import Units from "@/pages/Units";
import Clients from "@/pages/Clients";
import Bookings from "@/pages/Bookings";
import BookingDetail from "@/pages/BookingDetail";
import Payments from "@/pages/Payments";
import Ledger from "@/pages/Ledger";
import Adjustments from "@/pages/Adjustments";
import Reports from "@/pages/Reports";
import Documents from "@/pages/Documents";
import DocumentCenter from "@/pages/DocumentCenter";
import DocumentView from "@/pages/DocumentView";
import ImportCenter from "@/pages/ImportCenter";
import AuditLog from "@/pages/AuditLog";
import LogicNotes from "@/pages/LogicNotes";
import Settings from "@/pages/Settings";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/units" element={<Units />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/bookings" element={<Bookings />} />
              <Route path="/bookings/:id" element={<BookingDetail />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/adjustments" element={<Adjustments />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/document-center" element={<DocumentCenter />} />
              <Route path="/documents/:type" element={<DocumentView />} />
              <Route path="/import" element={<ImportCenter />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/logic" element={<LogicNotes />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
