---
name: shift-planner
description: Planification optimale des quarts de travail pour chauffeurs gig selon objectifs de revenus, disponibilite et historique. Utilise ce skill des que l'utilisateur veut planifier sa semaine, calculer combien d'heures travailler pour atteindre un objectif, ou optimiser ses horaires selon les meilleures plages. Calibre pour Montreal, Laval, Longueuil.
---

# Shift Planner

Planification de quarts optimises pour maximiser les revenus gig.

## Calcul objectif --> heures necessaires

```python
def hours_to_target(weekly_target: float, avg_hourly_rate: float, expense_pct: float = 0.15) -> dict:
    net_hourly = avg_hourly_rate * (1 - expense_pct)
    hours_needed = weekly_target / net_hourly
    return {
        'heures_necessaires': round(hours_needed, 1),
        'taux_net_estime': round(net_hourly, 2),
        'shifts_de_5h': round(hours_needed / 5, 1),
        'shifts_de_8h': round(hours_needed / 8, 1),
    }

# Ex: objectif 1500$/sem, taux brut 32$/h
# --> 54.3h brutes, 10.9 shifts de 5h
```

## Valeurs par creneau (Grand Montreal)

```python
# Revenu estime par heure selon jour et heure
# (jour_semaine: 0=Lun, 6=Dim)
SLOT_REVENUE = {
    (4, 17, 23): 38,  # Vendredi soir
    (5,  0,  4): 44,  # Nuit samedi -- sorties
    (5, 10, 16): 29,  # Samedi journee
    (5, 17, 23): 40,  # Samedi soir
    (6,  0,  3): 37,  # Nuit dimanche
    (6, 10, 16): 26,  # Dimanche brunch/journee
    (3, 17, 23): 31,  # Jeudi soir
    (0, 17, 22): 28,  # Lundi soir
    (1, 17, 22): 27,  # Mardi soir
    (2, 17, 22): 28,  # Mercredi soir
    (0,  6,  9): 30,  # Lundi rush matinal
    (1,  6,  9): 30,  # Mardi rush matinal
    (2,  6,  9): 30,  # Mercredi rush matinal
    (3,  6,  9): 31,  # Jeudi rush matinal
    (4,  6,  9): 33,  # Vendredi rush matinal
}

def optimize_week(target: float, max_hours: int = 50) -> list:
    slots = sorted(SLOT_REVENUE.items(), key=lambda x: -x[1])
    plan, total_rev, total_hrs = [], 0, 0
    day_names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

    for (day, start, end), rate in slots:
        if total_hrs >= max_hours or total_rev >= target:
            break
        avail = end - start
        hours = min(avail, max_hours - total_hrs)
        rev = hours * rate
        plan.append({
            'jour': day_names[day],
            'debut': f"{start:02d}h",
            'fin': f"{start+hours:02d}h",
            'heures': hours,
            'revenu_estime': rev,
            'taux': rate,
        })
        total_rev += rev
        total_hrs += hours

    return plan, round(total_rev, 2), total_hrs
```

## Template semaine type (objectif 1 500$/sem)

```
PLAN DE SEMAINE -- Objectif 1 500 $
=========================================
Jour       Creneau      Heures  Estime
-----------------------------------------
Vendredi   17h --> 03h     10h   ~380 $  **
Samedi     10h --> 04h     12h   ~440 $  **
Dimanche   10h --> 20h      8h   ~210 $
Jeudi      17h --> 23h      6h   ~186 $
Lundi      17h --> 22h      5h   ~140 $
-----------------------------------------
TOTAL                       41h  ~1 356 $
(+ rush matinaux si besoin pour combler)
```

## Alertes pre-shift

```
Avant chaque shift:
  Verifier Delivroom --> zones score >= 6
  Verifier meteo --> pluie = plus de demande
  Verifier Ticketmaster --> evenements ce soir
  Plein d'essence si < 1/4 reservoir
  Charge telephone 100%

Ajustements dynamiques:
  Score zone < 4 depuis 15 min --> bouger
  Temps attente > 10 min --> repositionner
  Meteo se degrade --> aller vers centre-ville
  Concert/match qui finit --> se positionner pres venue
```

## Calcul de break-even

```python
def break_even_analysis(monthly_fixed_costs: dict, avg_daily_rate: float) -> dict:
    """Calculer le nombre minimal de jours de travail pour couvrir les couts."""
    total_fixed = sum(monthly_fixed_costs.values())
    days_needed = total_fixed / (avg_daily_rate * 8)  # shift de 8h

    return {
        'couts_fixes_mensuels': total_fixed,
        'jours_break_even': round(days_needed, 1),
        'revenus_nets_par_jour': avg_daily_rate * 8,
    }

# Exemple couts fixes mensuels
couts = {
    'assurance': 280,
    'paiement_vehicule': 450,
    'telephone': 65,
    'internet': 60,
    'immatriculation': 25,
}
# break_even: ~5.1 jours/mois pour couvrir les fixes
```
