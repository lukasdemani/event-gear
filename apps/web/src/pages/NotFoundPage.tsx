/**
 * @file NotFoundPage.tsx
 * @purpose 404 page with link back to equipment list
 */
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 text-center">
      <p className="text-6xl font-bold text-gray-200">404</p>
      <p className="mt-3 text-gray-500">Page not found.</p>
      <Link
        to="/inventory/equipment"
        className="mt-6 text-sm text-indigo-600 hover:text-indigo-800 underline"
      >
        Back to Equipment
      </Link>
    </div>
  );
}
