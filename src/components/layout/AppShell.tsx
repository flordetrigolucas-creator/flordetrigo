import { NavLink, Outlet, useNavigate } from 'react-router-dom';
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
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: readonly UserRole[];
  externalFullScreen?: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/dashboard',
    label: 'DRE & Curva ABC',
    sublabel: 'Painel Executivo & FEFO',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    to: '/fichas-tecnicas',
    label: 'Engenharia de Cardápio',
    sublabel: "Baker's % & Ficha Técnica",
    icon: FileSpreadsheet,
    roles: ['ADMIN', 'GERENTE', 'PADEIRO'],
  },
  {
    to: '/pcp',
    label: 'Tela do Padeiro (PCP)',
    sublabel: 'KDS & Calculadora Masseira',
    icon: ChefHat,
    roles: ['ADMIN', 'GERENTE', 'PADEIRO', 'ATENDENTE'],
  },
  {
    to: '/perdas',
    label: 'Perdas & OP Reversa',
    sublabel: 'Sobras → Farinha de Rosca',
    icon: Recycle,
    roles: ['ADMIN', 'GERENTE', 'PADEIRO', 'CAIXA', 'ATENDENTE'],
  },
  {
    to: '/nfe',
    label: 'Entrada de NF-e (XML)',
    sublabel: 'Parser XML & De/Para Unidades',
    icon: FileCode2,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    to: '/crm',
    label: 'CRM B2B & Inbox IA',
    sublabel: 'WhatsApp Realtime & Crédito',
    icon: MessageSquareMore,
    roles: ['ADMIN', 'GERENTE', 'ATENDENTE'],
  },
  {
    to: '/pos',
    label: 'Frente de Caixa (PDV)',
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
  const isOnline = useOnlineStatus();

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

  const handleRoleChange = (role: UserRole) => {
    switchRoleForDemo(role);
    const currentItem = NAV_ITEMS.find((i) => window.location.pathname.startsWith(i.to));
    if (currentItem && !canAccess(role, currentItem.roles)) {
      navigate(defaultRouteForRole(role));
    }
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar Backoffice / ERP */}
      <aside className="flex w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground shadow">
            FT
          </div>
          <div>
            <p className="text-base font-bold tracking-tight text-white">Flor do Trigo</p>
            <p className="text-xs text-stone-400">ERP Industrial • PCP • PDV • IA</p>
          </div>
        </div>

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
            className="w-full rounded-md border border-white/15 bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
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
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.filter((item) => canAccess(profile?.role, item.roles)).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
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
      </aside>

      {/* Área Principal */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

