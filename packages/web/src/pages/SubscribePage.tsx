import { useMemo, useRef, useState } from 'react';
import {
  SUB_CATEGORIES,
  applySubscriptionActionPlan,
  advanceSubDue,
  buildChatSystemPrompt,
  buildSubscriptionImportPlanFromCsv,
  buildSubscriptionImportPlanFromText,
  buildSubscriptionImportPrompt,
  buildSubscriptionInsights,
  extractSubscriptionActionPlan,
  findDuplicateSubscriptions,
  previewSubscriptionAction,
  recognizeSubscriptionBillImage,
  streamChatWithAI,
  stripSubscriptionActionBlock,
  subscriptionMonthlyCost,
  type Subscription,
  type SubscriptionActionPlan,
} from '@home-inventory/core';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { openModal } from '../components/Modal';
import { toast } from '../components/Toast';
import { getStorage, useStore } from '../stores/useStore';
import SubscriptionDialog from './modals/SubscriptionDialog';
import { PinIcon } from '../components/PinIcon';
import { Glyph } from '../components/Glyph';

const CAT_MAP = Object.fromEntries(SUB_CATEGORIES.map((c) => [c.id, c]));
const INSIGHT_TONE_CLASS = {
  critical: 'bg-clay-50 text-clay-700 border-clay-100',
  warn: 'bg-amber-50 text-amber-700 border-amber-100',
  info: 'bg-brand-50 text-brand-700 border-brand-100',
  good: 'bg-emerald-50 text-emerald-700 border-emerald-100',
} as const;
const PREVIEW_TONE_CLASS = {
  neutral: 'bg-white border-ink-200/70',
  save: 'bg-emerald-50 border-emerald-100',
  warn: 'bg-amber-50 border-amber-100',
} as const;

function daysLeft(dateStr?: string) {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59').getTime();
  if (isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / (24 * 3600 * 1000));
}

