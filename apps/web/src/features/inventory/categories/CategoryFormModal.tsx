/**
 * @file CategoryFormModal.tsx
 * @purpose Form modal for creating a new category
 */
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { createCategory } from '@/lib/api-client';
import type { CreateCategoryInput } from '@/lib/types';

interface CategoryFormModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export default function CategoryFormModal({ onClose, onCreated }: CategoryFormModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);

    const input: CreateCategoryInput = { name: name.trim() };
    if (description.trim()) input.description = description.trim();

    const result = await createCategory(input);
    setSaving(false);

    if (result.ok) {
      onCreated();
      onClose();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <Modal title="New Category" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error !== undefined && <ErrorMessage message={error} />}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cat-name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="cat-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Audio Systems"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="cat-desc">
            Description
          </label>
          <textarea
            id="cat-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Optional description"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || name.trim() === ''}>
            {saving ? 'Creating…' : 'Create Category'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
