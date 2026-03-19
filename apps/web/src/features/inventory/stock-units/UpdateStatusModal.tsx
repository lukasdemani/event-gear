/**
 * @file UpdateStatusModal.tsx
 * @purpose Form modal for updating a stock unit's status
 */
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { StockUnitStatus } from '@/lib/types';
import type { StockUnit, UpdateStockUnitStatusInput } from '@/lib/types';

interface UpdateStatusModalProps {
  unit: StockUnit;
  onClose: () => void;
  onUpdate: (unitId: string, input: UpdateStockUnitStatusInput) => Promise<{ ok: boolean; error?: string }>;
}

const statuses = Object.values(StockUnitStatus);
const reasons: UpdateStockUnitStatusInput['reason'][] = ['RESERVATION', 'MAINTENANCE', 'DAMAGE', 'MANUAL'];

export default function UpdateStatusModal({ unit, onClose, onUpdate }: UpdateStatusModalProps) {
  const [status, setStatus] = useState<StockUnitStatus>(unit.status);
  const [reason, setReason] = useState<UpdateStockUnitStatusInput['reason']>('MANUAL');
  const [referenceId, setReferenceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    const input: UpdateStockUnitStatusInput = { status, reason };
    if (referenceId.trim()) input.referenceId = referenceId.trim();

    const result = await onUpdate(unit.id, input);
    setSaving(false);

    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? 'Failed to update status');
    }
  };

  return (
    <Modal title={`Update Status — ${unit.serialNumber}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error !== undefined && <ErrorMessage message={error} />}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="us-status">
            New Status
          </label>
          <select
            id="us-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StockUnitStatus)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="us-reason">
            Reason
          </label>
          <select
            id="us-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as UpdateStockUnitStatusInput['reason'])}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {reasons.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="us-ref">
            Reference ID <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="us-ref"
            type="text"
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
            placeholder="Reservation ID, maintenance record ID, etc."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Updating…' : 'Update Status'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
