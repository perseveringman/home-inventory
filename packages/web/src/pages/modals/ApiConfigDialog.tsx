import { useEffect, useState } from 'react';
import { getConfig, setConfig, testTextAI } from '@home-inventory/core';
import { getStorage } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { PinIcon } from '../../components/PinIcon';

interface Props {
  onClose: () => void;
}

export default function ApiConfigDialog({ onClose }: Props) {
  const storage = getStorage();
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [openrouterModel, setOpenrouterModel] = useState('google/gemini-2.5-flash');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-v4-flash');
  const [claudeKey, setClaudeKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setOpenrouterKey(await getConfig(storage, 'openrouterKey', ''));
      setOpenrouterModel(await getConfig(storage, 'openrouterModel', 'google/gemini-2.5-flash'));
      setDeepseekKey(await getConfig(storage, 'deepseekKey', ''));
      setDeepseekModel(await getConfig(storage, 'deepseekModel', 'deepseek-v4-flash'));
      setClaudeKey(await getConfig(storage, 'claudeKey', ''));
    })();
  }, [storage]);

  const save = async () => {
    setSaving(true);
    try {
      await setConfig(storage, 'openrouterKey', openrouterKey.trim());
      await setConfig(storage, 'openrouterModel', openrouterModel.trim());
      await setConfig(storage, 'deepseekKey', deepseekKey.trim());
      await setConfig(storage, 'deepseekModel', deepseekModel.trim());
      await setConfig(storage, 'claudeKey', claudeKey.trim());
      toast('API 配置已保存');
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: 'deepseek' | 'openrouter') => {
    await save();
    try {
      toast('正在测试连接…');
      await testTextAI(storage, provider);
      toast('连接正常');
    } catch (err: any) {
      toast(err?.message || '测试失败', 3000);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold inline-flex items-center gap-2"><PinIcon name="ai" size={30} />API 配置</h3>
          <p className="text-xs text-ink-500 mt-0.5">OpenRouter 用于视觉识别和聊天，DeepSeek 用于文本对话，Claude 作为视觉备选。</p>
        </div>
        <button onClick={onClose} className="text-xl text-ink-500">×</button>
      </div>
      <div className="space-y-4">
        <section className="rounded-xl bg-slate-50 p-3">
          <div className="font-medium text-sm mb-2">OpenRouter / Gemini</div>
          <input value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)} type="password" placeholder="sk-or-v1-..." className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2" />
          <input value={openrouterModel} onChange={(e) => setOpenrouterModel(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2" />
          <button onClick={() => test('openrouter')} className="text-xs px-3 py-1.5 rounded bg-white border border-slate-200">测试 OpenRouter</button>
        </section>
        <section className="rounded-xl bg-slate-50 p-3">
          <div className="font-medium text-sm mb-2">DeepSeek 文本对话</div>
          <input value={deepseekKey} onChange={(e) => setDeepseekKey(e.target.value)} type="password" placeholder="sk-..." className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2" />
          <input value={deepseekModel} onChange={(e) => setDeepseekModel(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2" />
          <button onClick={() => test('deepseek')} className="text-xs px-3 py-1.5 rounded bg-white border border-slate-200">测试 DeepSeek</button>
        </section>
        <section className="rounded-xl bg-slate-50 p-3">
          <div className="font-medium text-sm mb-2">Claude Vision（备选）</div>
          <input value={claudeKey} onChange={(e) => setClaudeKey(e.target.value)} type="password" placeholder="sk-ant-..." className="w-full border border-slate-200 rounded-lg px-3 py-2" />
          <div className="text-xs text-ink-500 mt-2">Claude 连通性会在照片识别时验证。</div>
        </section>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200">关闭</button>
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-brand-500 text-white disabled:bg-ink-300">{saving ? '保存中…' : '保存'}</button>
      </div>
    </div>
  );
}
