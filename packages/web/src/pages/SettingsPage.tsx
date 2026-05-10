import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { toast } from '../components/Toast';
import { getStorage, useStore } from '../stores/useStore';
import { getConfig, setConfig } from '@home-inventory/core';

export default function SettingsPage() {
  const reloadAll = useStore((s) => s.reloadAll);
  const rooms = useStore((s) => s.rooms);
  const items = useStore((s) => s.items);
  const subs = useStore((s) => s.subscriptions);

  const [openrouterKey, setOpenrouterKey] = useState('');
  const [openrouterModel, setOpenrouterModel] = useState('google/gemini-2.5-flash');
  const [claudeKey, setClaudeKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const storage = getStorage();
    (async () => {
      setOpenrouterKey(await getConfig(storage, 'openrouterKey', ''));
      setOpenrouterModel(
        await getConfig(storage, 'openrouterModel', 'google/gemini-2.5-flash')
      );
      setClaudeKey(await getConfig(storage, 'claudeKey', ''));
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const storage = getStorage();
    await setConfig(storage, 'openrouterKey', openrouterKey.trim());
    await setConfig(storage, 'openrouterModel', openrouterModel.trim());
    await setConfig(storage, 'claudeKey', claudeKey.trim());
    setSaving(false);
    toast('已保存');
  };

  const clearAll = async () => {
    if (!confirm('确定要清空所有房间、柜子、物品、订阅？此操作不可撤销')) return;
    if (!confirm('再次确认：真的要清空吗？')) return;
    await getStorage().clearAll();
    await reloadAll();
    toast('已清空');
  };

  return (
    <div>
      <Header title="⚙️ 设置" />
      <div className="px-4 md:px-6 py-4 space-y-6">
        <section className="bg-white rounded-2xl shadow-soft p-5">
          <h2 className="font-semibold mb-1">🤖 AI 识别</h2>
          <p className="text-xs text-ink-500 mb-3">
            配置任一即可，优先使用 OpenRouter / Gemini；未配置时走本地启发式占位。
          </p>

          <label className="block text-sm font-medium mb-1 mt-3">
            OpenRouter API Key
          </label>
          <input
            value={openrouterKey}
            onChange={(e) => setOpenrouterKey(e.target.value)}
            type="password"
            placeholder="sk-or-v1-..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />

          <label className="block text-sm font-medium mb-1 mt-3">模型</label>
          <input
            value={openrouterModel}
            onChange={(e) => setOpenrouterModel(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />

          <label className="block text-sm font-medium mb-1 mt-3">
            Claude API Key（备选）
          </label>
          <input
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            type="password"
            placeholder="sk-ant-..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2"
          />

          <button
            onClick={save}
            disabled={saving}
            className="mt-4 w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg"
          >
            {saving ? '保存中…' : '保存设置'}
          </button>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5">
          <h2 className="font-semibold mb-3">📊 数据概览</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold">{rooms.length}</div>
              <div className="text-xs text-ink-500">房间</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold">{items.length}</div>
              <div className="text-xs text-ink-500">物品</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold">{subs.length}</div>
              <div className="text-xs text-ink-500">订阅</div>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5">
          <h2 className="font-semibold mb-3">⚠️ 危险操作</h2>
          <button
            onClick={clearAll}
            className="w-full py-2.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
          >
            清空所有数据
          </button>
        </section>

        <section className="text-center text-xs text-ink-400 py-4">
          v2.0.0 · React + TS + Tailwind · monorepo
        </section>
      </div>
    </div>
  );
}
