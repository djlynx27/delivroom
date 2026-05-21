import { AutoShiftMonitor } from '@/components/AutoShiftMonitor';
import { BottomNav } from '@/components/BottomNav';
import { NearestHotspot } from '@/components/NearestHotspot';
import { PwaInstallBanner } from '@/components/PwaInstallBanner';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/contexts/I18nContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import {
  Component,
  Suspense,
  lazy,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';

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
const NotFound = lazy(() => import('./pages/NotFound.tsx'));

const queryClient = new QueryClient();

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
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground px-4">
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
  // Hide NearestHotspot on Today screen since hero card already shows best zone + distance
  const showNearestHotspot =
    location.pathname !== '/today' &&
    location.pathname !== '/' &&
    location.pathname !== '/events' &&
    !location.pathname.startsWith('/admin');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Suspense
        fallback={
          <div className="min-h-screen bg-background text-foreground" />
        }
      >
        <Routes>
          <Route path="/" element={<DriveScreen />} />
          <Route path="/today" element={<TodayScreen />} />
          <Route path="/drive" element={<DriveScreen />} />
          <Route path="/planning" element={<PlanningScreen />} />
          <Route path="/zones" element={<ZonesScreen />} />
          <Route path="/events" element={<EventsScreen />} />
          <Route path="/admin" element={<AdminScreen />} />
          <Route path="/admin/operations" element={<AdminOperationsScreen />} />
          <Route path="/admin/reports" element={<AdminReportsScreen />} />
          <Route path="/admin/learning" element={<AdminLearningScreen />} />
          <Route path="/admin/imports" element={<AdminImportsScreen />} />
          <Route path="/admin/tools" element={<AdminToolsScreen />} />
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <Sonner />
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <AppErrorBoundary>
              <AppContent />
            </AppErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
