import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { auth } from "./lib/api";
import { ToastProvider } from "./components/Toasts";
import { Shell } from "./components/Shell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PcsPage } from "./pages/PcsPage";
import { PcDetailPage } from "./pages/PcDetailPage";
import { GamesPage } from "./pages/GamesPage";
import { MenuPage } from "./pages/MenuPage";
import { OrdersPage } from "./pages/OrdersPage";
import { CustomersPage } from "./pages/CustomersPage";
import { AuditPage } from "./pages/AuditPage";
import { ConflictsPage } from "./pages/ConflictsPage";
import { KitchenPage } from "./pages/KitchenPage";

function RequireAuth({ children }: { children: ReactElement }) {
  if (!auth.token()) return <Navigate to="/login" replace />;
  return children;
}

/** Route-level RBAC: hide internal screens from kitchen accounts. */
const STAFF_ROLES = ["owner", "manager", "staff"];

function RequireRole({ roles, children }: { roles: string[]; children: ReactElement }) {
  const user = auth.user();
  if (!user || !roles.includes(user.role)) return <Navigate to="/kitchen" replace />;
  return children;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/kitchen"
          element={
            <RequireAuth>
              <KitchenPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <RequireRole roles={STAFF_ROLES}>
                <Shell />
              </RequireRole>
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="pcs" element={<PcsPage />} />
          <Route path="pcs/:id" element={<PcDetailPage />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="conflicts" element={<ConflictsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
