import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { markRecognitionTaskProcessing, runRecognitionTask } from '@home-inventory/core';
import { Scenebar } from './components/Scenebar';
import { Tabbar } from './components/Tabbar';
import { ToastHost } from './components/Toast';
import { ModalHost } from './components/Modal';
import { FabDock } from './components/FabDock';
import { toast } from './components/Toast';
import { initShadowCardBridge } from './lib/shadowCard';
import { installIconHaptics } from './lib/haptics';
import { getStorage, useStore } from './stores/useStore';

import RoomsPage from './pages/storage/RoomsPage';
import RoomDetailPage from './pages/storage/RoomDetailPage';
import PhotoDetailPage from './pages/storage/PhotoDetailPage';
import ItemsPage from './pages/storage/ItemsPage';
import SearchPage from './pages/storage/SearchPage';
import ScanReviewPage from './pages/storage/ScanReviewPage';

import InboxPage from './pages/InboxPage';
import KitchenPage from './pages/KitchenPage';
import KitchenToolsPage from './pages/KitchenToolsPage';
import OverviewPage from './pages/OverviewPage';
import SubscribePage from './pages/SubscribePage';
import LabelsPage from './pages/LabelsPage';
import ListsPage from './pages/ListsPage';
import ListDetailPage from './pages/ListDetailPage';
import SettingsPage from './pages/SettingsPage';

function RecognitionTaskRunner() {
  const recognitionTasks = useStore((s) => s.recognitionTasks);
  const reloadAll = useStore((s) => s.reloadAll);
  const runningTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (runningTaskIdRef.current) return;
    const nextTask = recognitionTasks
      .filter((task) => task.status === 'queued' || task.status === 'processing')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!nextTask) return;

    runningTaskIdRef.current = nextTask.id;
    void (async () => {
      try {
        await markRecognitionTaskProcessing(getStorage(), nextTask.id);
        await reloadAll();
        const finished = await runRecognitionTask(getStorage(), nextTask.id);
        if (finished.status === 'completed') {
          toast(
            finished.source === 'native-items'
              ? '物品资料识别完成，已进入收集箱'
              : '照片识别完成，已进入收集箱',
            3000
          );
        } else if (finished.status === 'failed') {
          toast('识别任务失败，可在待处理页重试', 3000);
        }
      } catch (err) {
        console.error(err);
        toast('识别任务失败，可在待处理页重试', 3000);
      } finally {
        runningTaskIdRef.current = null;
        await reloadAll();
      }
    })();
  }, [recognitionTasks, reloadAll]);

  return null;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const inStorageScene =
    location.pathname === '/' ||
    location.pathname.startsWith('/rooms') ||
    location.pathname.startsWith('/room/') ||
    location.pathname.startsWith('/photo/') ||
    location.pathname.startsWith('/scan/') ||
    location.pathname.startsWith('/kitchen') ||
    location.pathname.startsWith('/items') ||
    location.pathname.startsWith('/search');
  const showFabDock = inStorageScene && !location.pathname.startsWith('/kitchen');

  useEffect(() => initShadowCardBridge(), []);
  useEffect(() => installIconHaptics(), []);

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
      <RecognitionTaskRunner />
      <Scenebar />
      <div className="app-shell max-w-5xl mx-auto pb-20 md:pb-24">
        <Routes>
          <Route path="/" element={<RoomsPage />} />
          <Route path="/rooms" element={<RoomsPage />} />
          <Route path="/room/:id" element={<RoomDetailPage />} />
          <Route path="/photo/:id" element={<PhotoDetailPage />} />
          <Route path="/scan/:id" element={<ScanReviewPage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="/kitchen/tools" element={<KitchenToolsPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/subscribe" element={<SubscribePage />} />
          <Route path="/labels" element={<LabelsPage />} />
          <Route path="/views" element={<ListsPage />} />
          <Route path="/views/list/:id" element={<ListDetailPage />} />
          {/* 兼容旧链接 */}
          <Route path="/tags" element={<Navigate to="/views?tab=lists" replace />} />
          <Route path="/tags/:id" element={<Navigate to="/views?tab=lists" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {showFabDock && <FabDock />}
      {inStorageScene && <Tabbar />}
      <ToastHost />
      <ModalHost />
    </>
  );
}
