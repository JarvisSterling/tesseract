'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Plus, Loader2 } from 'lucide-react';

interface PairSelectorProps {
  selectedPairs: string[];
  onPairsChange: (pairs: string[]) => void;
}

interface BinancePair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

const STORAGE_KEY = 'tesseract-watchlist';

// Default pairs if nothing saved
export const DEFAULT_PAIRS = [
  'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'AVAX',
  'DOT', 'LINK', 'MATIC', 'LTC', 'UNI', 'ATOM', 'APT'
];

export function loadSavedPairs(): string[] {
  if (typeof window === 'undefined') return DEFAULT_PAIRS;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return DEFAULT_PAIRS;
}

export function savePairs(pairs: string[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pairs));
}

export function PairSelector({ selectedPairs, onPairsChange }: PairSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [allPairs, setAllPairs] = useState<BinancePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch all USDT pairs from Binance
  useEffect(() => {
    const fetchPairs = async () => {
      setLoading(true);
      try {
        const res = await fetch('https://api.binance.com/api/v3/exchangeInfo');
        const data = await res.json();
        const usdtPairs = data.symbols
          .filter((s: any) => 
            s.quoteAsset === 'USDT' && 
            s.status === 'TRADING' &&
            !s.symbol.includes('UP') &&
            !s.symbol.includes('DOWN') &&
            !s.symbol.includes('BULL') &&
            !s.symbol.includes('BEAR')
          )
          .map((s: any) => ({
            symbol: s.symbol,
            baseAsset: s.baseAsset,
            quoteAsset: s.quoteAsset
          }))
          .sort((a: BinancePair, b: BinancePair) => a.baseAsset.localeCompare(b.baseAsset));
        setAllPairs(usdtPairs);
      } catch (e) {
        setError('Failed to load pairs');
      } finally {
        setLoading(false);
      }
    };
    fetchPairs();
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPairs = allPairs.filter(p => 
    p.baseAsset.toLowerCase().includes(search.toLowerCase()) &&
    !selectedPairs.includes(p.baseAsset)
  ).slice(0, 20);

  const addPair = useCallback((baseAsset: string) => {
    const newPairs = [...selectedPairs, baseAsset];
    onPairsChange(newPairs);
    savePairs(newPairs);
    setSearch('');
  }, [selectedPairs, onPairsChange]);

  const removePair = useCallback((baseAsset: string) => {
    const newPairs = selectedPairs.filter(p => p !== baseAsset);
    onPairsChange(newPairs);
    savePairs(newPairs);
  }, [selectedPairs, onPairsChange]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected pairs as tags */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {selectedPairs.map(pair => (
          <span
            key={pair}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-zinc-800 text-zinc-300 border border-zinc-700"
          >
            {pair}
            <button
              onClick={() => removePair(pair)}
              className="text-zinc-500 hover:text-rose-400 transition-colors"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        
        {/* Add button / Search input */}
        <div className="relative">
          {isOpen ? (
            <div className="flex items-center">
              <Search size={12} className="absolute left-2 text-zinc-500" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value.toUpperCase())}
                placeholder="Search pairs..."
                className="w-32 pl-7 pr-2 py-1 text-[10px] bg-zinc-900 border border-zinc-700 rounded focus:outline-none focus:border-indigo-500 text-white placeholder-zinc-500"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => {
                setIsOpen(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors"
            >
              <Plus size={10} />
              Add Pair
            </button>
          )}
          
          {/* Dropdown */}
          {isOpen && (
            <div className="absolute top-full left-0 mt-1 w-48 max-h-64 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50">
              {loading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-zinc-500" />
                </div>
              )}
              
              {error && (
                <div className="p-2 text-[10px] text-rose-400">{error}</div>
              )}
              
              {!loading && !error && filteredPairs.length === 0 && (
                <div className="p-2 text-[10px] text-zinc-500">
                  {search ? 'No matches found' : 'Type to search'}
                </div>
              )}
              
              {!loading && !error && filteredPairs.map(pair => (
                <button
                  key={pair.symbol}
                  onClick={() => addPair(pair.baseAsset)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-left hover:bg-zinc-800 transition-colors"
                >
                  <span className="font-medium text-white">{pair.baseAsset}</span>
                  <span className="text-zinc-500">{pair.symbol}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      
      <div className="text-[9px] text-zinc-600">
        {selectedPairs.length} pairs tracked
      </div>
    </div>
  );
}
