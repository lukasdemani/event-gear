/**
 * @file App.tsx
 * @purpose Root application component with routing
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';
import CategoriesPage from '@/features/inventory/categories/CategoriesPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/inventory/equipment" replace />} />
          <Route path="/inventory/categories" element={<CategoriesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
