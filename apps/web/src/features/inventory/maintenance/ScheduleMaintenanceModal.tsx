/**
 * @file ScheduleMaintenanceModal.tsx
 * @purpose Form modal for scheduling a maintenance record
 */
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { MaintenanceType } from '@/lib/types';
import type { StockUnit, CreateMaintenanceRecordInput } from '@/lib/types';

interface ScheduleMaintenanceModalProps {
  equipmentId: string;
  units: StockUnit[];
  onClose: () => void;
  onSchedule: (input: CreateMaintenanceRecordInput) => Promise<{ ok: boolean; error?: string }>;
}

const maintenanceTypes = Object.values(MaintenanceType);

export default function ScheduleMaintenanceModal({
  equipmentId,
  units,
  onClose,
  onSchedule,
}: ScheduleMaintenanceModalProps) {
  const [unitId, setUnitId] = useState(units.at(0)?.id ?? '');
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>(MaintenanceType.PREVENTIVE);
  const [scheduledDate, setScheduledDate] = useState('');
  const [notes, setNotes] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    const input: CreateMaintenanceRecordInput = {
      equipmentId,
      unitId,
      maintenanceType,
      scheduledDate,
    };
    if (notes.trim()) input.notes = notes.trim();
    if (technicianId.trim()) input.technicianId = technicianId.trim();

    const result = await onSchedule(input);
    setSaving(false);
    if (result.ok) onClose();
    else setError(result.error ?? 'Failed to schedule maintenance');
  };

  return (
    <Modal title="Schedule Maintenance" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error !== undefined && <ErrorMessage message={error} />}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="sm-unit">
            Stock Unit <span className="text-red-500">*</span>
          </label>
          <select
            id="sm-unit"
            required
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Select a unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.serialNumber}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="sm-type">
            Type <span className="text-red-500">*</span>
          </label>
          <select
            id="sm-type"
            value={maintenanceType}
            onChange={(e) => setMaintenanceType(e.target.value as MaintenanceType)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {maintenanceTypes.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="sm-date">
            Scheduled Date <span className="text-red-500">*</span>
          </label>
          <input
            id="sm-date"
            type="date"
            required
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="sm-tech">
            Technician ID
          </label>
          <input
            id="sm-tech"
            type="text"
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="sm-notes">
            Notes
          </label>
          <textarea
            id="sm-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || unitId === '' || scheduledDate === ''}>
            {saving ? 'Scheduling…' : 'Schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
