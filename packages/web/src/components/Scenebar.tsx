import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/useStore';
import { computeItemEvents, computeSubscriptionEvents } from '@home-inventory/core';

interface Scene {
  id: string;
  path: string;
  icon: string;
  label: string;
}

const SCENES: Scene[] = [
  { id: 'storage', path: '/rooms', icon: '📦', label: '收纳' },
  { id: 'inbox', path: '/inbox', icon: '📥', label: '待处理' },
  { id: 'overview', path: '/overview', icon: '📊', label: '总览' },
  { id: 'subscribe', path: '/subscribe', icon: '🔔', label: '订阅' },
  { id: 'settings', path: '/settings', icon: '⚙️', label: '设置' },
];

export function Scenebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const items = useStore((s) => s.items);
  const subscriptions = useStore((s) => s.subscriptions);

  const badge = useMemo(() => {
    const pending = items.filter((i) => i.status === 'pending').length;
    const itemCritical = computeItemEvents(items).filter(
      (e) => e.level === 'critical'
    ).length;
    const subCritical = computeSubscriptionEvents(subscriptions).filter(
      (e) => e.level === 'critical'
    ).length;
    return pending + itemCritical + subCritical;
  }, [items, subscriptions]);

  const isActive = (scene: Scene) => {
    const p = location.pathname;
    if (scene.id === 'storage') {
      return (
        p === '/' ||
        p.startsWith('/rooms') ||
        p.startsWith('/room/') ||
        p.startsWith('/photo/') ||
        p.startsWith('/items') ||
        p.startsWith('/search')
      );
    }
    return p.startsWith(scene.path);
  };

  return (
    <nav className="scenebar">
      <div className="max-w-5xl mx-auto flex md:justify-center">
        {SCENES.map((scene) => (
          <button
            key={scene.id}
            className={`scene-btn ${isActive(scene) ? 'active' : ''}`}
            onClick={() => navigate(scene.path)}
          >
            <span className="icon">{scene.icon}</span>
            <span>{scene.label}</span>
            {scene.id === 'inbox' && badge > 0 && (
              <span className="badge">{badge > 99 ? '99+' : badge}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