function SubCard({ sub, onEdit, onPaid, onPause, onDelete }: {
  sub: Subscription;
  onEdit: (s: Subscription) => void;
  onPaid: (s: Subscription) => void;
  onPause: (s: Subscription) => void;
  onDelete: (s: Subscription) => void;
}) {
  const cat = CAT_MAP[sub.category] || { name: '其他' };
  const dLeft = daysLeft(sub.nextDueAt);
  const dueLabel = dLeft == null ? '未设定' : dLeft < 0 ? `逾期 ${-dLeft} 天` : dLeft === 0 ? '今天扣款' : `${dLeft} 天后`;
  const dueCls = dLeft == null ? 'text-ink-400' : dLeft <= 3 ? 'text-clay-600' : dLeft <= 7 ? 'text-amber-600' : 'text-ink-500';
  const isPaused = sub.status !== 'active';
  const lastPrice = sub.priceHistory?.slice(-2);
  const hasPriceHistory = !!lastPrice && lastPrice.length >= 2;
  return (
    <li className={`bg-white rounded-2xl shadow-soft p-4 flex items-center gap-3 ${isPaused ? 'opacity-70' : ''}`}>
      <PinIcon name="subscribe" size={44} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[15px] text-ink-900 truncate">{sub.name}</span>
          {isPaused && <span className="chip">{sub.status === 'paused' ? '暂停' : '已取消'}</span>}
          {sub.autoRenew === false && <span className="chip">不续费</span>}
          {sub.decision && <span className="chip">{sub.decision === 'keep' ? '保留' : sub.decision === 'cancel' ? '倾向取消' : '待复核'}</span>}
        </div>
        <div className="text-[11.5px] text-ink-500 mt-1 tabular-nums">
          {cat.name} · {sub.planName ? `${sub.planName} · ` : ''}¥{sub.amount.toFixed(2)} / {sub.cycle}
        </div>
        <div className={`text-[11.5px] mt-0.5 tabular-nums ${dueCls}`}>{dueLabel}</div>
        {(sub.usageNote || hasPriceHistory || sub.cancelUrl) && (
          <div className="text-[11px] text-ink-400 mt-0.5 truncate">
            {sub.usageNote || (hasPriceHistory ? `价格记录 ${lastPrice!.map((p) => `¥${p.amount}`).join(' → ')}` : '已记录退订链接')}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {sub.status === 'active' && (
          <button onClick={() => onPaid(sub)} className="bg-brand-500 hover:bg-brand-600 text-white text-[11.5px] px-2.5 py-1 rounded-full">已付</button>
        )}
        <button onClick={() => onEdit(sub)} className="text-[11.5px] text-ink-500 hover:text-ink-900 px-2 py-0.5">编辑</button>
        <button onClick={() => onPause(sub)} className="text-[11.5px] text-ink-500 hover:text-ink-900 px-2 py-0.5">{sub.status === 'active' ? '暂停' : '恢复'}</button>
        <button onClick={() => onDelete(sub)} className="text-[11.5px] text-clay-600 hover:text-clay-700 px-2 py-0.5">删除</button>
      </div>
    </li>
  );
}

export default function SubscribePage() {
  const rooms = useStore((s) => s.rooms);
  const cabinets = useStore((s) => s.cabinets);
  const items = useStore((s) => s.items);
  const subs = useStore((s) => s.subscriptions);
  const put = useStore((s) => s.put);
  const del = useStore((s) => s.del);
  const reloadAll = useStore((s) => s.reloadAll);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotAnswer, setCopilotAnswer] = useState('');
  const [copilotPlan, setCopilotPlan] = useState<SubscriptionActionPlan | null>(null);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const active = subs.filter((s) => s.status === 'active');
  const paused = subs.filter((s) => s.status !== 'active');
  const monthTotal = useMemo(() => active.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0), [active]);
  const insights = useMemo(() => buildSubscriptionInsights(subs), [subs]);
  const duplicateGroups = useMemo(() => findDuplicateSubscriptions(subs).slice(0, 3), [subs]);
  const systemPrompt = useMemo(
    () =>
      buildChatSystemPrompt(rooms, cabinets, items, subs, {
        currentPath: '/subscribe',
        today: new Date().toISOString().slice(0, 10),
      }),
    [rooms, cabinets, items, subs]
  );
  const categoryDist = useMemo(() => {
    const map = new Map<string, number>();
    for (const sub of active) map.set(sub.category, (map.get(sub.category) || 0) + subscriptionMonthlyCost(sub));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [active]);
  const sortedActive = useMemo(() => active.slice().sort((a, b) => (new Date(a.nextDueAt || '2999-01-01').getTime() - new Date(b.nextDueAt || '2999-01-01').getTime())), [active]);

  const addSub = () => openModal((close) => <SubscriptionDialog onClose={close} />);
  const editSub = (s: Subscription) => openModal((close) => <SubscriptionDialog sub={s} onClose={close} />);
  const markPaid = async (s: Subscription) => {
    const advanced = advanceSubDue(s);
    advanced.lastPaidAt = new Date().toISOString().slice(0, 10);
    await put('subscriptions', advanced);
    toast(`已标记付款，下次：${advanced.nextDueAt || '未定'}`);
  };
  const togglePause = async (s: Subscription) => {
    const next: Subscription = { ...s, status: s.status === 'active' ? 'paused' : 'active' };
    await put('subscriptions', next);
    toast(next.status === 'paused' ? '已暂停' : '已恢复');
  };
  const remove = async (s: Subscription) => {
    if (!confirm(`删除订阅「${s.name}」？`)) return;
    await del('subscriptions', s.id);
    toast('已删除');
  };

  const runCopilot = async (preset?: string) => {
    const content = (preset || copilotInput).trim();
    if (!content || copilotBusy) return;

    const localPlan = preset ? null : buildSubscriptionImportPlanFromText(content);
    if (localPlan) {
      setCopilotAnswer(`已从文本识别出 ${localPlan.actions.length} 条订阅草稿，请确认后应用。`);
      setCopilotPlan(localPlan);
      setCopilotInput('');
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45000);
    abortRef.current?.abort();
    abortRef.current = controller;
    setCopilotBusy(true);
    setCopilotAnswer('');
    setCopilotPlan(null);
    try {
      const full = await streamChatWithAI(
        getStorage(),
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `你现在在订阅管理页。请优先围绕订阅审计、建档、续费风险和可执行处置回答。\n\n${content}`,
          },
        ],
        (_delta, current) => {
          setCopilotAnswer(stripSubscriptionActionBlock(current));
          setCopilotPlan(extractSubscriptionActionPlan(current));
        },
        controller.signal
      );
      setCopilotAnswer(stripSubscriptionActionBlock(full));
      setCopilotPlan(extractSubscriptionActionPlan(full));
      if (!preset) setCopilotInput('');
    } catch (err: any) {
      const fallbackPlan = buildSubscriptionImportPlanFromText(content);
      if (fallbackPlan) {
        setCopilotAnswer(`AI 分析未完成，但已先从文本识别出 ${fallbackPlan.actions.length} 条订阅草稿，请确认后应用。`);
        setCopilotPlan(fallbackPlan);
        if (!preset) setCopilotInput('');
      } else if (err?.name === 'AbortError') {
        if (timedOut) toast('AI 分析超时，已停止。可以稍后重试或补充更多账单信息。', 3000);
      } else {
        toast('AI 订阅管家失败：' + (err?.message || 'unknown'), 3000);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) {
        setCopilotBusy(false);
        abortRef.current = null;
      }
    }
  };

  const applyCopilotPlan = async () => {
    if (!copilotPlan) return;
    try {
      const count = await applySubscriptionActionPlan(getStorage(), copilotPlan);
      await reloadAll();
      setCopilotPlan(null);
      toast(count ? `已应用 ${count} 项订阅变更` : '没有可应用的订阅变更');
    } catch (err: any) {
      toast('应用失败：' + (err?.message || 'unknown'), 3000);
    }
  };

  const handleImportFile = async (file?: File) => {
    if (!file || copilotBusy) return;
    let ownsBusy = false;
    setCopilotAnswer('');
    setCopilotPlan(null);
    try {
      if (file.type.startsWith('image/')) {
        ownsBusy = true;
        setCopilotBusy(true);
        const plan = await recognizeSubscriptionBillImage(file);
        setCopilotPlan(plan);
        setCopilotAnswer(plan ? `已从截图识别出 ${plan.actions.length} 条可确认操作。` : '截图里没有识别到足够明确的周期性订阅。');
        return;
      }

      const text = await file.text();
      if (/\.csv$/i.test(file.name) || file.type.includes('csv')) {
        ownsBusy = true;
        setCopilotBusy(true);
        const plan = buildSubscriptionImportPlanFromCsv(text, 'csv');
        setCopilotPlan(plan);
        setCopilotAnswer(plan ? `已从文件生成 ${plan.actions.length} 条订阅草稿。` : '没有从 CSV 里解析到订阅行。');
        return;
      }

      const localPlan = buildSubscriptionImportPlanFromText(text);
      if (localPlan) {
        setCopilotPlan(localPlan);
        setCopilotAnswer(`已从文件文本识别出 ${localPlan.actions.length} 条订阅草稿，请确认后应用。`);
        return;
      }

      await runCopilot(buildSubscriptionImportPrompt(text));
    } catch (err: any) {
      toast('导入失败：' + (err?.message || 'unknown'), 3000);
    } finally {
      if (ownsBusy) setCopilotBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  return (
    <div>
      <Header title="订阅管理" subtitle="软件 · 贷款 · 水电 · 会员" actions={<button onClick={addSub} className="px-3.5 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5"><Glyph name="plus" size={15} strokeWidth={1.8} />新增</button>} />
      <div className="py-4 md:py-5">
        <section className="bg-white rounded-2xl shadow-soft p-4 mb-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="font-display text-[15px] text-ink-900 inline-flex items-center gap-2">
                <PinIcon name="spark" size={25} />AI 订阅管家
              </h2>
              <p className="text-[12px] text-ink-500 mt-1">
                粘贴账单、输入一句订阅信息，或让 AI 做续费审计；所有变更都会先给你确认。
              </p>
            </div>
            {copilotBusy && (
              <button
                onClick={() => abortRef.current?.abort()}
                className="text-[11.5px] text-ink-500 hover:text-ink-900 px-2 py-1"
              >
                停止
              </button>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-2.5 mb-3">
            {insights.map((insight) => (
              <div key={insight.id} className={`border rounded-xl px-3 py-2.5 ${INSIGHT_TONE_CLASS[insight.tone]}`}>
                <div className="text-[12.5px] font-semibold">{insight.title}</div>
                <div className="text-[11.5px] mt-1 opacity-85 leading-relaxed">{insight.detail}</div>
              </div>
            ))}
          </div>

          {duplicateGroups.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-3">
              <div className="text-[12.5px] font-semibold text-amber-700">疑似重复订阅</div>
              <div className="space-y-2 mt-2">
                {duplicateGroups.map((group) => (
                  <div key={group.key} className="flex items-center gap-2 text-[12.5px] text-ink-700">
                    <span className="flex-1 truncate">
                      {group.subscriptions.map((sub) => sub.name).join(' / ')}
                      <span className="text-ink-400 ml-1">({Math.round(group.score * 100)}%)</span>
                    </span>
                    <button
                      onClick={() => {
                        const sorted = group.subscriptions
                          .slice()
                          .sort((a, b) => Number(!!b.url || !!b.cancelUrl) - Number(!!a.url || !!a.cancelUrl));
                        const target = sorted[0]!;
                        const source = sorted[1]!;
                        setCopilotAnswer(`已生成「${source.name}」并入「${target.name}」的本地合并方案。`);
                        setCopilotPlan({
                          summary: `合并疑似重复订阅：${source.name} → ${target.name}`,
                          actions: [
                            {
                              type: 'mergeSubscriptions',
                              sourceSubId: source.id,
                              targetSubId: target.id,
                              patch: { note: `AI 去重：${group.reason}` },
                            },
                          ],
                        });
                      }}
                      disabled={copilotBusy}
                      className="px-2.5 py-1 rounded-full bg-amber-600 text-white text-[11.5px] disabled:opacity-50"
                    >
                      合并
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => runCopilot('请审计我的订阅：按保留、复核、可暂停三类给建议，并指出近期续费风险。')}
              disabled={copilotBusy}
              className="text-[12px] px-3 py-1.5 rounded-full bg-paper-200 hover:bg-paper-300 text-ink-700 disabled:opacity-50"
            >
              审计订阅
            </button>
            <button
              onClick={() => runCopilot('请找出缺少管理链接、支付方式或下次扣款日的订阅，并生成补全建议。')}
              disabled={copilotBusy}
              className="text-[12px] px-3 py-1.5 rounded-full bg-paper-200 hover:bg-paper-300 text-ink-700 disabled:opacity-50"
            >
              找缺失信息
            </button>
            <button
              onClick={() => runCopilot('请检查 45 天内的年度续费和大额扣款，给出是否需要提前处理的建议。')}
              disabled={copilotBusy}
              className="text-[12px] px-3 py-1.5 rounded-full bg-paper-200 hover:bg-paper-300 text-ink-700 disabled:opacity-50"
            >
              续费风险
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={copilotBusy}
              className="text-[12px] px-3 py-1.5 rounded-full bg-paper-200 hover:bg-paper-300 text-ink-700 disabled:opacity-50"
            >
              导入文件 / 截图
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,.txt,.json,.md,image/*"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0])}
            />
            <span className="text-[11.5px] text-ink-400">AI 会自行判断 CSV、邮件/短信、银行账单文本或扣款截图</span>
          </div>

          <div className="flex gap-2">
            <textarea
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              rows={2}
              placeholder="粘贴账单、续费凭证，或直接说：我开了 iCloud+，每月 21 元，5 月 28 日扣款，用 Apple Pay"
              className="flex-1 min-h-[44px] border border-slate-200 rounded-xl px-3 py-2 text-[13px] resize-none"
            />
            <button
              onClick={() => runCopilot()}
              disabled={copilotBusy || !copilotInput.trim()}
              className="px-3.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-medium disabled:opacity-50"
            >
              {copilotBusy ? '分析中' : '生成'}
            </button>
          </div>

          {(copilotAnswer || copilotPlan) && (
            <div className="mt-3 space-y-2">
              {copilotAnswer && (
                <div className="bg-paper-100 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed text-ink-700 whitespace-pre-wrap">
                  {copilotAnswer}
                </div>
              )}
              {copilotPlan && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12.5px] font-semibold text-emerald-700">可执行订阅方案</div>
                      <div className="text-[11.5px] text-emerald-700/80 mt-0.5">{copilotPlan.summary}</div>
                    </div>
                    <button
                      onClick={applyCopilotPlan}
                      className="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11.5px]"
                    >
                      应用
                    </button>
                  </div>
                  <div className="space-y-1">
                    {copilotPlan.actions.map((action, index) => (
                      <div key={index} className={`border rounded-lg px-2.5 py-2 text-[12.5px] text-ink-700 flex gap-2 ${PREVIEW_TONE_CLASS[previewSubscriptionAction(action, subs).tone]}`}>
                        <span className="text-emerald-700 tabular-nums">{index + 1}.</span>
                        <span className="min-w-0">
                          <span className="font-medium text-ink-800">{previewSubscriptionAction(action, subs).title}</span>
                          <span className="block text-[11.5px] text-ink-500 mt-0.5">{previewSubscriptionAction(action, subs).detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="grid grid-cols-3 gap-2.5 md:gap-3 mb-5">
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="eyebrow text-[9.5px]">月均支出</div>
            <div className="font-display text-2xl text-ink-900 mt-2 tabular-nums leading-none">
              <span className="text-ink-400 mr-0.5 text-xl">¥</span>{monthTotal.toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="eyebrow text-[9.5px]">年均支出</div>
            <div className="font-display text-2xl text-ink-900 mt-2 tabular-nums leading-none">
              <span className="text-ink-400 mr-0.5 text-xl">¥</span>{(monthTotal * 12).toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <div className="eyebrow text-[9.5px]">生效数</div>
            <div className="font-display text-2xl text-ink-900 mt-2 tabular-nums leading-none">{active.length}</div>
          </div>
        </div>

        {categoryDist.length > 0 && (
          <section className="bg-white rounded-2xl shadow-soft p-4 mb-5">
            <h2 className="font-display text-[15px] mb-3 text-ink-900">分类月均支出</h2>
            <div className="space-y-2.5">
              {categoryDist.map(([catId, cost]) => {
                const cat = CAT_MAP[catId] || { name: '其他' };
                const pct = monthTotal ? Math.round((cost / monthTotal) * 100) : 0;
                return (
                  <div key={catId}>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-ink-700">{cat.name}</span>
                      <span className="text-ink-500 tabular-nums">¥{cost.toFixed(0)} · {pct}%</span>
                    </div>
                    <div className="h-1 bg-paper-200 rounded-full overflow-hidden mt-1.5">
                      <div className="h-full bg-clay-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {subs.length === 0 ? (
          <EmptyState icon="subscribe" title="还没有订阅" description="点右上「新增」记录你的定期账单" />
        ) : (
          <>
            <section className="mb-5">
              <h2 className="font-display text-[15px] mb-2.5 text-ink-900">生效中</h2>
              <ul className="space-y-2">{sortedActive.map((s) => <SubCard key={s.id} sub={s} onEdit={editSub} onPaid={markPaid} onPause={togglePause} onDelete={remove} />)}</ul>
            </section>
            {paused.length > 0 && (
              <section>
                <h2 className="eyebrow mb-2.5">已暂停 / 已取消</h2>
                <ul className="space-y-2">{paused.map((s) => <SubCard key={s.id} sub={s} onEdit={editSub} onPaid={markPaid} onPause={togglePause} onDelete={remove} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
