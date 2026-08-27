import { useI18n } from '@/contexts/I18nContext';
import { getDemandLevel } from '@/lib/demandUtils';

interface DemandBadgeProps {
  score: number;
  size?: 'sm' | 'lg' | 'giant';
}

export function DemandBadge({ score, size = 'sm' }: DemandBadgeProps) {
  const { t } = useI18n();
  const level = getDemandLevel(score);

  const label = level === 'high' ? t('demandHigh') : level === 'medium' ? t('demandMedium') : t('demandLow');
  const bgClass = level === 'high' ? 'demand-high' : level === 'medium' ? 'demand-medium' : 'demand-low';
  const textClass = level === 'high' ? 'text-score-high' : level === 'medium' ? 'text-score-medium' : 'text-score-low';

  if (size === 'giant') {
    return (
      <div className="flex flex-col items-center gap-0.5">
        {/* key={score} remounts the node so the pop animation replays when
            the score value changes, not on every unrelated re-render. */}
        <span
          key={score}
          className={`${textClass} text-[64px] font-display font-extrabold leading-none animate-spring-pop`}
        >
          {score}
        </span>
        <span className={`${bgClass} inline-flex items-center rounded-full px-3 py-1 text-[14px] font-display font-semibold text-background`}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <span
      className={`${bgClass} inline-flex items-center gap-1.5 rounded-full font-display font-semibold whitespace-nowrap ${
        size === 'lg'
          ? 'px-4 py-2 text-[16px] text-background'
          : 'px-2.5 py-1 text-[14px] text-background'
      }`}
    >
      {label} · {score}
    </span>
  );
}
