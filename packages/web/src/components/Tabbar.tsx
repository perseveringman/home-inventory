import { useLocation, useNavigate } from 'react-router-dom';
import { PinIcon } from './PinIcon';

interface Tab {
  path: string;
  label: string;
  icon: Parameters<typeof PinIcon>[0]['name'];
  match?: (p: string) => boolean;
}

const TABS: Tab[] = [
  {
    path: '/rooms',
    label: '房间',
    icon: 'room',
    match: (p) =>
      p === '/' ||
      p.startsWith('/rooms') ||
      p.startsWith('/room/') ||
      p.startsWith('/photo/') ||
      p.startsWith('/scan/'),
  },
  { path: '/items', label: '物品', icon: 'items' },
  { path: '/search', label: '搜索', icon: 'search' },
];

export function Tabbar() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <nav className="tabbar">
      <div className="max-w-5xl mx-auto flex md:justify-center md:gap-2 md:border md:rounded-2xl md:bg-white md:shadow-soft md:p-1">
        {TABS.map((t) => {
          const active = t.match
            ? t.match(location.pathname)
            : location.pathname.startsWith(t.path);
          return (
            <button
              key={t.path}
              onClick={() => navigate(t.path)}
              className={`flex-1 md:flex-none md:px-6 py-3 md:py-2 md:rounded-xl text-sm font-medium ${
                active ? 'text-brand-600 md:bg-brand-50' : 'text-ink-500'
              }`}
            >
              <PinIcon name={t.icon} size={22} className="tab-icon" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
