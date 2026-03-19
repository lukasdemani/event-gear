/**
 * @file EquipmentListPage.tsx
 * @purpose Paginated list of all equipment with create and edit actions
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { useEquipment } from '../hooks/use-equipment';
import EquipmentFormModal from './EquipmentFormModal';
import type { Equipment } from '@/lib/types';

export default function EquipmentListPage() {
  const { equipment, loading, error, nextToken, refetch, loadMore } = useEquipment();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Equipment | undefined>(undefined);
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Equipment"
        action={
          <Button onClick={() => setShowCreate(true)}>+ New Equipment</Button>
        }
      />

      <div className="flex-1 p-6 overflow-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

        {!loading && error !== undefined && <ErrorMessage message={error} />}

        {!loading && error === undefined && equipment.length === 0 && (
          <EmptyState
            message="No equipment yet. Add your first item."
            action={<Button onClick={() => setShowCreate(true)}>+ New Equipment</Button>}
          />
        )}

        {!loading && error === undefined && equipment.length > 0 && (
          <>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Daily Rate</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {equipment.map((eq) => (
                    <tr key={eq.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{eq.name}</td>
                      <td className="px-4 py-3 text-gray-600">${eq.dailyRate.toFixed(2)}/day</td>
                      <td className="px-4 py-3">
                        <Badge value={eq.isActive} type="active" />
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {new Date(eq.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditing(eq)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => navigate(`/inventory/equipment/${eq.id}`)}
                          >
                            View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nextToken !== undefined && (
              <div className="flex justify-center mt-4">
                <Button variant="secondary" onClick={loadMore}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <EquipmentFormModal
          onClose={() => setShowCreate(false)}
          onSaved={refetch}
        />
      )}

      {editing !== undefined && (
        <EquipmentFormModal
          onClose={() => setEditing(undefined)}
          onSaved={refetch}
          initialValues={editing}
        />
      )}
    </div>
  );
}
