import { LangToggle } from '@/components/LangToggle';
import { useI18n } from '@/contexts/I18nContext';
import {
  Calendar,
  Car,
  Fuel,
  Layers,
  Map,
  PartyPopper,
  Settings,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/drive', icon: Car, label: 'drive' },
  { path: '/today', icon: Calendar, label: 'today' },
  { path: '/planning', icon: Map, label: 'planning' },
  { path: '/events', icon: PartyPopper, label: 'events' },
  { path: '/zones', icon: Layers, label: 'zones' },
  { path: '/gas', icon: Fuel, label: 'gas' },
  { path: '/admin', icon: Settings, label: 'admin' },
] as const;

export function BottomNav() {
  const { t } = useI18n();
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center h-16 max-w-screen-sm mx-auto px-1 gap-0">
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 flex-1 min-w-0 py-2 text-[10px] font-body transition-colors ${
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="truncate w-full text-center">{t(label)}</span>
          </NavLink>
        ))}
        <div className="px-1 py-2 flex items-center justify-center flex-shrink-0">
          <LangToggle />
        </div>
      </div>
    </nav>
  );
}
