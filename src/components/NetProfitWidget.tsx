import { ChevronDown, ChevronUp, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEPRECIATION_PER_KM, FUEL_COST_PER_KM } from '@/lib/shiftTracker';

interface NetProfitWidgetProps {
  /** Gross earnings for the period (CAD) */
  grossEarnings: number;
  /** Total kilometres driven (used for fuel/depreciation/CRA deduction) */
  totalKm?: number;
  /** Hours worked — enables $/h calculation */
  hoursWorked?: number;
  /** Show estimated Quebec + federal tax line (default true) */
  showTaxEstimate?: boolean;
}

// ── Cost constants ────────────────────────────────────────────────────────────
// CRA 2025 automobile mileage rate (first 5 000 km at the higher tier)
const CRA_RATE_PER_KM = 0.72; // $/km deductible business travel
// FUEL_COST_PER_KM / DEPRECIATION_PER_KM live in shiftTracker.ts — shared with
// ShiftTally's net $/h so there's one source of truth for the cost model.
// Combined federal + Quebec marginal rate for ~$60k self-employed income
const ESTIMATED_TAX_RATE = 0.3;

function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Net Profit Widget
 *
 * Shows the driver's estimated take-home pay after:
 * 1. Vehicle fuel costs
 * 2. Vehicle depreciation
 * 3. CRA mileage deduction applied against taxable income
 * 4. Estimated Quebec + federal self-employment tax
 *
 * Rates are based on CRA 2025 automobile deduction rules.
 * This is an ESTIMATE — not tax advice.
 */
export function NetProfitWidget({
  grossEarnings,
  totalKm = 0,
  hoursWorked = 0,
  showTaxEstimate = true,
}: NetProfitWidgetProps) {
  const [expanded, setExpanded] = useState(false);

  const breakdown = useMemo(() => {
    const fuelCost = totalKm * FUEL_COST_PER_KM;
    const depreciationCost = totalKm * DEPRECIATION_PER_KM;
    const mileageDeduction = Math.min(totalKm * CRA_RATE_PER_KM, grossEarnings);
    const taxableIncome = Math.max(0, grossEarnings - mileageDeduction);
    const taxEstimate = showTaxEstimate
      ? taxableIncome * ESTIMATED_TAX_RATE
      : 0;
    const netProfit = grossEarnings - fuelCost - depreciationCost - taxEstimate;
    const netPerHour = hoursWorked > 0 ? netProfit / hoursWorked : null;

    return {
      fuelCost,
      depreciationCost,
      mileageDeduction,
      taxEstimate,
      netProfit,
      netPerHour,
    };
  }, [grossEarnings, totalKm, hoursWorked, showTaxEstimate]);

  const isPositive = breakdown.netProfit >= 0;
  const netColor = isPositive ? 'text-[hsl(151_100%_45%)]' : 'text-destructive';

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* ── Header row (always visible) ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 gap-3 hover:bg-white/5 active:bg-white/10 transition-colors"
        aria-expanded={expanded}
        aria-controls="net-profit-breakdown"
      >
        <div className="flex items-center gap-2 min-w-0">
          <TrendingDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Profit net estimé
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <span className={`text-2xl font-black font-display ${netColor}`}>
              {formatMoney(breakdown.netProfit)}
            </span>
            {breakdown.netPerHour !== null && (
              <span className="text-xs text-muted-foreground ml-1.5">
                {formatMoney(breakdown.netPerHour)}/h
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* ── Expandable breakdown ── */}
      {expanded && (
        <div
          id="net-profit-breakdown"
          className="border-t border-border px-4 pb-4 pt-3 space-y-2 text-sm"
        >
          {/* Gross */}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Revenus bruts</span>
            <span className="font-semibold text-foreground">
              {formatMoney(grossEarnings)}
            </span>
          </div>

          {totalKm > 0 && (
            <>
              {/* Fuel */}
              <div className="flex justify-between text-red-400/80">
                <span>
                  Carburant (~{totalKm} km × {formatMoney(FUEL_COST_PER_KM)}/km)
                </span>
                <span>−{formatMoney(breakdown.fuelCost)}</span>
              </div>

              {/* Depreciation */}
              <div className="flex justify-between text-red-400/60">
                <span>Dépréciation véhicule</span>
                <span>−{formatMoney(breakdown.depreciationCost)}</span>
              </div>

              {/* CRA mileage deduction (positive) */}
              <div className="flex justify-between text-emerald-400/70">
                <span>Déduction ARC ({CRA_RATE_PER_KM}$/km)</span>
                <span>+{formatMoney(breakdown.mileageDeduction)}</span>
              </div>
            </>
          )}

          {/* Tax */}
          {showTaxEstimate && (
            <div className="flex justify-between text-amber-400/80">
              <span>Impôt estimé (fédéral + Qc ~30%)</span>
              <span>−{formatMoney(breakdown.taxEstimate)}</span>
            </div>
          )}

          {/* Net total */}
          <div className="border-t border-border pt-2 flex justify-between font-bold">
            <span className="text-muted-foreground">Net</span>
            <span className={netColor}>{formatMoney(breakdown.netProfit)}</span>
          </div>

          <p className="text-xs text-muted-foreground/50 pt-1 leading-relaxed">
            Estimation basée sur CRA 2025 · Carburant{' '}
            {formatMoney(FUEL_COST_PER_KM)}/km · Non officiel, pas un conseil
            fiscal.
          </p>
        </div>
      )}
    </div>
  );
}
