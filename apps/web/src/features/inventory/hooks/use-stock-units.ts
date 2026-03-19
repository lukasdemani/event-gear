/**
 * @file use-stock-units.ts
 * @purpose Hook for fetching and mutating stock units for a given equipment ID
 */
import { useState, useEffect, useCallback } from 'react';
import { listStockUnits, createStockUnit as apiCreateStockUnit, updateUnitStatus as apiUpdateUnitStatus } from '@/lib/api-client';
import type { StockUnit, CreateStockUnitInput, UpdateStockUnitStatusInput } from '@/lib/types';

interface UseStockUnitsResult {
  units: StockUnit[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
  createUnit: (input: CreateStockUnitInput) => Promise<{ ok: boolean; error?: string }>;
  updateStatus: (unitId: string, input: UpdateStockUnitStatusInput) => Promise<{ ok: boolean; error?: string }>;
}

export function useStockUnits(equipmentId: string): UseStockUnitsResult {
  const [units, setUnits] = useState<StockUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    listStockUnits(equipmentId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setUnits(result.data);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [equipmentId, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const createUnit = useCallback(async (input: CreateStockUnitInput): Promise<{ ok: boolean; error?: string }> => {
    const result = await apiCreateStockUnit(equipmentId, input);
    if (result.ok) { refetch(); return { ok: true }; }
    return { ok: false, error: result.error.message };
  }, [equipmentId, refetch]);

  const updateStatus = useCallback(async (unitId: string, input: UpdateStockUnitStatusInput): Promise<{ ok: boolean; error?: string }> => {
    const result = await apiUpdateUnitStatus(equipmentId, unitId, input);
    if (result.ok) { refetch(); return { ok: true }; }
    return { ok: false, error: result.error.message };
  }, [equipmentId, refetch]);

  return { units, loading, error, refetch, createUnit, updateStatus };
}
