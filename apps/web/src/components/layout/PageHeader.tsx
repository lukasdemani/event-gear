/**
 * @file PageHeader.tsx
 * @purpose Page title with optional action slot
 */
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  action?: ReactNode;
}

export default function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
      <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      {action !== undefined && <div>{action}</div>}
    </div>
  );
}
