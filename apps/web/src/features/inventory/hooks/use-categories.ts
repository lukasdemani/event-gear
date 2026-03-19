/**
 * @file use-categories.ts
 * @purpose Hook for fetching and mutating categories
 */
import { useState, useEffect, useCallback } from 'react';
import { listCategories, createCategory as apiCreateCategory } from '@/lib/api-client';
import type { Category, CreateCategoryInput } from '@/lib/types';

interface UseCategoriesResult {
  categories: Category[];
  loading: boolean;
  error: string | undefined;
  refetch: () => void;
  createCategory: (input: CreateCategoryInput) => Promise<boolean>;
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    listCategories().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCategories(result.data);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  const createCategory = useCallback(async (input: CreateCategoryInput): Promise<boolean> => {
    const result = await apiCreateCategory(input);
    if (result.ok) {
      refetch();
      return true;
    }
    return false;
  }, [refetch]);

  return { categories, loading, error, refetch, createCategory };
}
