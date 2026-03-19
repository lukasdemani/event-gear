/**
 * @file use-maintenance.ts
 * @purpose Hook for fetching and mutating maintenance records for a given equipment ID
 */
import { useState, useEffect, useCallback } from 'react';
import {
  getMaintenanceHistory,
  createMaintenanceRecord as apiCreateRecord,
  completeMaintenance as apiComplete,
} from '@/lib/api-client';
import type { MaintenanceRecord, CreateMaintenanceRecordInput, CompleteMaintenanceInput } from '@/lib/types';

interface UseMaintenanceResult {
  records: MaintenanceRecord[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
  scheduleRecord: (input: CreateMaintenanceRecordInput) => Promise<{ ok: boolean; error?: string }>;
  completeRecord: (recordId: string, input: CompleteMaintenanceInput) => Promise<{ ok: boolean; error?: string }>;
}

export function useMaintenance(equipmentId: string): UseMaintenanceResult {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    getMaintenanceHistory(equipmentId).then((result) => {
      if (cancelled) return;
      if (result.ok) setRecords(result.data);
      else setError(result.error.message);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [equipmentId, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const scheduleRecord = useCallback(async (input: CreateMaintenanceRecordInput): Promise<{ ok: boolean; error?: string }> => {
    const result = await apiCreateRecord(input);
    if (result.ok) { refetch(); return { ok: true }; }
    return { ok: false, error: result.error.message };
  }, [refetch]);

  const completeRecord = useCallback(async (recordId: string, input: CompleteMaintenanceInput): Promise<{ ok: boolean; error?: string }> => {
    const result = await apiComplete(recordId, input);
    if (result.ok) { refetch(); return { ok: true }; }
    return { ok: false, error: result.error.message };
  }, [refetch]);

  return { records, loading, error, refetch, scheduleRecord, completeRecord };
}
