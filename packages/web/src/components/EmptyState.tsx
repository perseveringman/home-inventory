import { ReactNode } from 'react';
import { PinIcon, titleIcon } from './PinIcon';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon = 'box', title, description, action }: EmptyStateProps) {
  return (
    <div className="enamel-empty text-center py-16 px-6 bg-white rounded-2xl shadow-soft">
      <PinIcon name={titleIcon(`${icon} ${title}`)} size={86} className="mx-auto mb-3" />
      <h2 className="text-lg font-semibold text-ink-900 mb-2">{title}</h2>
      {description && <p className="text-sm text-ink-500 mb-4">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
