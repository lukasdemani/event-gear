/**
 * @file CategoriesPage.tsx
 * @purpose Lists all inventory categories with a create action
 */
import { useState } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { useCategories } from '../hooks/use-categories';
import CategoryFormModal from './CategoryFormModal';

export default function CategoriesPage() {
  const { categories, loading, error, refetch } = useCategories();
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Categories"
        action={
          <Button onClick={() => setShowModal(true)}>+ New Category</Button>
        }
      />

      <div className="flex-1 p-6">
        {loading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

        {!loading && error !== undefined && <ErrorMessage message={error} />}

        {!loading && error === undefined && categories.length === 0 && (
          <EmptyState
            message="No categories yet. Create one to get started."
            action={<Button onClick={() => setShowModal(true)}>+ New Category</Button>}
          />
        )}

        {!loading && error === undefined && categories.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{cat.name}</td>
                    <td className="px-4 py-3 text-gray-500">{cat.description ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {new Date(cat.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <CategoryFormModal
          onClose={() => setShowModal(false)}
          onCreated={refetch}
        />
      )}
    </div>
  );
}
