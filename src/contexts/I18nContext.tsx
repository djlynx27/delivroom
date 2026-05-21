import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type Lang = 'en' | 'fr';

const translations: Record<string, Record<Lang, string>> = {
  today: { en: 'Today', fr: 'Auj.' },
  planning: { en: 'Planning', fr: 'Planning' },
  zones: { en: 'Zones', fr: 'Zones' },
  admin: { en: 'Admin', fr: 'Admin' },
  selectCity: { en: 'Select city', fr: 'Sélectionner la ville' },
  bestZone: { en: 'Best Zone Now', fr: 'Meilleure zone maintenant' },
  nextSlots: { en: 'Next Recommended', fr: 'Prochaines recommandations' },
  demandHigh: { en: 'High Demand', fr: 'Forte demande' },
  demandMedium: { en: 'Medium Demand', fr: 'Demande moyenne' },
  demandLow: { en: 'Low Demand', fr: 'Faible demande' },
  score: { en: 'Score', fr: 'Score' },
  zone: { en: 'Zone', fr: 'Zone' },
  type: { en: 'Type', fr: 'Type' },
  schedule: { en: '24h Schedule', fr: 'Horaire 24h' },
  selectDate: { en: 'Select date', fr: 'Sélectionner la date' },
  allZones: { en: 'All Zones', fr: 'Toutes les zones' },
  addZone: { en: 'Add Zone', fr: 'Ajouter une zone' },
  editZone: { en: 'Edit Zone', fr: 'Modifier la zone' },
  deleteZone: { en: 'Delete', fr: 'Supprimer' },
  save: { en: 'Save', fr: 'Enregistrer' },
  cancel: { en: 'Cancel', fr: 'Annuler' },
  name: { en: 'Name', fr: 'Nom' },
  latitude: { en: 'Latitude', fr: 'Latitude' },
  longitude: { en: 'Longitude', fr: 'Longitude' },
  city: { en: 'City', fr: 'Ville' },
  manageCities: { en: 'Manage Cities', fr: 'Gérer les villes' },
  manageZones: { en: 'Manage Zones', fr: 'Gérer les zones' },
  simulate: { en: 'Simulate Demand', fr: 'Simuler la demande' },
  simulateDesc: {
    en: 'Generate demand scores for selected date',
    fr: 'Générer les scores de demande pour la date sélectionnée',
  },
  apiConnector: { en: 'AI Connector', fr: 'Connecteur IA' },
  apiDesc: {
    en: 'Future Abacus AI integration placeholder',
    fr: 'Espace réservé pour intégration Abacus AI',
  },
  noData: { en: 'No data for this slot', fr: 'Aucune donnée pour ce créneau' },
  currentSlot: { en: 'Current Slot', fr: 'Créneau actuel' },
  addCity: { en: 'Add City', fr: 'Ajouter une ville' },
  simulated: { en: 'Simulated', fr: 'Simulé' },
  edit: { en: 'Edit', fr: 'Modifier' },
  events: { en: 'Events', fr: 'Évén.' },
  noEventsToday: { en: 'No events today', fr: "Aucun événement aujourd'hui" },
  next7Days: { en: 'Next 7 days', fr: '7 prochains jours' },
  noUpcomingEvents: { en: 'No upcoming events', fr: 'Aucun événement à venir' },
  noZonesAvailable: {
    en: 'No zones available right now.',
    fr: 'Aucune zone disponible pour le moment.',
  },
  eventCategoryHockey: { en: 'NHL', fr: 'NHL' },
  eventCategoryFestival: { en: 'Festival', fr: 'Festival' },
  eventCategoryHoliday: { en: 'Holiday', fr: 'Férié' },
  eventCategoryEvent: { en: 'Event', fr: 'Événement' },

  offline: { en: 'Offline', fr: 'Hors ligne' },
  installApp: { en: 'Install Delivroom', fr: 'Installer Delivroom' },
  enableNotifications: {
    en: 'Enable notifications',
    fr: 'Activer les notifications',
  },
  notificationsEnabled: {
    en: 'Notifications enabled',
    fr: 'Notifications activées',
  },
  readyToDrive: { en: 'Ready to drive', fr: 'Prêt à rouler' },
  driveMode: { en: 'Drive Mode', fr: 'Mode Conduite' },
  screenActive: { en: 'Screen awake', fr: 'Écran réveillé' },
  screenInactive: { en: 'May sleep', fr: 'Veille possible' },
  screenUnsupported: {
    en: 'Not supported',
    fr: 'Non supporté',
  },
  close: { en: 'Close', fr: 'Fermer' },
  goGoogleMaps: { en: 'GO — Google Maps', fr: 'GO — Google Maps' },
  waze: { en: 'Waze', fr: 'Waze' },
  canadiensGame: {
    en: 'Canadiens – Centre Bell',
    fr: 'Canadiens – Centre Bell',
  },
  adminModeTaxi: { en: 'Taxi Mode', fr: 'Mode Taxi' },
  kmTracking: { en: 'Km tracking', fr: 'Suivi km' },
  experimentalShift: { en: 'Experimental shift', fr: 'Shift expérimental' },
  startTrip: { en: 'Start trip', fr: 'Démarrer course' },
  cashEarnings: { en: 'Cash earnings', fr: 'Gains cash' },
  journalTrips: { en: 'Trip log', fr: 'Journal de courses' },
  logTripManual: {
    en: 'Record a trip manually',
    fr: 'Enregistrer manuellement une course',
  },
  noZonesCity: {
    en: 'No zones for this city',
    fr: 'Pas de zones pour cette ville',
  },
  generationInProgress: {
    en: 'Generation in progress…',
    fr: 'Génération en cours…',
  },
  deliveryAIAnalysis: { en: 'AI Demand Analysis', fr: 'Analyse de demande IA' },
  aiAnalysisDone: { en: 'AI analysis done', fr: 'Analyse IA terminée' },
  openFoodFacts: { en: 'OpenFoodFacts', fr: 'OpenFoodFacts' },
  fourSquare: { en: 'Foursquare Places', fr: 'Foursquare Places' },
  searchProducts: { en: 'Search products', fr: 'Rechercher des produits' },
  searchPlaces: { en: 'Search places', fr: 'Rechercher des lieux' },
  productsFound: { en: 'products found', fr: 'produits trouvés' },
  placesFound: { en: 'places found', fr: 'lieux trouvés' },
  nutritionGrade: { en: 'Nutrition score', fr: 'Score nutritionnel' },
  currentLocation: { en: 'Current location', fr: 'Localisation actuelle' },
  locationOrQueryMissing: {
    en: 'Location or query missing',
    fr: 'Localisation ou requête manquante',
  },
  searchFailed: { en: 'Search failed', fr: 'Recherche échouée' },
  addEntry: { en: 'Add entry', fr: 'Ajouter entrée' },
  last10Trips: { en: 'Last 10 trips', fr: '10 dernières courses' },
  noTripZone: {
    en: 'Zone, date and amount required',
    fr: 'Zone, date et montant requis',
  },
  planAsDelivery: {
    en: 'Plan as delivery route',
    fr: 'Planifier comme livraison',
  },
  maxDeliveryScore: { en: 'Max delivery score', fr: 'Score livraison max' },
  bestDeliveryTip: {
    en: 'Best delivery availability',
    fr: 'Meilleure disponibilité livraison',
  },
  suggestDeliveryHotspots: {
    en: 'Suggest delivery hotspots',
    fr: 'Suggestion de zones livraison',
  },
  aiRecommendations: { en: 'AI recommendations', fr: 'Recommandations IA' },
  simulationMode: { en: 'AI simulation mode', fr: 'Mode simulation IA' },
  simulationExplanation: {
    en: 'Base scores by zone type + hourly multipliers',
    fr: 'Scores de base par type de zone + multiplicateurs horaires',
  },
  slotsCount: { en: '96 slots ×', fr: '96 créneaux ×' },
  handleAddCity: { en: 'Add city', fr: 'Ajouter une ville' },
  aiRunButton: { en: 'Run AI analysis', fr: 'Lancer l’analyse IA' },
  openFoodFactsDescription: {
    en: 'Search food products for delivery locations and density',
    fr: 'Recherche de produits alimentaires pour livraisons',
  },
  foursquareDescription: {
    en: 'Search nearby consumer venues using place API',
    fr: 'Recherche des lieux proches via API',
  },
  boostWeekdayEveningRush: {
    en: 'Evening rush – metro zones boosted 🚇',
    fr: 'Heure de pointe du soir – zones métro en hausse 🚇',
  },
  boostWeekendNight: {
    en: 'Weekend night – nightlife zones in high demand 🎉',
    fr: 'Nuit du week-end – zones nightlife en forte demande 🎉',
  },
  boostFriSatNight: {
    en: 'Friday/Saturday night – nightlife & casino boosted 🎰',
    fr: 'Vendredi/Samedi soir – nightlife & casino en hausse 🎰',
  },
  boostSunday: {
    en: 'Sunday – commercial zones boosted 🛍️',
    fr: 'Dimanche – zones commerciales en hausse 🛍️',
  },
  boostLunch: {
    en: 'Lunch hour – commercial & university zones 🍽️',
    fr: 'Heure du dîner – zones commerciales & universités 🍽️',
  },
  gettingLocation: { en: 'Getting location…', fr: 'Localisation en cours…' },
  locationUnavailable: {
    en: 'Location unavailable',
    fr: 'Localisation indisponible',
  },
  locationPermissionTip: {
    en: 'Allow location (GPS) for better prediction accuracy',
    fr: 'Autorisez la géolocalisation pour des prédictions plus fiables',
  },
  agentsDashboard: { en: 'Learning agents', fr: 'Agents d’apprentissage' },
  retrainAgents: { en: 'Retrain agents', fr: 'Rentrainer les agents' },
  agentLastUpdated: { en: 'Last updated', fr: 'Dernière mise à jour' },
  agentStatus: { en: 'Status', fr: 'Statut' },
  agentLearned: { en: 'Learned', fr: 'Appris' },
  agentRunning: { en: 'Running', fr: 'Exécution' },
  agentNotAvailable: { en: 'No history yet', fr: 'Aucun historique' },
  bestZoneNow: { en: 'Best zone now', fr: 'Meilleure zone maintenant' },
  searchZone: { en: 'Search a zone…', fr: 'Rechercher une zone…' },
  noResults: { en: 'No matching zones', fr: 'Aucune zone trouvée' },
  loadingZones: { en: 'Loading zones…', fr: 'Chargement des zones…' },
  loadingZonesEllipsis: {
    en: 'Loading zones...',
    fr: 'Chargement des zones...',
  },
  eventEndsIn: { en: 'ends in', fr: 'se termine dans' },
  minutes: { en: 'min', fr: 'min' },
  maxDemandExpected: {
    en: 'Max demand expected!',
    fr: 'Demande maximale prévue !',
  },
  ongoing: { en: 'Ongoing', fr: 'En cours' },
  boost: { en: 'Boost', fr: 'Boost' },
  radius: { en: 'Radius', fr: 'Rayon' },
  navigateTo: { en: 'Navigate to', fr: 'Naviguer vers' },
  yesHere: { en: 'Yes, I want', fr: 'Oui, je veux' },
};

interface I18nContextType {
  lang: Lang;
  toggleLang: () => void;
  t: (key: string) => string;
  locale: string;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'fr',
  toggleLang: () => {},
  t: (key) => key,
  locale: 'fr-CA',
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('fr');
  const toggleLang = useCallback(
    () => setLang((l) => (l === 'en' ? 'fr' : 'en')),
    []
  );
  const t = useCallback(
    (key: string) => translations[key]?.[lang] ?? key,
    [lang]
  );
  const locale = useMemo(() => (lang === 'fr' ? 'fr-CA' : 'en-CA'), [lang]);

  return (
    <I18nContext.Provider value={{ lang, toggleLang, t, locale }}>
      {children}
    </I18nContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useI18n = () => useContext(I18nContext);
