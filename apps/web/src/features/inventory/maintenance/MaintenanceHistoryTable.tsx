/**
 * @file MaintenanceHistoryTable.tsx
 * @purpose Table of maintenance records with schedule and complete actions
 */
import { useState } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import ScheduleMaintenanceModal from './ScheduleMaintenanceModal';
import CompleteMaintenanceModal from './CompleteMaintenanceModal';
import { MaintenanceStatus } from '@/lib/types';
import type {
  MaintenanceRecord,
  StockUnit,
  CreateMaintenanceRecordInput,
  CompleteMaintenanceInput,
} from '@/lib/types';

interface MaintenanceHistoryTableProps {
  records: MaintenanceRecord[];
  equipmentId: string;
  units: StockUnit[];
  scheduleRecord: (input: CreateMaintenanceRecordInput) => Promise<{ ok: boolean; error?: string }>;
  completeRecord: (recordId: string, input: CompleteMaintenanceInput) => Promise<{ ok: boolean; error?: string }>;
}

export default function MaintenanceHistoryTable({
  records,
  equipmentId,
  units,
  scheduleRecord,
  completeRecord,
}: MaintenanceHistoryTableProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [completing, setCompleting] = useState<MaintenanceRecord | undefined>(undefined);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          {records.length} record{records.length !== 1 ? 's' : ''}
        </h3>
        <Button size="sm" onClick={() => setShowSchedule(true)}>+ Schedule</Button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          message="No maintenance records yet."
          action={<Button size="sm" onClick={() => setShowSchedule(true)}>+ Schedule Maintenance</Button>}
        />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Scheduled</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Completed</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Technician</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((rec) => (
                <tr key={rec.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Badge value={rec.maintenanceType} type="maintenanceType" />
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={rec.status} type="maintenanceStatus" />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{rec.scheduledDate}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {rec.completedDate !== undefined
                      ? new Date(rec.completedDate).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{rec.technicianId ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {rec.status === MaintenanceStatus.SCHEDULED ||
                    rec.status === MaintenanceStatus.IN_PROGRESS ? (
                      <Button size="sm" variant="secondary" onClick={() => setCompleting(rec)}>
                        Complete
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSchedule && (
        <ScheduleMaintenanceModal
          equipmentId={equipmentId}
          units={units}
          onClose={() => setShowSchedule(false)}
          onSchedule={scheduleRecord}
        />
      )}

      {completing !== undefined && (
        <CompleteMaintenanceModal
          record={completing}
          onClose={() => setCompleting(undefined)}
          onComplete={completeRecord}
        />
      )}
    </div>
  );
}
