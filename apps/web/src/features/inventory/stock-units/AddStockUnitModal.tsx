/**
 * @file AddStockUnitModal.tsx
 * @purpose Form modal for adding a new stock unit to equipment
 */
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { EquipmentCondition } from '@/lib/types';
import type { CreateStockUnitInput } from '@/lib/types';

interface AddStockUnitModalProps {
  onClose: () => void;
  onCreate: (input: CreateStockUnitInput) => Promise<{ ok: boolean; error?: string }>;
}

const conditions = Object.values(EquipmentCondition);

export default function AddStockUnitModal({ onClose, onCreate }: AddStockUnitModalProps) {
  const [serialNumber, setSerialNumber] = useState('');
  const [condition, setCondition] = useState<EquipmentCondition>(EquipmentCondition.EXCELLENT);
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    const input: CreateStockUnitInput = {
      serialNumber: serialNumber.trim(),
      condition,
      purchaseDate,
    };
    if (notes.trim()) input.notes = notes.trim();

    const result = await onCreate(input);
    setSaving(false);

    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? 'Failed to create unit');
    }
  };

  return (
    <Modal title="Add Stock Unit" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error !== undefined && <ErrorMessage message={error} />}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="su-serial">
            Serial Number <span className="text-red-500">*</span>
          </label>
          <input
            id="su-serial"
            type="text"
            required
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="su-condition">
            Condition <span className="text-red-500">*</span>
          </label>
          <select
            id="su-condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as EquipmentCondition)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {conditions.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="su-date">
            Purchase Date <span className="text-red-500">*</span>
          </label>
          <input
            id="su-date"
            type="date"
            required
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="su-notes">
            Notes
          </label>
          <textarea
            id="su-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || serialNumber.trim() === '' || purchaseDate === ''}>
            {saving ? 'Adding…' : 'Add Unit'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
