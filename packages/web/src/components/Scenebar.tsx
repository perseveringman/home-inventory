import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/useStore';
import { computeItemEvents, computeSubscriptionEvents } from '@home-inventory/core';
import { PinIcon } from './PinIcon';

interface Scene {
  id: string;
  path: string;
  icon: Parameters<typeof PinIcon>[0]['name'];
  label: string;
}

const SCENES: Scene[] = [
  { id: 'storage', path: '/rooms', icon: 'storage', label: '收纳' },
  { id: 'inbox', path: '/inbox', icon: 'inbox', label: '待处理' },
  { id: 'overview', path: '/overview', icon: 'overview', label: '总览' },
  { id: 'subscribe', path: '/subscribe', icon: 'subscribe', label: '订阅' },
  { id: 'views', path: '/views', icon: 'gallery', label: '视图' },
  { id: 'labels', path: '/labels', icon: 'tag', label: '标签' },
  { id: 'settings', path: '/settings', icon: 'settings', label: '设置' },
];

export function Scenebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const items = useStore((s) => s.items);
  const recognitionTasks = useStore((s) => s.recognitionTasks);
  const scanSessions = useStore((s) => s.scanSessions);
  const subscriptions = useStore((s) => s.subscriptions);

  const badge = useMemo(() => {
    const pending = items.filter((i) => i.status === 'pending').length;
    const queuedRecognition = recognitionTasks.filter(
      (task) => task.status === 'queued' || task.status === 'processing' || task.status === 'failed'
    ).length;
    const reviewing = scanSessions.filter((session) => session.status === 'reviewing').length;
    const itemCritical = computeItemEvents(items).filter(
      (e) => e.level === 'critical'
    ).length;
    const subCritical = computeSubscriptionEvents(subscriptions).filter(
      (e) => e.level === 'critical'
    ).length;
    return queuedRecognition + reviewing + pending + itemCritical + subCritical;
  }, [items, recognitionTasks, scanSessions, subscriptions]);

  const isActive = (scene: Scene) => {
    const p = location.pathname;
    if (scene.id === 'storage') {
      return (
        p === '/' ||
        p.startsWith('/rooms') ||
        p.startsWith('/room/') ||
        p.startsWith('/photo/') ||
        p.startsWith('/scan/') ||
        p.startsWith('/kitchen') ||
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
            aria-label={scene.label}
            title={scene.label}
          >
            <PinIcon name={scene.icon} size={32} className="icon" />
            <span className="scene-label">{scene.label}</span>
            {scene.id === 'inbox' && badge > 0 && (
              <span className="badge">{badge > 99 ? '99+' : badge}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
