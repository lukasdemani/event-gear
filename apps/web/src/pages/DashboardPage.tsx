/**
 * @file DashboardPage.tsx
 * @purpose Summary dashboard showing counts of categories, equipment, and available units
 */
import { useEffect, useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import Spinner from '@/components/ui/Spinner';
import { listCategories, listEquipment, listStockUnits } from '@/lib/api-client';
import { StockUnitStatus } from '@/lib/types';
import type { Equipment } from '@/lib/types';

interface Stats {
  categories: number;
  equipment: number;
  availableUnits: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [catsResult, eqResult] = await Promise.all([
        listCategories(),
        listEquipment({ limit: 100 }),
      ]);

      const catCount = catsResult.ok ? catsResult.data.length : 0;
      const eqItems: Equipment[] = eqResult.ok ? eqResult.data.items : [];

      let availableUnits = 0;
      if (eqItems.length > 0) {
        const unitResults = await Promise.all(eqItems.map((eq) => listStockUnits(eq.id)));
        for (const result of unitResults) {
          if (result.ok) {
            availableUnits += result.data.filter((u) => u.status === StockUnitStatus.AVAILABLE).length;
          }
        }
      }

      setStats({ categories: catCount, equipment: eqItems.length, availableUnits });
      setLoading(false);
    }
    void load();
  }, []);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Dashboard" />
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Categories', value: stats?.categories ?? 0 },
              { label: 'Equipment Items', value: stats?.equipment ?? 0 },
              { label: 'Available Units', value: stats?.availableUnits ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg border border-gray-200 p-6">
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
