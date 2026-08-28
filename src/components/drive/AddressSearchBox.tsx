import { Input } from '@/components/ui/input';
import {
  addToSearchHistory,
  clearSearchHistory,
  getSearchHistory,
  removeFromSearchHistory,
  type SearchHistoryEntry,
} from '@/lib/addressSearchHistory';
import { geocodeSuggestions, type GeocodeSuggestion } from '@/lib/geocoding';
import { Clock, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const DEBOUNCE_MS = 300;

export interface AddressSearchResult {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface AddressSearchBoxProps {
  onSelect: (result: AddressSearchResult) => void;
}

function ResultRow({
  icon,
  name,
  onSelect,
  onRemove,
}: {
  icon: ReactNode;
  name: string;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2">
      <button
        onClick={onSelect}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left px-1.5 py-2.5 rounded-lg hover:bg-muted/60"
      >
        {icon}
        <span className="text-[14px] font-body text-foreground truncate">
          {name}
        </span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Retirer de l'historique"
          className="flex-shrink-0 p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function HistorySection({
  history,
  onSelect,
  onRemove,
  onClearAll,
}: {
  history: SearchHistoryEntry[];
  onSelect: (entry: SearchHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1">
        <span className="text-[11px] font-body uppercase tracking-wide text-muted-foreground">
          Recherches récentes
        </span>
        <button
          onClick={onClearAll}
          className="text-[11px] font-body text-muted-foreground hover:text-foreground"
        >
          Effacer
        </button>
      </div>
      {history.map((entry) => (
        <ResultRow
          key={entry.id}
          icon={<Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          name={entry.name}
          onSelect={() => onSelect(entry)}
          onRemove={() => onRemove(entry.id)}
        />
      ))}
    </>
  );
}

function SuggestionsSection({
  suggestions,
  isSearching,
  onSelect,
}: {
  suggestions: GeocodeSuggestion[];
  isSearching: boolean;
  onSelect: (result: GeocodeSuggestion) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <p className="px-3.5 py-3 text-[13px] text-muted-foreground text-center">
        {isSearching ? 'Recherche…' : 'Aucun résultat'}
      </p>
    );
  }
  return (
    <>
      {suggestions.map((s) => (
        <ResultRow
          key={s.id}
          icon={<Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          name={s.name}
          onSelect={() => onSelect(s)}
        />
      ))}
    </>
  );
}

/**
 * Floating address/POI search for the Drive tab. Focus with an empty query
 * shows the last 5 searched addresses (delivroom_search_history);  typing
 * switches to live Mapbox Geocoding suggestions, debounced 300ms so a full
 * word only fires one request instead of one per keystroke.
 */
export function AddressSearchBox({ onSelect }: AddressSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() =>
    getSearchHistory()
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      geocodeSuggestions(trimmed, { signal: ctrl.signal })
        .then((results) => {
          if (ctrl.signal.aborted) return;
          setSuggestions(results);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setIsSearching(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleSelect(result: AddressSearchResult) {
    setHistory(addToSearchHistory(result));
    setQuery('');
    setSuggestions([]);
    setIsFocused(false);
    onSelect(result);
  }

  const showHistory = isFocused && query.trim() === '' && history.length > 0;
  const showSuggestions = isFocused && query.trim() !== '';

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-card/95 backdrop-blur border border-border rounded-2xl px-3.5 h-12 shadow-lg">
        <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Chercher une adresse ou un lieu…"
          className="border-0 bg-transparent h-auto p-0 text-[14px] focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setSuggestions([]);
            }}
            aria-label="Effacer la recherche"
            className="flex-shrink-0 text-muted-foreground hover:text-foreground p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {(showHistory || showSuggestions) && (
        // Suppress the default mousedown focus-shift instead of the input's
        // onBlur — without this, blur fires (and closes the dropdown) before
        // a row's onClick ever gets a chance to run.
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 mt-2 bg-card border border-border rounded-2xl shadow-xl overflow-y-auto max-h-[60vh] z-10"
        >
          {showHistory && (
            <HistorySection
              history={history}
              onSelect={handleSelect}
              onRemove={(id) => setHistory(removeFromSearchHistory(id))}
              onClearAll={() => setHistory(clearSearchHistory())}
            />
          )}
          {showSuggestions && (
            <SuggestionsSection
              suggestions={suggestions}
              isSearching={isSearching}
              onSelect={handleSelect}
            />
          )}
        </div>
      )}
    </div>
  );
}
