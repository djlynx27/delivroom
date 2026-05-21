import { usePwaInstall } from '@/hooks/usePwaInstall';
import { Download, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Global sticky install banner — shown on EVERY page when the PWA can be
 * installed (Android Chrome fires `beforeinstallprompt`). Dismissed for
 * 7 days then re-shown automatically.
 */
export function PwaInstallBanner() {
  const { canInstall, install, dismiss } = usePwaInstall();
  const [installing, setInstalling] = useState(false);

  if (!canInstall) return null;

  const handleInstall = async () => {
    setInstalling(true);
    await install();
    setInstalling(false);
  };

  return (
    <div
      className="fixed bottom-20 inset-x-3 z-50 animate-in slide-in-from-bottom-4 duration-300"
      role="banner"
      aria-label="Installer l'application Delivroom"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-card px-4 py-3 shadow-2xl">
        {/* App icon */}
        <img
          src="/pwa-icon-192.png"
          alt="Delivroom"
          className="h-10 w-10 rounded-xl flex-shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-display font-bold leading-tight">
            Installer Delivroom
          </p>
          <p className="text-[11px] text-muted-foreground font-body leading-tight mt-0.5">
            Accès rapide · Fonctionne hors-ligne
          </p>
        </div>

        {/* Install CTA */}
        <button
          onClick={() => void handleInstall()}
          disabled={installing}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[12px] font-display font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors flex-shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          {installing ? '…' : 'Installer'}
        </button>

        {/* Dismiss (snooze 7 days) */}
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
          aria-label="Masquer pour 7 jours"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
