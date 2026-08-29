import { AutoShiftMonitor } from '@/components/AutoShiftMonitor';
import { BottomNav } from '@/components/BottomNav';
import { NearestHotspot } from '@/components/NearestHotspot';
import { PwaInstallBanner } from '@/components/PwaInstallBanner';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/contexts/I18nContext';
import { useAnonAuth } from '@/hooks/useAnonAuth';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ThemeProvider } from 'next-themes';
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

const DriveScreen = lazy(() => import('@/pages/DriveScreen'));
const TodayScreen = lazy(() => import('@/pages/TodayScreen'));
const PlanningScreen = lazy(() => import('@/pages/PlanningScreen'));
const ZonesScreen = lazy(() => import('@/pages/ZonesScreen'));
const EventsScreen = lazy(() => import('@/pages/EventsScreen'));
const AdminScreen = lazy(() => import('@/pages/AdminScreen'));
const AdminOperationsScreen = lazy(
  () => import('@/pages/AdminOperationsScreen')
);
const AdminReportsScreen = lazy(() => import('@/pages/AdminReportsScreen'));
const AdminLearningScreen = lazy(() => import('@/pages/AdminLearningScreen'));
const AdminImportsScreen = lazy(() => import('@/pages/AdminImportsScreen'));
const AdminToolsScreen = lazy(() => import('@/pages/AdminToolsScreen'));
const AdminZoneDiscoveriesScreen = lazy(
  () => import('@/pages/AdminZoneDiscoveriesScreen')
);
const AdminDriverOpsScreen = lazy(
  () => import('@/pages/AdminDriverOpsScreen')
);
const GasScreen = lazy(() => import('@/pages/GasScreen'));
const NavigateScreen = lazy(() => import('@/pages/NavigateScreen'));
const NotFound = lazy(() => import('./pages/NotFound.tsx'));

const queryClient = new QueryClient();

// A visible branded loader — used for the auth handshake and lazy-route
// Suspense. Previously both rendered an empty near-black div, so any slow (or
// hung) launch was indistinguishable from a crash / black screen.
function AppLoading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-foreground pt-[env(safe-area-inset-top)]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// When a new service worker is ready (registerType: 'prompt'), main.tsx fires
// this event with the updateSW callback instead of silently reloading the page
// mid-boot — which was flashing/parking a black screen right after a deploy.
function SwUpdatePrompt() {
  useEffect(() => {
    function onNeedRefresh(e: Event) {
      const detail = (e as CustomEvent<{ update: () => void }>).detail;
      toast('Nouvelle version disponible', {
        description: 'Recharge pour mettre à jour Delivroom.',
        duration: Infinity,
        action: {
          label: 'Recharger',
          onClick: () => detail?.update?.(),
        },
      });
    }
    window.addEventListener('delivroom:sw-need-refresh', onNeedRefresh);
    return () =>
      window.removeEventListener('delivroom:sw-need-refresh', onNeedRefresh);
  }, []);
  return null;
}

// Trips (quick-log via MacroDroid, another device, the admin panel...) can
// land in Supabase while the PWA is backgrounded. staleTime alone won't
// pick that up until 5 minutes pass, so "Aujourd'hui"/the Drive HUD can
// read stale earnings right after the driver switches back. Force a
// refetch on every foreground instead of waiting out the cache window.
function TripsResumeSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        queryClient.invalidateQueries({ queryKey: ['trips-feed'] });
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [queryClient]);
  return null;
}

// Scoped fallback for Sentry.ErrorBoundary around individual routes — lets
// the driver retry just that page (resetError) instead of losing the whole
// app to AppErrorBoundary's full reload. Reused per-route rather than one
// component per screen since the recovery UX is identical everywhere.
function RouteErrorFallback({ resetError }: { resetError: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-sm text-center space-y-3">
        <h2 className="text-lg font-display font-bold">
          Cette page a rencontré un problème
        </h2>
        <p className="text-sm text-muted-foreground">
          Réessaie, ou change d&apos;onglet si ça persiste.
        </p>
        <button
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={resetError}
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class AppErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 pt-[env(safe-area-inset-top)]">
          <div className="max-w-sm text-center space-y-3">
            <h1 className="text-xl font-display font-bold">
              Un problème est survenu
            </h1>
            <p className="text-sm text-muted-foreground">
              L&apos;application a rencontré une erreur inattendue. Relance la
              page pour continuer ton shift.
            </p>
            <button
              className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const location = useLocation();
  const { status: authStatus, error: authError } = useAnonAuth();
  // Hide NearestHotspot on Today screen since hero card already shows best zone + distance
  const showNearestHotspot =
    location.pathname !== '/today' &&
    location.pathname !== '/' &&
    location.pathname !== '/events' &&
    location.pathname !== '/gas' &&
    !location.pathname.startsWith('/admin');

  if (authStatus === 'loading') {
    return <AppLoading label="Connexion…" />;
  }

  if (authStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4 pt-[env(safe-area-inset-top)]">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-xl font-display font-bold">
            Connexion impossible
          </h1>
          <p className="text-sm text-muted-foreground">
            {authError ?? 'Auth anonyme indisponible.'}
          </p>
          <button
            className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pt-[env(safe-area-inset-top)]">
      <Suspense fallback={<AppLoading />}>
        <Routes>
          <Route path="/" element={<DriveScreen />} />
          <Route
            path="/today"
            element={
              <Sentry.ErrorBoundary
                fallback={({ resetError }) => (
                  <RouteErrorFallback resetError={resetError} />
                )}
                beforeCapture={(scope) => scope.setTag('route', '/today')}
              >
                <TodayScreen />
              </Sentry.ErrorBoundary>
            }
          />
          <Route path="/drive" element={<DriveScreen />} />
          <Route path="/planning" element={<PlanningScreen />} />
          <Route path="/zones" element={<ZonesScreen />} />
          <Route path="/gas" element={<GasScreen />} />
          <Route path="/navigate" element={<NavigateScreen />} />
          <Route path="/app/launch-gps" element={<NavigateScreen />} />
          <Route path="/events" element={<EventsScreen />} />
          <Route path="/admin" element={<AdminScreen />} />
          <Route path="/admin/operations" element={<AdminOperationsScreen />} />
          <Route path="/admin/reports" element={<AdminReportsScreen />} />
          <Route path="/admin/learning" element={<AdminLearningScreen />} />
          <Route path="/admin/imports" element={<AdminImportsScreen />} />
          <Route path="/admin/tools" element={<AdminToolsScreen />} />
          <Route path="/admin/discoveries" element={<AdminZoneDiscoveriesScreen />} />
          <Route path="/admin/driver-ops" element={<AdminDriverOpsScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      {showNearestHotspot && <NearestHotspot />}
      <AutoShiftMonitor />
      <PwaInstallBanner />
      <BottomNav />
    </div>
  );
}

// ErrorBoundary is the OUTERMOST wrapper so a throw in any provider, a lazy
// route, or a stale vendor chunk still renders the visible recovery screen
// instead of a black page. Sonner is mounted high so SwUpdatePrompt can toast.
const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <Sonner />
            <SwUpdatePrompt />
            <TripsResumeSync />
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <AppContent />
            </BrowserRouter>
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
