import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../stores/useStore';
import { computeItemEvents, computeSubscriptionEvents } from '@home-inventory/core';
import { PinIcon } from './PinIcon';
import { toast } from './Toast';

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
  { id: 'labels', path: '/labels', icon: 'tag', label: '标签' },
  { id: 'settings', path: '/settings', icon: 'settings', label: '设置' },
];

export function Scenebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const items = useStore((s) => s.items);
  const scanSessions = useStore((s) => s.scanSessions);
  const subscriptions = useStore((s) => s.subscriptions);
  const homes = useStore((s) => s.homes);
  const currentHomeId = useStore((s) => s.currentHomeId);
  const currentHome = useStore((s) => s.currentHome);
  const switchHome = useStore((s) => s.switchHome);
  const createHome = useStore((s) => s.createHome);
  const [switching, setSwitching] = useState(false);

  const badge = useMemo(() => {
    const pending = items.filter((i) => i.status === 'pending').length;
    const reviewing = scanSessions.filter((session) => session.status === 'reviewing').length;
    const itemCritical = computeItemEvents(items).filter(
      (e) => e.level === 'critical'
    ).length;
    const subCritical = computeSubscriptionEvents(subscriptions).filter(
      (e) => e.level === 'critical'
    ).length;
    return reviewing + pending + itemCritical + subCritical;
  }, [items, scanSessions, subscriptions]);

  const isActive = (scene: Scene) => {
    const p = location.pathname;
    if (scene.id === 'storage') {
      return (
        p === '/' ||
        p.startsWith('/rooms') ||
        p.startsWith('/room/') ||
        p.startsWith('/photo/') ||
        p.startsWith('/scan/') ||
        p.startsWith('/items') ||
        p.startsWith('/search')
      );
    }
    return p.startsWith(scene.path);
  };

  const onHomeChange = async (value: string) => {
    if (!value || switching) return;
    setSwitching(true);
    try {
      if (value === '__new__') {
        const name = prompt('给新 home 起个名字', '我的家')?.trim();
        if (!name) return;
        await createHome(name);
        navigate('/rooms');
        toast('已创建新 home');
        return;
      }
      await switchHome(value);
      navigate('/rooms');
      toast('已切换 home');
    } catch (err: any) {
      toast(err?.message || '切换失败', 3000);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <nav className="scenebar">
      <div className="scenebar-inner max-w-5xl mx-auto">
        <div className="home-switcher">
          <span className="home-dot" aria-hidden />
          <select
            value={currentHomeId}
            disabled={switching}
            onChange={(event) => onHomeChange(event.target.value)}
            aria-label="切换 home"
          >
            {homes.map((home) => (
              <option key={home.id} value={home.id}>
                {home.kind === 'demo' ? '示例 · ' : ''}{home.name}
              </option>
            ))}
            <option value="__new__">+ 新建 home</option>
          </select>
          {currentHome?.kind === 'demo' && <span className="home-kind">示例</span>}
        </div>
        <div className="scene-list">
          {SCENES.map((scene) => (
            <button
              key={scene.id}
              className={`scene-btn ${isActive(scene) ? 'active' : ''}`}
              onClick={() => navigate(scene.path)}
            >
              <PinIcon name={scene.icon} size={32} className="icon" />
              <span>{scene.label}</span>
              {scene.id === 'inbox' && badge > 0 && (
                <span className="badge">{badge > 99 ? '99+' : badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
