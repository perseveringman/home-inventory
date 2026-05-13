import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Scenebar } from './components/Scenebar';
import { Tabbar } from './components/Tabbar';
import { ToastHost } from './components/Toast';
import { ModalHost } from './components/Modal';
import { FabDock } from './components/FabDock';
import { toast } from './components/Toast';
import { initShadowCardBridge } from './lib/shadowCard';

import RoomsPage from './pages/storage/RoomsPage';
import RoomDetailPage from './pages/storage/RoomDetailPage';
import PhotoDetailPage from './pages/storage/PhotoDetailPage';
import ItemsPage from './pages/storage/ItemsPage';
import SearchPage from './pages/storage/SearchPage';

import InboxPage from './pages/InboxPage';
import OverviewPage from './pages/OverviewPage';
import SubscribePage from './pages/SubscribePage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const inStorageScene =
    location.pathname === '/' ||
    location.pathname.startsWith('/rooms') ||
    location.pathname.startsWith('/room/') ||
    location.pathname.startsWith('/photo/') ||
    location.pathname.startsWith('/items') ||
    location.pathname.startsWith('/search');

  useEffect(() => initShadowCardBridge(), []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shadowOAuthStatus = params.get('shadow_oauth');
    if (!shadowOAuthStatus) return;

    params.delete('shadow_oauth');
    if (shadowOAuthStatus === 'connected') {
      toast('Shadow 已连接');
    } else if (shadowOAuthStatus === 'denied') {
      toast('已取消 Shadow 授权');
    } else {
      toast('Shadow 授权未完成，请重试');
    }

    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  return (
    <>
      <Scenebar />
      <div className="app-shell max-w-5xl mx-auto pb-20 md:pb-24">
        <Routes>
          <Route path="/" element={<RoomsPage />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/room/:id" element={<RoomDetailPage />} />
          <Route path="/photo/:id" element={<PhotoDetailPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/subscribe" element={<SubscribePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {inStorageScene && <FabDock />}
      {inStorageScene && <Tabbar />}
      <ToastHost />
      <ModalHost />
    </>
  );
}
