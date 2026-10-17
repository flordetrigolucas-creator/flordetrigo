import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ensureInitialLocalCatalog } from '@/lib/offlineDb';
import { subscribeSupabaseRealtime } from '@/lib/supabaseSync';
import { useAuthStore } from '@/stores/authStore';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { ExecutiveDashboardPage } from '@/features/dashboard/ExecutiveDashboardPage';
import { TechnicalSheetsPage } from '@/features/pcp/TechnicalSheetsPage';
import { BakerKdsPage } from '@/features/pcp/BakerKdsPage';
import { WasteManagementPage } from '@/features/waste/WasteManagementPage';
import { NfeImporterPage } from '@/features/nfe/NfeImporterPage';
import { CrmInboxPage } from '@/features/crm/CrmInboxPage';
import { PosPage } from '@/features/pos/PosPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App() {
  const initializeAuth = useAuthStore((s) => s.initialize);

  useEffect(() => {
    void ensureInitialLocalCatalog().then(() => initializeAuth());
    const unsubscribe = subscribeSupabaseRealtime();
    return unsubscribe;
  }, [initializeAuth]);

  const routerBasename =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/flordetrigo')
      ? '/flordetrigo'
      : '/';

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={routerBasename}>
        <Routes>
          {/* Rota dedicada em tela cheia para Frente de Caixa (/pos) sem menus laterais */}
          <Route
            element={<ProtectedRoute allowedRoles={['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE']} />}
          >
            <Route path="/pos" element={<PosPage />} />
          </Route>

          {/* Shell Backoffice / PCP / CRM protegido por RBAC */}
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />

            <Route element={<ProtectedRoute allowedRoles={['ADMIN', 'GERENTE']} />}>
              <Route path="/dashboard" element={<ExecutiveDashboardPage />} />
              <Route path="/nfe" element={<NfeImporterPage />} />
            </Route>

            <Route
              element={<ProtectedRoute allowedRoles={['ADMIN', 'GERENTE', 'PADEIRO']} />}
            >
              <Route path="/fichas-tecnicas" element={<TechnicalSheetsPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'GERENTE', 'PADEIRO', 'ATENDENTE']} />
              }
            >
              <Route path="/pcp" element={<BakerKdsPage />} />
            </Route>

            <Route
              element={
                <ProtectedRoute
                  allowedRoles={['ADMIN', 'GERENTE', 'PADEIRO', 'CAIXA', 'ATENDENTE']}
                />
              }
            >
              <Route path="/perdas" element={<WasteManagementPage />} />
            </Route>

            <Route
              element={<ProtectedRoute allowedRoles={['ADMIN', 'GERENTE', 'ATENDENTE']} />}
            >
              <Route path="/crm" element={<CrmInboxPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

