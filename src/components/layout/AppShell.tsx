import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ChefHat,
  FileSpreadsheet,
  Recycle,
  FileCode2,
  MessageSquareMore,
  ShoppingCart,
  ShieldCheck,
  Wifi,
  WifiOff,
  Menu,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { cn } from '@/lib/utils';
import { canAccess, defaultRouteForRole, useAuthStore } from '@/stores/authStore';
import type { UserRole } from '@/types/database.types';
import { Badge } from '@/components/ui/badge';
import { localDb } from '@/lib/offlineDb';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

interface NavItem {
  to: string;
  label: string;
  shortLabel: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: readonly UserRole[];
  externalFullScreen?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/dashboard',
    label: 'DRE & Curva ABC',
    shortLabel: 'DRE',
    sublabel: 'Painel Executivo & FEFO',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    to: '/fichas-tecnicas',
    label: 'Engenharia de Cardápio',
    shortLabel: 'Fichas',
    sublabel: "Baker's % & Ficha Técnica",
    icon: FileSpreadsheet,
    roles: ['ADMIN', 'GERENTE', 'PADEIRO'],
  },
  {
    to: '/pcp',
    label: 'Tela do Padeiro (PCP)',
    shortLabel: 'Padeiro',
    sublabel: 'KDS & Calculadora Masseira',
    icon: ChefHat,
    roles: ['ADMIN', 'GERENTE', 'PADEIRO', 'ATENDENTE'],
  },
  {
    to: '/perdas',
    label: 'Perdas & OP Reversa',
    shortLabel: 'Perdas',
    sublabel: 'Sobras → Farinha de Rosca',
    icon: Recycle,
    roles: ['ADMIN', 'GERENTE', 'PADEIRO', 'CAIXA', 'ATENDENTE'],
  },
  {
    to: '/nfe',
    label: 'Entrada de NF-e (XML)',
    shortLabel: 'NF-e',
    sublabel: 'Parser XML & De/Para Unidades',
    icon: FileCode2,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    to: '/crm',
    label: 'CRM B2B & Inbox IA',
    shortLabel: 'CRM IA',
    sublabel: 'WhatsApp Realtime & Crédito',
    icon: MessageSquareMore,
    roles: ['ADMIN', 'GERENTE', 'ATENDENTE'],
  },
  {
    to: '/pos',
    label: 'Frente de Caixa (PDV)',
    shortLabel: 'PDV',
    sublabel: 'Tela Cheia • Balança Serial',
    icon: ShoppingCart,
    roles: ['ADMIN', 'GERENTE', 'CAIXA', 'ATENDENTE'],
    externalFullScreen: true,
  },
];

const ALL_ROLES: readonly UserRole[] = ['ADMIN', 'GERENTE', 'PADEIRO', 'CAIXA', 'ATENDENTE'];

