import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = '📦', title, description, action }: EmptyStateProps) {
  return (
    <div className="text-center py-16 px-6 bg-white rounded-2xl shadow-soft">
      <div className="text-5xl mb-3">{icon}</div>
      <h2 className="text-lg font-semibold text-ink-900 mb-2">{title}</h2>
      {description && <p className="text-sm text-ink-500 mb-4">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
