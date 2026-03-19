/**
 * @file CompleteMaintenanceModal.tsx
 * @purpose Form modal for completing a maintenance record
 */
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { EquipmentCondition } from '@/lib/types';
import type { MaintenanceRecord, CompleteMaintenanceInput } from '@/lib/types';

interface CompleteMaintenanceModalProps {
  record: MaintenanceRecord;
  onClose: () => void;
  onComplete: (recordId: string, input: CompleteMaintenanceInput) => Promise<{ ok: boolean; error?: string }>;
}

const conditions = Object.values(EquipmentCondition);

export default function CompleteMaintenanceModal({
  record,
  onClose,
  onComplete,
}: CompleteMaintenanceModalProps) {
  const [newCondition, setNewCondition] = useState<EquipmentCondition>(EquipmentCondition.GOOD);
  const [notes, setNotes] = useState('');
  const [technicianId, setTechnicianId] = useState(record.technicianId ?? '');
  const [completedDate, setCompletedDate] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    const input: CompleteMaintenanceInput = {
      newCondition,
      notes: notes.trim(),
      completedDate: new Date(completedDate).toISOString(),
      technicianId: technicianId.trim(),
    };

    const result = await onComplete(record.id, input);
    setSaving(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'Failed to complete maintenance');
  };

  return (
    <Modal title="Complete Maintenance" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error !== undefined && <ErrorMessage message={error} />}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cm-condition">
            New Condition <span className="text-red-500">*</span>
          </label>
          <select
            id="cm-condition"
            value={newCondition}
            onChange={(e) => setNewCondition(e.target.value as EquipmentCondition)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {conditions.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cm-notes">
            Completion Notes <span className="text-red-500">*</span>
          </label>
          <textarea
            id="cm-notes"
            rows={3}
            required
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cm-tech">
            Technician ID <span className="text-red-500">*</span>
          </label>
          <input
            id="cm-tech"
            type="text"
            required
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cm-date">
            Completed At <span className="text-red-500">*</span>
          </label>
          <input
            id="cm-date"
            type="datetime-local"
            required
            value={completedDate}
            onChange={(e) => setCompletedDate(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            disabled={saving || notes.trim() === '' || technicianId.trim() === ''}
          >
            {saving ? 'Completing…' : 'Mark Complete'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
