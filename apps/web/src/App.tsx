/**
 * @file App.tsx
 * @purpose Root application component with routing
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import CategoriesPage from '@/features/inventory/categories/CategoriesPage';
import EquipmentListPage from '@/features/inventory/equipment/EquipmentListPage';
import EquipmentDetailPage from '@/features/inventory/equipment/EquipmentDetailPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/inventory/equipment" replace />} />
          <Route path="/inventory/categories" element={<CategoriesPage />} />
          <Route path="/inventory/equipment" element={<EquipmentListPage />} />
          <Route path="/inventory/equipment/:id" element={<EquipmentDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
