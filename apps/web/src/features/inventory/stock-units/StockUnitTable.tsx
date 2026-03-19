/**
 * @file StockUnitTable.tsx
 * @purpose Table displaying stock units with status/condition badges and actions
 */
import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import AddStockUnitModal from './AddStockUnitModal';
import UpdateStatusModal from './UpdateStatusModal';
import type { StockUnit, CreateStockUnitInput, UpdateStockUnitStatusInput } from '@/lib/types';

interface StockUnitTableProps {
  units: StockUnit[];
  createUnit: (input: CreateStockUnitInput) => Promise<{ ok: boolean; error?: string }>;
  updateStatus: (unitId: string, input: UpdateStockUnitStatusInput) => Promise<{ ok: boolean; error?: string }>;
}

export default function StockUnitTable({ units, createUnit, updateStatus }: StockUnitTableProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [updating, setUpdating] = useState<StockUnit | undefined>(undefined);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {units.length} unit{units.length !== 1 ? 's' : ''}
        </h3>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Unit</Button>
      </div>

      {units.length === 0 ? (
        <EmptyState
          message="No stock units yet."
          action={<Button size="sm" onClick={() => setShowAdd(true)}>+ Add Unit</Button>}
        />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Serial</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Condition</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Purchased</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {units.map((unit) => (
                <tr key={unit.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-900">{unit.serialNumber}</td>
                  <td className="px-4 py-3">
                    <Badge value={unit.condition} type="condition" />
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={unit.status} type="status" />
                  </td>
                  <td className="px-4 py-3 text-gray-400">{unit.purchaseDate}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setUpdating(unit)}>
                      Update Status
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddStockUnitModal onClose={() => setShowAdd(false)} onCreate={createUnit} />
      )}

      {updating !== undefined && (
        <UpdateStatusModal
          unit={updating}
          onClose={() => setUpdating(undefined)}
          onUpdate={updateStatus}
        />
      )}
    </div>
  );
}
