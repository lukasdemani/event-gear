/**
 * @file App.tsx
 * @purpose Root application component with routing
 * @ai-notes AppShell wraps all inventory routes via Outlet.
 *   Route / redirects to /inventory/equipment.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from '@/components/layout/AppShell';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/inventory/equipment" replace />} />
          {/* Inventory routes added in later commits */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
