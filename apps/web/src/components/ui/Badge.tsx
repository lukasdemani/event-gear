/**
 * @file Badge.tsx
 * @purpose Color-coded badge for StockUnitStatus and EquipmentCondition enum values
 */
import { StockUnitStatus, EquipmentCondition, MaintenanceStatus, MaintenanceType } from '@/lib/types';

const statusColors: Record<StockUnitStatus, string> = {
  [StockUnitStatus.AVAILABLE]: 'bg-green-100 text-green-800',
  [StockUnitStatus.RESERVED]: 'bg-blue-100 text-blue-800',
  [StockUnitStatus.MAINTENANCE]: 'bg-yellow-100 text-yellow-800',
  [StockUnitStatus.DISPATCHED]: 'bg-purple-100 text-purple-800',
  [StockUnitStatus.RETIRED]: 'bg-gray-100 text-gray-600',
};

const conditionColors: Record<EquipmentCondition, string> = {
  [EquipmentCondition.EXCELLENT]: 'bg-green-100 text-green-800',
  [EquipmentCondition.GOOD]: 'bg-teal-100 text-teal-800',
  [EquipmentCondition.FAIR]: 'bg-yellow-100 text-yellow-800',
  [EquipmentCondition.POOR]: 'bg-orange-100 text-orange-800',
  [EquipmentCondition.NEEDS_REPAIR]: 'bg-red-100 text-red-800',
  [EquipmentCondition.RETIRED]: 'bg-gray-100 text-gray-600',
};

const maintenanceStatusColors: Record<MaintenanceStatus, string> = {
  [MaintenanceStatus.SCHEDULED]: 'bg-blue-100 text-blue-800',
  [MaintenanceStatus.IN_PROGRESS]: 'bg-yellow-100 text-yellow-800',
  [MaintenanceStatus.COMPLETED]: 'bg-green-100 text-green-800',
  [MaintenanceStatus.CANCELLED]: 'bg-gray-100 text-gray-600',
};

const maintenanceTypeColors: Record<MaintenanceType, string> = {
  [MaintenanceType.PREVENTIVE]: 'bg-blue-100 text-blue-800',
  [MaintenanceType.REPAIR]: 'bg-red-100 text-red-800',
  [MaintenanceType.INSPECTION]: 'bg-purple-100 text-purple-800',
  [MaintenanceType.CLEANING]: 'bg-teal-100 text-teal-800',
};

interface BadgeProps {
  value: StockUnitStatus | EquipmentCondition | MaintenanceStatus | MaintenanceType | boolean;
  type?: 'status' | 'condition' | 'maintenanceStatus' | 'maintenanceType' | 'active';
}

export default function Badge({ value, type }: BadgeProps) {
  let colorClass = 'bg-gray-100 text-gray-600';
  let label = String(value);

  if (type === 'active' || typeof value === 'boolean') {
    colorClass = value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500';
    label = value ? 'Active' : 'Inactive';
  } else if (type === 'status' || Object.values(StockUnitStatus).includes(value as StockUnitStatus)) {
    colorClass = statusColors[value as StockUnitStatus] ?? colorClass;
  } else if (type === 'condition' || Object.values(EquipmentCondition).includes(value as EquipmentCondition)) {
    colorClass = conditionColors[value as EquipmentCondition] ?? colorClass;
  } else if (type === 'maintenanceStatus' || Object.values(MaintenanceStatus).includes(value as MaintenanceStatus)) {
    colorClass = maintenanceStatusColors[value as MaintenanceStatus] ?? colorClass;
  } else if (type === 'maintenanceType' || Object.values(MaintenanceType).includes(value as MaintenanceType)) {
    colorClass = maintenanceTypeColors[value as MaintenanceType] ?? colorClass;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}
