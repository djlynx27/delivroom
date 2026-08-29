import type { Zone } from '@/hooks/useSupabase';

export interface LearningAgentState {
  zoneWeightAdjustments: Record<string, number>;
  lastUpdated: string;
}

export interface LearningAgent {
  id: string;
  name: string;
  description: string;
  weight: number;
  predict: (zone: Zone, baseScore: number) => number;
  learn: (history: ZoneHistory[]) => LearningAgentState;
}

export interface ZoneHistory {
  zoneId: string;
  observedScore: number;
  expectedScore: number;
  timestamp: string;
}

export function getDefaultLearningAgents(): LearningAgent[] {
  return [
    {
      id: 'trendAgent',
      name: 'Trend Agent',
      description:
        'Adapte la prédiction selon la tendance historique de la zone',
      weight: 0.55,
      // predict retourne baseScore neutre : l'ajustement réel de tendance
      // est calculé par learn() → zoneWeightAdjustments, appliqué dans
      // applyLearningAgents après le mix pondéré.
      predict: (_zone, baseScore) => baseScore,
      learn: (history) => {
        // Gradient EMA : accumule l'écart observé/prédit pour chaque zone.
        // Résultat : delta de correction appliqué directement au score final.
        const adj: Record<string, number> = {};
        for (const item of history) {
          const delta = (item.observedScore - item.expectedScore) * 0.03;
          adj[item.zoneId] = (adj[item.zoneId] ?? 0) + delta;
        }
        return {
          zoneWeightAdjustments: adj,
          lastUpdated: new Date().toISOString(),
        };
      },
    },
    {
      id: 'rushhourAgent',
      name: 'Rush Hour Agent',
      description: 'Renforce les demandes en heure de pointe',
      weight: 0.45,
      predict: (_zone, baseScore) => {
        const hour = new Date().getHours();
        const modifier =
          (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19) ? 1.12 : 1;
        return Math.min(100, Math.max(0, Math.round(baseScore * modifier)));
      },
      learn: () => ({
        zoneWeightAdjustments: {},
        lastUpdated: new Date().toISOString(),
      }),
    },
  ];
}

export function applyLearningAgents(
  zones: Zone[],
  baseScores: Map<string, number>,
  history: ZoneHistory[] = []
): Map<string, number> {
  const agents = getDefaultLearningAgents();
  const adjusted = new Map<string, number>(baseScores);

  for (const agent of agents) {
    const state = agent.learn(history); // on met à jour l'état (type prototype)
    for (const zone of zones) {
      const zoneBase = adjusted.get(zone.id) ?? 50;
      const predicted = agent.predict(zone, zoneBase);
      // application d'un mix pondéré simple
      const mix = zoneBase * (1 - agent.weight) + predicted * agent.weight;
      adjusted.set(zone.id, Math.min(100, Math.max(0, Math.round(mix))));

      // respect des historic adjustments si disponible
      if (
        state.zoneWeightAdjustments &&
        state.zoneWeightAdjustments[zone.id] != null
      ) {
        adjusted.set(
          zone.id,
          Math.min(
            100,
            Math.max(
              0,
              adjusted.get(zone.id)! + (state.zoneWeightAdjustments[zone.id] ?? 0)
            )
          )
        );
      }
    }
  }

  return adjusted;
}
