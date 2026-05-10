import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Scenebar } from './components/Scenebar';
import { Tabbar } from './components/Tabbar';
import { ToastHost } from './components/Toast';
import { ModalHost } from './components/Modal';

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
  const inStorageScene =
    location.pathname === '/' ||
    location.pathname.startsWith('/rooms') ||
    location.pathname.startsWith('/room/') ||
    location.pathname.startsWith('/photo/') ||
    location.pathname.startsWith('/items') ||
    location.pathname.startsWith('/search');

  return (
    <>
      <Scenebar />
      <div className="max-w-5xl mx-auto pb-24 md:pb-28">
        <Routes>
          <Route path="/" element={<Navigate to="/rooms" replace />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/room/:id" element={<RoomDetailPage />} />
          <Route path="/photo/:id" element={<PhotoDetailPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/subscribe" element={<SubscribePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/rooms" replace />} />
        </Routes>
      </div>
      {inStorageScene && <Tabbar />}
      <ToastHost />
      <ModalHost />
    </>
  );
}
