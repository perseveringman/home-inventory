import { useEffect, useState } from 'react';
import { getConfig, setConfig, testTextAI } from '@home-inventory/core';
import { getStorage } from '../../stores/useStore';
import { toast } from '../../components/Toast';
import { PinIcon } from '../../components/PinIcon';

interface Props {
  onClose: () => void;
}

interface BackendStatus {
  openrouter: boolean;
  deepseek: boolean;
  claude: boolean;
  openrouterModel: string;
  deepseekModel: string;
  claudeModel: string;
}

const STATUS_STYLE: Record<'on' | 'off', string> = {
  on: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  off: 'bg-amber-50 text-amber-700 border-amber-100',
};

function StatusBadge({ active }: { active?: boolean }) {
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[active ? 'on' : 'off']}`}>
      {active ? '后端已配置' : '环境变量缺失'}
    </span>
  );
}

export default function ApiConfigDialog({ onClose }: Props) {
  const storage = getStorage();
  const [openrouterModel, setOpenrouterModel] = useState('');
  const [deepseekModel, setDeepseekModel] = useState('');
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/ai/status');
      if (!res.ok) throw new Error(await res.text());
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    (async () => {
      setOpenrouterModel(await getConfig(storage, 'openrouterModel', ''));
      setDeepseekModel(await getConfig(storage, 'deepseekModel', ''));
      loadStatus();
    })();
  }, [storage]);

  const save = async () => {
    setSaving(true);
    try {
      await setConfig(storage, 'openrouterModel', openrouterModel.trim());
      await setConfig(storage, 'deepseekModel', deepseekModel.trim());
      toast('模型配置已保存');
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: 'deepseek' | 'openrouter') => {
    await save();
    try {
      toast('正在测试后端连接…');
      await testTextAI(storage, provider);
      toast('后端连接正常');
      await loadStatus();
    } catch (err: any) {
      toast(err?.message || '测试失败', 3000);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold inline-flex items-center gap-2"><PinIcon name="ai" size={30} />AI 后端配置</h3>
          <p className="text-xs text-ink-500 mt-0.5">API Key 只从 Vercel 环境变量读取，浏览器不再保存密钥。</p>
        </div>
        <button onClick={onClose} className="text-xl text-ink-500">×</button>
      </div>

      <div className="rounded-xl bg-brand-50 border border-brand-100 p-3 text-xs text-brand-700 mb-4">
        在 Vercel 项目里配置 <code>OPENROUTER_API_KEY</code>、<code>DEEPSEEK_API_KEY</code>、<code>ANTHROPIC_API_KEY</code>。
        模型名可以放环境变量，也可以在这里用非敏感配置覆盖。
      </div>

      <div className="space-y-4">
        <section className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="font-medium text-sm">OpenRouter / Gemini</div>
            <StatusBadge active={status?.openrouter} />
          </div>
          <input
            value={openrouterModel}
            onChange={(e) => setOpenrouterModel(e.target.value)}
            placeholder={status?.openrouterModel || 'google/gemini-2.5-flash'}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2"
          />
          <button onClick={() => test('openrouter')} className="text-xs px-3 py-1.5 rounded bg-white border border-slate-200">测试 OpenRouter 后端</button>
        </section>

        <section className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="font-medium text-sm">DeepSeek 文本对话</div>
            <StatusBadge active={status?.deepseek} />
          </div>
          <input
            value={deepseekModel}
            onChange={(e) => setDeepseekModel(e.target.value)}
            placeholder={status?.deepseekModel || 'deepseek-v4-flash'}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 mb-2"
          />
          <button onClick={() => test('deepseek')} className="text-xs px-3 py-1.5 rounded bg-white border border-slate-200">测试 DeepSeek 后端</button>
        </section>

        <section className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="font-medium text-sm">Claude Vision（备选）</div>
            <StatusBadge active={status?.claude} />
          </div>
          <div className="text-xs text-ink-500">
            当前模型：{status?.claudeModel || 'claude-sonnet-4-20250514'}。Claude 会在照片识别失败时自动作为备选。
          </div>
        </section>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200">关闭</button>
        <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg bg-brand-500 text-white disabled:bg-ink-300">{saving ? '保存中…' : '保存模型名'}</button>
      </div>
    </div>
  );
}