export function AppShell() {
  const profile = useAuthStore((s) => s.profile);
  const switchRoleForDemo = useAuthStore((s) => s.switchRoleForDemo);
  const navigate = useNavigate();
  const location = useLocation();
  const isOnline = useOnlineStatus();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Fecha o drawer mobile automaticamente ao trocar de rota
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const openAlertsCount = useLiveQuery(
    () => localDb.productionAlerts.filter((a) => !a.acknowledged_at).count(),
    [],
    0,
  );

  const pendingSalesCount = useLiveQuery(
    () => localDb.pendingSales.where('synced').equals(0).count(),
    [],
    0,
  );

  const visibleNavItems = NAV_ITEMS.filter((item) => canAccess(profile?.role, item.roles));

  const handleRoleChange = (role: UserRole) => {
    switchRoleForDemo(role);
    const currentItem = NAV_ITEMS.find((i) => location.pathname.startsWith(i.to));
    if (currentItem && !canAccess(role, currentItem.roles)) {
      navigate(defaultRouteForRole(role));
    }
  };

  const renderSidebarContent = () => (
    <>
      {/* Seletor Rápido RBAC para Homologação de Perfis */}
      <div className="border-b border-white/10 bg-black/20 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-stone-400">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-400" /> Perfil Ativo (RBAC)
          </span>
          <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-300">
            {profile?.role}
          </Badge>
        </div>
        <select
          aria-label="Selecionar perfil de acesso RBAC"
          value={profile?.role ?? 'ADMIN'}
          onChange={(e) => handleRoleChange(e.target.value as UserRole)}
          className="w-full rounded-md border border-white/15 bg-stone-900 px-2.5 py-2 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              Simular Perfil: {r}
            </option>
          ))}
        </select>
        <p className="mt-1 truncate text-[11px] text-stone-400">{profile?.full_name}</p>
      </div>

      {/* Navegação Filtrada por RBAC */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold shadow-sm'
                    : 'text-stone-300 hover:bg-sidebar-accent hover:text-white',
                )
              }
            >
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 shrink-0" />
                <div>
                  <div className="leading-tight">{item.label}</div>
                  <div className="text-[11px] opacity-75">{item.sublabel}</div>
                </div>
              </div>
              {item.to === '/pcp' && openAlertsCount > 0 && (
                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-stone-950">
                  {openAlertsCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Status Offline/Contingência */}
      <div className="border-t border-white/10 p-4 text-xs text-stone-400">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-stone-200">
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-400" /> Online • IndexedDB Sync
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-400" /> Contingência Offline
              </>
            )}
          </span>
          {pendingSalesCount > 0 && (
            <Badge variant="warning" className="text-[10px]">
              {pendingSalesCount} fila PDV
            </Badge>
          )}
        </div>
        <p className="mt-1 text-[11px] text-stone-500">
          Unidades base: g • ml • un | Zero Float (Decimal.js)
        </p>
      </div>
    </>
  );

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-background text-foreground lg:flex-row">
      {/* Topbar Mobile / Tablet (Android & iOS) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-sidebar px-3.5 py-2.5 text-sidebar-foreground shadow-sm lg:hidden pt-safe">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu de navegação"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-stone-900 text-white active:scale-95"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow">
              FT
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-white">Flor do Trigo</p>
              <p className="mt-0.5 text-[10px] text-stone-400">
                {isOnline ? 'Online • Supabase' : 'Offline • Contingência'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Selecionar perfil RBAC"
            value={profile?.role ?? 'ADMIN'}
            onChange={(e) => handleRoleChange(e.target.value as UserRole)}
            className="h-9 rounded-lg border border-amber-500/40 bg-stone-900 px-2 text-xs font-semibold text-amber-300"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Drawer Lateral Mobile (Android / iOS) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-80 max-w-[85vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow">
                  FT
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Flor do Trigo</p>
                  <p className="text-[11px] text-stone-400">ERP • PCP • PDV • IA</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fechar menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-stone-900 text-stone-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Sidebar Desktop Backoffice / ERP */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow">
            FT
          </div>
          <div>
            <p className="text-base font-bold tracking-tight text-white">Flor do Trigo</p>
            <p className="text-xs text-stone-400">ERP Industrial • PCP • PDV • IA</p>
          </div>
        </div>
        {renderSidebarContent()}
      </aside>

      {/* Área Principal */}
      <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 lg:pb-0">
        <Outlet />
      </main>

      {/* Barra de Navegação Inferior Nativa (Android & iOS) */}
      <nav
        aria-label="Navegação rápida mobile"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-white/15 bg-sidebar/95 px-1 pt-1.5 text-sidebar-foreground backdrop-blur-md lg:hidden pb-safe"
      >
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors',
                  isActive ? 'text-amber-400 font-bold' : 'text-stone-400 hover:text-white',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate px-0.5">{item.shortLabel}</span>
              {item.to === '/pcp' && openAlertsCount > 0 && (
                <span className="absolute top-0.5 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-extrabold text-stone-950">
                  {openAlertsCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
