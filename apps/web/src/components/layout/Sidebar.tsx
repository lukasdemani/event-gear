/**
 * @file Sidebar.tsx
 * @purpose Navigation sidebar with EventGear logo and inventory nav links
 */
import { NavLink } from 'react-router-dom';

const navLinks = [
  { to: '/inventory/categories', label: 'Categories' },
  { to: '/inventory/equipment', label: 'Equipment' },
];

export default function Sidebar() {
  return (
    <aside className="w-64 bg-gray-900 flex flex-col shrink-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-white font-bold text-lg tracking-tight">EventGear</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        <p className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Inventory
        </p>
        {navLinks.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'block px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white',
              ].join(' ')
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
