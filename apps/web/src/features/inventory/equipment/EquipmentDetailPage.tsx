/**
 * @file EquipmentDetailPage.tsx
 * @purpose Equipment detail view with metadata card + tabbed stock units and maintenance
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import ErrorMessage from '@/components/ui/ErrorMessage';
import StockUnitTable from '@/features/inventory/stock-units/StockUnitTable';
import { getEquipment } from '@/lib/api-client';
import { useStockUnits } from '../hooks/use-stock-units';
import type { Equipment } from '@/lib/types';

type Tab = 'units' | 'maintenance';

export default function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [equipment, setEquipment] = useState<Equipment | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<Tab>('units');

  const equipmentId = id ?? '';
  const { units, loading: unitsLoading, error: unitsError, createUnit, updateStatus } = useStockUnits(equipmentId);

  useEffect(() => {
    if (!equipmentId) return;
    setLoading(true);
    getEquipment(equipmentId).then((result) => {
      if (result.ok) setEquipment(result.data);
      else setError(result.error.message);
      setLoading(false);
    });
  }, [equipmentId]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (error !== undefined) {
    return <div className="p-6"><ErrorMessage message={error} /></div>;
  }

  if (equipment === undefined) return null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={equipment.name}
        action={
          <Button variant="secondary" size="sm" onClick={() => navigate('/inventory/equipment')}>
            ← Back
          </Button>
        }
      />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        {/* Metadata card */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Daily Rate</p>
              <p className="font-semibold text-gray-900">${equipment.dailyRate.toFixed(2)}</p>
            </div>
            {equipment.weeklyRate !== undefined && (
              <div>
                <p className="text-gray-500">Weekly Rate</p>
                <p className="font-semibold text-gray-900">${equipment.weeklyRate.toFixed(2)}</p>
              </div>
            )}
            <div>
              <p className="text-gray-500">Status</p>
              <Badge value={equipment.isActive} type="active" />
            </div>
            <div>
              <p className="text-gray-500">Created</p>
              <p className="text-gray-700">{new Date(equipment.createdAt).toLocaleDateString()}</p>
            </div>
            {equipment.description !== undefined && (
              <div className="col-span-2">
                <p className="text-gray-500">Description</p>
                <p className="text-gray-700">{equipment.description}</p>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div>
          <div className="flex border-b border-gray-200 mb-4">
            {(['units', 'maintenance'] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={[
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {tab === 'units' ? 'Stock Units' : 'Maintenance'}
              </button>
            ))}
          </div>

          {activeTab === 'units' && (
            <>
              {unitsLoading && <div className="flex justify-center py-8"><Spinner /></div>}
              {!unitsLoading && unitsError !== undefined && <ErrorMessage message={unitsError} />}
              {!unitsLoading && unitsError === undefined && (
                <StockUnitTable units={units} createUnit={createUnit} updateStatus={updateStatus} />
              )}
            </>
          )}

          {activeTab === 'maintenance' && (
            <div className="text-sm text-gray-500 py-4">
              Maintenance history coming in the next commit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
