/**
 * @file use-equipment.ts
 * @purpose Hook for fetching and mutating equipment with pagination support
 */
import { useState, useEffect, useCallback } from 'react';
import {
  listEquipment,
  createEquipment as apiCreateEquipment,
  updateEquipment as apiUpdateEquipment,
} from '@/lib/api-client';
import type { Equipment, CreateEquipmentInput, UpdateEquipmentInput } from '@/lib/types';

interface UseEquipmentResult {
  equipment: Equipment[];
  loading: boolean;
  error: string | undefined;
  nextToken: string | undefined;
  refetch: () => void;
  loadMore: () => void;
  createEquipment: (input: CreateEquipmentInput) => Promise<boolean>;
  updateEquipment: (id: string, input: UpdateEquipmentInput) => Promise<boolean>;
}

export function useEquipment(): UseEquipmentResult {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setEquipment([]);
    setNextToken(undefined);

    listEquipment({ limit: 25 }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEquipment(result.data.items);
        setNextToken(result.data.nextToken);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const loadMore = useCallback(() => {
    if (nextToken === undefined) return;
    listEquipment({ limit: 25, nextToken }).then((result) => {
      if (result.ok) {
        setEquipment((prev) => [...prev, ...result.data.items]);
        setNextToken(result.data.nextToken);
      }
    });
  }, [nextToken]);

  const createEquipment = useCallback(async (input: CreateEquipmentInput): Promise<boolean> => {
    const result = await apiCreateEquipment(input);
    if (result.ok) { refetch(); return true; }
    return false;
  }, [refetch]);

  const updateEquipment = useCallback(async (id: string, input: UpdateEquipmentInput): Promise<boolean> => {
    const result = await apiUpdateEquipment(id, input);
    if (result.ok) { refetch(); return true; }
    return false;
  }, [refetch]);

  return { equipment, loading, error, nextToken, refetch, loadMore, createEquipment, updateEquipment };
}
