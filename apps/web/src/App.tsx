/**
 * @file App.tsx
 * @purpose Root application component with routing
 * @ai-notes Add routes here as domains are built out. Each domain gets its own route subtree.
 */
import { BrowserRouter, Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>EventGear — Coming Soon</div>} />
        {/* TODO: Add domain routes as they are built */}
        {/* <Route path="/inventory/*" element={<InventoryRoutes />} /> */}
        {/* <Route path="/reservations/*" element={<ReservationRoutes />} /> */}
        {/* <Route path="/logistics/*" element={<LogisticsRoutes />} /> */}
        {/* <Route path="/billing/*" element={<BillingRoutes />} /> */}
        {/* <Route path="/assistant" element={<AIAssistant />} /> */}
      </Routes>
    </BrowserRouter>
  );
}
