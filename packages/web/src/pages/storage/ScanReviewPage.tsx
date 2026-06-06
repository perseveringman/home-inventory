import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  applyScanSession,
  discardScanSession,
  inferScanCandidatePlacements,
  updateScanCandidate,
  type ScanCandidate,
} from '@home-inventory/core';
import { BlobImage } from '../../components/BlobImage';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { PinIcon } from '../../components/PinIcon';
import { toast } from '../../components/Toast';
import { photoStageStyle } from '../../lib/photoStage';
import { getStorage, useStore } from '../../stores/useStore';

function confidenceLabel(value?: number) {
  if (!value) return '未知';
  if (value >= 0.78) return '高';
  if (value >= 0.58) return '中';
  return '低';
}

function CandidateRow({
  candidate,
  onChange,
  cabinetOptions,
}: {
  candidate: ScanCandidate;
  onChange: (candidate: ScanCandidate, patch: Partial<ScanCandidate>) => Promise<void> | void;
  cabinetOptions: ScanCandidate[];
}) {
  const rejected = candidate.reviewStatus === 'rejected';
  const [localName, setLocalName] = useState(candidate.name);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestedCabinet = cabinetOptions.find((cabinet) => cabinet.id === candidate.suggestedCabinetCandidateId);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setLocalName(candidate.name);
  }, [candidate.id, candidate.name]);

  const commitName = async () => {
    const next = localName.trim();
    if (!next || next === candidate.name) {
      setLocalName(candidate.name);
      return;
    }
    await onChange(candidate, {
      name: next,
      userCorrection: next,
      reviewStatus: 'edited',
    });
  };

  const changePlacement = async (targetId: string) => {
    const target = cabinetOptions.find((cabinet) => cabinet.id === targetId);
    await onChange(candidate, {
      suggestedCabinetCandidateId: target?.id,
      placementConfidence: target ? 1 : 0.35,
      placementReason: target
        ? `用户选择归到「${target.name}」`
        : '用户选择暂不归柜，应用后进入房间自由区',
      placementSource: 'user',
      reviewStatus: 'edited',
    });
  };

  return (
    <div className={`rounded-xl border p-3 ${rejected ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            onChange(candidate, {
              reviewStatus: rejected ? 'pending' : 'rejected',
            })
          }
          className={`w-8 h-8 rounded-full flex items-center justify-center border ${
            rejected ? 'bg-white text-ink-400 border-slate-200' : 'bg-brand-500 text-white border-brand-500'
          }`}
          aria-label={rejected ? '恢复候选' : '跳过候选'}
        >
          {rejected ? '×' : '✓'}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-ink-500">
              {candidate.kind === 'cabinet' ? '柜子' : '物品'}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">
              置信度 {confidenceLabel(candidate.confidence)}
            </span>
          </div>
          <input
            ref={inputRef}
            value={localName}
            onChange={(event) => setLocalName(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setLocalName(event.currentTarget.value);
            }}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !composing) {
                event.currentTarget.blur();
              }
            }}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          {candidate.aiReason && (
            <div className="text-[11px] text-ink-500 mt-1">{candidate.aiReason}</div>
          )}
          {candidate.kind === 'item' && (
            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-medium text-ink-500">建议归属</span>
                <span className="text-[11px] text-ink-400">
                  {candidate.placementSource === 'user' ? '已手动调整' : `位置推断 ${confidenceLabel(candidate.placementConfidence)}`}
                </span>
              </div>
              <select
                value={suggestedCabinet?.id || ''}
                onChange={(event) => changePlacement(event.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">房间自由区</option>
                {cabinetOptions.map((cabinet) => (
                  <option key={cabinet.id} value={cabinet.id}>
                    {cabinet.name}
                  </option>
                ))}
              </select>
              {candidate.placementReason && (
                <div className="text-[11px] text-ink-500 mt-1">{candidate.placementReason}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type CandidateFilter = 'all' | 'cabinet' | 'item' | 'low';

export default function ScanReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessions = useStore((s) => s.scanSessions);
  const photos = useStore((s) => s.photos);
  const rooms = useStore((s) => s.rooms);
  const reloadAll = useStore((s) => s.reloadAll);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<CandidateFilter>('all');

  const rawSession = sessions.find((item) => item.id === id);
  const session = useMemo(
    () => rawSession ? { ...rawSession, candidates: inferScanCandidatePlacements(rawSession.candidates) } : undefined,
    [rawSession]
  );
  const photo = photos.find((item) => item.id === session?.photoId);
  const room = rooms.find((item) => item.id === session?.roomId);

  const counts = useMemo(() => {
    const live = session?.candidates.filter((candidate) => candidate.reviewStatus !== 'rejected') || [];
    return {
      total: live.length,
      cabinets: live.filter((candidate) => candidate.kind === 'cabinet').length,
      items: live.filter((candidate) => candidate.kind === 'item').length,
      low: live.filter((candidate) => (candidate.confidence || 0) < 0.58).length,
    };
  }, [session]);

  const filteredCandidates = useMemo(() => {
    const candidates = session?.candidates || [];
    if (filter === 'cabinet') return candidates.filter((candidate) => candidate.kind === 'cabinet');
    if (filter === 'item') return candidates.filter((candidate) => candidate.kind === 'item');
    if (filter === 'low') return candidates.filter((candidate) => (candidate.confidence || 0) < 0.58);
    return candidates;
  }, [filter, session]);

  const cabinetOptions = useMemo(
    () =>
      (session?.candidates || []).filter(
        (candidate) => candidate.kind === 'cabinet' && candidate.reviewStatus !== 'rejected'
      ),
    [session]
  );

  if (!session || !photo) {
    return (
      <div className="p-6">
        <EmptyState icon="spark" title="扫描审核不存在" />
      </div>
    );
  }

  const changeCandidate = async (
    candidate: ScanCandidate,
    patch: Partial<ScanCandidate>
  ) => {
    await updateScanCandidate(getStorage(), session.id, candidate.id, patch);
    await reloadAll();
  };

  const apply = async () => {
    setBusy(true);
    try {
      await applyScanSession(getStorage(), session.id);
      await reloadAll();
      toast('扫描结果已应用');
      navigate(rooms.some((item) => item.id === session.roomId) ? `/room/${session.roomId}` : '/inbox');
    } catch (err: any) {
      toast(err?.message || '应用失败', 3000);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!confirm('丢弃这次收集箱识别结果？来源照片仍会保留。')) return;
    await discardScanSession(getStorage(), session.id);
    await reloadAll();
    toast('已丢弃扫描审核');
    navigate(rooms.some((item) => item.id === session.roomId) ? `/room/${session.roomId}` : '/inbox');
  };

  return (
    <div>
      <Header
        title="整理这筐"
        subtitle={`${room?.name || '全屋'} · ${counts.cabinets} 个柜子 · ${counts.items} 件物品`}
        back
        actions={
          <div className="flex gap-2">
            <button onClick={discard} className="px-3 py-2 rounded-lg bg-slate-100 text-sm">
              丢弃
            </button>
            <button
              onClick={apply}
              disabled={busy || session.status === 'applied'}
              className="px-3 py-2 rounded-lg bg-brand-500 text-white text-sm disabled:bg-ink-300"
            >
              {busy ? '应用中…' : '应用结果'}
            </button>
          </div>
        }
      />

      <div className="px-4 md:px-6 py-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section>
          <div
            className="photo-stage relative bg-black rounded-2xl overflow-hidden mx-auto"
            style={photoStageStyle(photo.width, photo.height)}
          >
            <BlobImage blob={photo.blob} className="w-full h-full object-contain" />
            {filteredCandidates.map((candidate) => {
              const hidden = candidate.reviewStatus === 'rejected';
              const rect = candidate.rect;
              return (
                <button
                  key={candidate.id}
                  onClick={() =>
                    changeCandidate(candidate, {
                      reviewStatus: hidden ? 'pending' : 'rejected',
                    })
                  }
                  className={`cabinet-box ${candidate.kind === 'item' ? 'is-draft' : ''} ${
                    hidden ? 'opacity-30' : ''
                  }`}
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                >
                  <span className="label">
                    {candidate.kind === 'item' && candidate.emoji ? `${candidate.emoji} ` : ''}
                    {candidate.name}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl bg-brand-50 border border-brand-100 p-3 text-sm text-brand-700">
            {counts.low
              ? `${counts.low} 个低置信度候选建议复核。点照片框或左侧勾选可跳过，名称可直接修改。`
              : 'AI 候选都已准备好，物品会按照片位置建议归到对应柜子，你也可以逐个微调。'}
          </div>
        </section>

        <section className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`text-left rounded-xl p-3 border transition ${
                filter === 'all'
                  ? 'bg-brand-50 border-brand-200 shadow-soft'
                  : 'bg-white border-transparent shadow-soft'
              }`}
            >
              <PinIcon name="spark" size={32} />
              <div className="font-display text-2xl">{counts.total}</div>
              <div className="text-xs text-ink-500">全部</div>
            </button>
            <button
              onClick={() => setFilter('cabinet')}
              className={`text-left rounded-xl p-3 border transition ${
                filter === 'cabinet'
                  ? 'bg-brand-50 border-brand-200 shadow-soft'
                  : 'bg-white border-transparent shadow-soft'
              }`}
            >
              <PinIcon name="cabinet" size={32} />
              <div className="font-display text-2xl">{counts.cabinets}</div>
              <div className="text-xs text-ink-500">柜子候选</div>
            </button>
            <button
              onClick={() => setFilter('item')}
              className={`text-left rounded-xl p-3 border transition ${
                filter === 'item'
                  ? 'bg-brand-50 border-brand-200 shadow-soft'
                  : 'bg-white border-transparent shadow-soft'
              }`}
            >
              <PinIcon name="box" size={32} />
              <div className="font-display text-2xl">{counts.items}</div>
              <div className="text-xs text-ink-500">物品候选</div>
            </button>
            <button
              onClick={() => setFilter('low')}
              className={`text-left rounded-xl p-3 border transition ${
                filter === 'low'
                  ? 'bg-brand-50 border-brand-200 shadow-soft'
                  : 'bg-white border-transparent shadow-soft'
              }`}
            >
              <PinIcon name="spark" size={32} />
              <div className="font-display text-2xl">{counts.low}</div>
              <div className="text-xs text-ink-500">低置信度</div>
            </button>
          </div>
          <div className="space-y-2 max-h-[64vh] overflow-auto pr-1">
            {filteredCandidates.length ? filteredCandidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                onChange={changeCandidate}
                cabinetOptions={cabinetOptions}
              />
            )) : (
              <div className="rounded-xl bg-white border border-slate-200 p-5 text-sm text-ink-500 text-center">
                当前过滤下没有候选项。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
