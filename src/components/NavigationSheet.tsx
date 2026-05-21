import { GoogleMapsIcon, WazeIcon } from '@/components/NavIcons';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useI18n } from '@/contexts/I18nContext';
import { openGoogleMapsNav, openWazeNav } from '@/lib/hotspots';
import { X } from 'lucide-react';

interface NavigationSheetProps {
  open: boolean;
  onClose: () => void;
  zoneName: string;
  latitude: number;
  longitude: number;
}

export function NavigationSheet({
  open,
  onClose,
  zoneName,
  latitude,
  longitude,
}: NavigationSheetProps) {
  const { t } = useI18n();

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        closeLabel={t('close')}
        onCloseClick={onClose}
        className="rounded-t-2xl px-4 pb-6 pt-4 bg-card border-border"
      >
        <SheetHeader>
          <SheetTitle className="font-display text-[22px] text-foreground">
            {zoneName}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Choisissez votre application de navigation.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 mt-4">
          <Button
            onClick={() => openGoogleMapsNav(zoneName, latitude, longitude)}
            className="w-full gap-2.5 text-[18px] font-display font-bold h-16 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <GoogleMapsIcon className="w-6 h-6 flex-shrink-0" />
            Google Maps
          </Button>
          <Button
            onClick={() => openWazeNav(zoneName, latitude, longitude)}
            variant="secondary"
            className="w-full gap-2.5 text-[18px] font-display font-bold h-16"
          >
            <WazeIcon className="w-6 h-6 flex-shrink-0" />
            Waze
          </Button>
          <Button
            variant="outline"
            className="w-full gap-2 text-[16px] h-12 font-display"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
            {t('close')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
