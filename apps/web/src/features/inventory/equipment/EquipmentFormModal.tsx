/**
 * @file EquipmentFormModal.tsx
 * @purpose Form modal for creating or editing equipment
 */
import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import Spinner from '@/components/ui/Spinner';
import { createEquipment, updateEquipment, listCategories } from '@/lib/api-client';
import type { Equipment, Category, CreateEquipmentInput, UpdateEquipmentInput } from '@/lib/types';

interface EquipmentFormModalProps {
  onClose: () => void;
  onSaved: () => void;
  initialValues?: Equipment;
}

export default function EquipmentFormModal({
  onClose,
  onSaved,
  initialValues,
}: EquipmentFormModalProps) {
  const isEdit = initialValues !== undefined;

  const [name, setName] = useState(initialValues?.name ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? '');
  const [dailyRate, setDailyRate] = useState(initialValues?.dailyRate !== undefined ? String(initialValues.dailyRate) : '');
  const [weeklyRate, setWeeklyRate] = useState(initialValues?.weeklyRate !== undefined ? String(initialValues.weeklyRate) : '');
  const [isActive, setIsActive] = useState(initialValues?.isActive ?? true);

  const [categories, setCategories] = useState<Category[]>([]);
  const [catsLoading, setCatsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    listCategories().then((result) => {
      if (result.ok) setCategories(result.data);
      setCatsLoading(false);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    const daily = parseFloat(dailyRate);
    const weekly = weeklyRate.trim() ? parseFloat(weeklyRate) : undefined;

    let result;
    if (isEdit) {
      const input: UpdateEquipmentInput = {
        name: name.trim(),
        categoryId: categoryId || undefined,
        dailyRate: daily,
        isActive,
      };
      if (description.trim()) input.description = description.trim();
      if (weekly !== undefined) input.weeklyRate = weekly;
      result = await updateEquipment(initialValues.id, input);
    } else {
      const input: CreateEquipmentInput = {
        name: name.trim(),
        categoryId,
        dailyRate: daily,
      };
      if (description.trim()) input.description = description.trim();
      if (weekly !== undefined) input.weeklyRate = weekly;
      result = await createEquipment(input);
    }

    setSaving(false);
    if (result.ok) {
      onSaved();
      onClose();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit Equipment' : 'New Equipment'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error !== undefined && <ErrorMessage message={error} />}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="eq-name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="eq-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="eq-desc">
            Description
          </label>
          <textarea
            id="eq-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="eq-category">
            Category <span className="text-red-500">*</span>
          </label>
          {catsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner size={16} /> Loading categories…
            </div>
          ) : (
            <select
              id="eq-category"
              required
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="eq-daily">
              Daily Rate ($) <span className="text-red-500">*</span>
            </label>
            <input
              id="eq-daily"
              type="number"
              required
              min="0"
              step="0.01"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="eq-weekly">
              Weekly Rate ($)
            </label>
            <input
              id="eq-weekly"
              type="number"
              min="0"
              step="0.01"
              value={weeklyRate}
              onChange={(e) => setWeeklyRate(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {isEdit && (
          <div className="flex items-center gap-2">
            <input
              id="eq-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
            />
            <label htmlFor="eq-active" className="text-sm text-gray-700">
              Active
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || name.trim() === '' || categoryId === '' || dailyRate === ''}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Equipment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
