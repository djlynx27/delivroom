import { Check, Flag, MapPin, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProspectingStep } from '@/services/routing/prospectingSteps';

interface ProspectingStepperProps {
  destinationName: string;
  steps: ProspectingStep[];
  /** Index of the next step to launch; earlier steps render as done. */
  activeIndex: number;
  onLaunch: (index: number) => void;
  onClose: () => void;
}

export function ProspectingStepper({
  destinationName,
  steps,
  activeIndex,
  onLaunch,
  onClose,
}: ProspectingStepperProps) {
  return (
    <div className="mx-4 mt-3 rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-display font-bold truncate">
          Prospection → {destinationName}
        </h3>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose} aria-label="Abandonner la prospection">
          <X className="w-4 h-4" />
        </Button>
      </div>
      {steps.length === 1 && (
        <p className="text-[12px] text-muted-foreground">
          Aucune zone chaude sur le chemin — trajet direct.
        </p>
      )}
      <ol className="space-y-2">
        {steps.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li
              key={step.zone.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                active ? 'border-primary' : 'border-border'
              } ${done ? 'opacity-50' : ''}`}
            >
              {done ? (
                <Check className="w-4 h-4 flex-shrink-0" />
              ) : step.isDestination ? (
                <Flag className="w-4 h-4 flex-shrink-0" />
              ) : (
                <MapPin className="w-4 h-4 flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-display font-semibold truncate">
                  {step.isDestination ? 'Destination' : `Étape ${i + 1}`} · {step.zone.name}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {step.legKm.toFixed(1)} km
                  {!step.isDestination && ` · score ${Math.round(step.zone.score)}`}
                </p>
              </div>
              <Button
                size="sm"
                variant={active ? 'default' : 'outline'}
                className="h-10 flex-shrink-0"
                onClick={() => onLaunch(i)}
              >
                {done ? 'Relancer' : 'Lancer'}
              </Button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
