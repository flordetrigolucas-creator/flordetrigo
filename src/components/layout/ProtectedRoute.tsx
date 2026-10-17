import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { UserRole } from '@/types/database.types';
import { canAccess, defaultRouteForRole, useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  allowedRoles: readonly UserRole[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const profile = useAuthStore((s) => s.profile);
  const location = useLocation();

  if (!profile) {
    return <Navigate to="/pos" state={{ from: location }} replace />;
  }

  if (!canAccess(profile.role, allowedRoles)) {
    return <Navigate to={defaultRouteForRole(profile.role)} replace />;
  }

  return <Outlet />;
}

