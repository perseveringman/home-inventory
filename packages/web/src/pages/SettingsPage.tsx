import { useRef, useState } from 'react';
import {
  bindSyncDirectory,
  doSyncNow,
  exportZip,
  importZip,
  isFileSystemAccessSupported,
  loadDemoData,
  unbindSyncDirectory,
} from '@home-inventory/core';
import { Header } from '../components/Header';
import { toast } from '../components/Toast';
import { getStorage, useStore } from '../stores/useStore';
import { PinIcon } from '../components/PinIcon';

export default function SettingsPage() {
  const reloadAll = useStore((s) => s.reloadAll);
  const rooms = useStore((s) => s.rooms);
  const photos = useStore((s) => s.photos);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const subs = useStore((s) => s.subscriptions);
  const labels = useStore((s) => s.labels);
  const actionLogs = useStore((s) => s.actionLogs);
  const importRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState('');

  const storageMB = ((photos.reduce((sum, photo) => sum + (photo.blob?.size || 0), 0) + items.reduce((sum, item) => sum + (item.image?.size || 0), 0)) / 1024 / 1024).toFixed(2);

  const clearAll = async () => {
    if (!confirm('确定要清空所有房间、柜子、物品、订阅？此操作不可撤销')) return;
    if (!confirm('再次确认：真的要清空吗？')) return;
    await getStorage().clearAll();
    await reloadAll();
    toast('已清空');
  };

  const downloadZip = async () => {
    setBusy(true);
    try {
      const blob = await exportZip(getStorage());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `home-inventory-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出 ZIP');
    } catch (err: any) {
      toast('导出失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('导入会覆盖当前数据，继续？')) return;
    setBusy(true);
    try {
      await importZip(getStorage(), file, true);
      await reloadAll();
      toast('导入完成');
    } catch (err: any) {
      toast('导入失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    if (rooms.length && !confirm('当前已有数据，加载示例会覆盖。继续？')) return;
    setBusy(true);
    try {
      await loadDemoData(getStorage(), true);
      await reloadAll();
      toast('示例数据加载完成');
    } catch (err: any) {
      toast('加载失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      setBusy(false);
    }
  };

  const bindSync = async () => {
    try {
      await bindSyncDirectory();
      const syncedAt = await doSyncNow(getStorage());
      setLastSync(syncedAt);
      toast('已绑定并同步');
    } catch (err: any) {
      toast(err?.message || '绑定失败', 3000);
    }
  };

  const syncNow = async () => {
    try {
      const syncedAt = await doSyncNow(getStorage());
      setLastSync(syncedAt);
      toast('同步完成');
    } catch (err: any) {
      toast(err?.message || '同步失败', 3000);
    }
  };

  const unbindSync = async () => {
    await unbindSyncDirectory();
    setLastSync('');
    toast('已取消绑定');
  };

  return (
    <div>
      <Header title="设置" />
      <div className="px-4 md:px-6 py-4 space-y-6">
        <section className="bg-white rounded-2xl shadow-soft p-5">
          <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="overview" size={30} />数据概览</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-sm">
            {[
              ['房间', rooms.length],
              ['照片', photos.length],
              ['柜子', cabinets.length],
              ['物品', items.length],
              ['订阅', subs.length],
              ['标签', labels.length],
              ['存储 MB', storageMB],
            ].map(([label, value]) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{value}</div>
                <div className="text-xs text-ink-500">{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5">
          <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="box" size={30} />导入导出 / 示例数据</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button onClick={downloadZip} disabled={busy} className="py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60">导出 ZIP</button>
            <button onClick={() => importRef.current?.click()} disabled={busy} className="py-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-60">导入 ZIP</button>
            <button onClick={loadDemo} disabled={busy} className="py-2.5 rounded-lg bg-brand-500 text-white disabled:opacity-60">加载示例</button>
            <button onClick={clearAll} disabled={busy} className="py-2.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60">清空数据</button>
          </div>
          <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={onImport} />
        </section>

        {isFileSystemAccessSupported() && (
          <section className="bg-white rounded-2xl shadow-soft p-5">
            <h2 className="font-semibold mb-1 inline-flex items-center gap-2"><PinIcon name="folder" size={30} />文件夹同步</h2>
            <p className="text-xs text-ink-500 mb-3">绑定本地文件夹后，数据写入会自动防抖同步；也可以手动立即同步。</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={bindSync} className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm">绑定文件夹</button>
              <button onClick={syncNow} className="px-4 py-2 rounded-lg bg-slate-100 text-sm">立即同步</button>
              <button onClick={unbindSync} className="px-4 py-2 rounded-lg border border-slate-200 text-sm">取消绑定</button>
            </div>
            {lastSync && <div className="text-xs text-ink-500 mt-2">最近同步：{lastSync}</div>}
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-soft p-5">
          <h2 className="font-semibold mb-3 inline-flex items-center gap-2"><PinIcon name="spark" size={30} />AI / 操作日志</h2>
          {actionLogs.length ? (
            <div className="space-y-2 text-sm">
              {actionLogs
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 8)
                .map((log) => (
                  <div key={log.id} className="rounded-xl bg-slate-50 p-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-ink-800">{log.summary}</div>
                      <div className="text-xs text-ink-500 mt-0.5">{log.type} · {log.source}</div>
                    </div>
                    <div className="text-[11px] text-ink-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-sm text-ink-500">还没有可追踪操作。AI 审核、批量归位、标签绑定会记录在这里。</div>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 text-sm text-ink-600 space-y-2">
          <h2 className="font-semibold text-ink-900 inline-flex items-center gap-2"><PinIcon name="book" size={30} />使用指南</h2>
          <p>1. 在房间内上传照片，AI 会先生成扫描审核台；确认候选后才写入柜子和待归位物品。</p>
          <p>2. 待处理页可生成 AI 分拣方案，批量把物品归位到最合适的房间或柜子。</p>
          <p>3. 标签页可生成、打印、扫描二维码标签；二维码只保存稳定标签码，内容从本地数据库读取。</p>
          <p>4. 右下角悬浮按钮支持 AI 对话、快速文字录入、拍照/选图即时识别。</p>
        </section>

        <section className="text-center text-xs text-ink-400 py-4">
          v2.0.0 · React + TS + Tailwind · monorepo
        </section>
      </div>
    </div>
  );
}
