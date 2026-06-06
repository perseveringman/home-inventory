"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferScanCandidatePlacements = inferScanCandidatePlacements;
exports.createScanSessionFromDetection = createScanSessionFromDetection;
exports.updateScanCandidate = updateScanCandidate;
exports.applyScanSession = applyScanSession;
exports.discardScanSession = discardScanSession;
const image_1 = require("../utils/image");
const id_1 = require("../utils/id");
const cabinet_1 = require("./cabinet");
const actionLog_1 = require("./actionLog");
function estimateConfidence(kind, box) {
    const vague = /未知|物品|瓶子|盒子|区域|柜子\s*\d*$/i.test(box.name);
    const base = kind === 'cabinet' ? 0.82 : 0.74;
    const sizeSignal = Math.min(0.12, Math.max(0, (box.rect.w * box.rect.h - 0.02) * 0.4));
    return Math.max(0.35, Math.min(0.96, base + sizeSignal - (vague ? 0.18 : 0)));
}
function candidateReason(kind, confidence) {
    if (confidence < 0.6)
        return kind === 'cabinet' ? '边界或命名不确定，建议复核' : '外观较泛，建议确认名称';
    return kind === 'cabinet' ? '识别到独立可收纳区域' : '识别到可单独记录的物品';
}
function toCandidate(kind, box) {
    const confidence = estimateConfidence(kind, box);
    return {
        id: (0, id_1.uid)(),
        kind,
        name: box.name,
        rect: box.rect,
        emoji: box.emoji,
        confidence,
        aiReason: candidateReason(kind, confidence),
        reviewStatus: 'pending',
        createdAt: Date.now(),
    };
}
function rectArea(rect) {
    return Math.max(0, rect.w) * Math.max(0, rect.h);
}
function intersectionArea(a, b) {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
}
function rectCenter(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
function containsPoint(rect, point) {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}
function distanceFromPointToRect(rect, point) {
    const dx = point.x < rect.x ? rect.x - point.x : point.x > rect.x + rect.w ? point.x - (rect.x + rect.w) : 0;
    const dy = point.y < rect.y ? rect.y - point.y : point.y > rect.y + rect.h ? point.y - (rect.y + rect.h) : 0;
    return Math.sqrt(dx * dx + dy * dy);
}
function scorePlacement(cabinet, item) {
    const itemArea = Math.max(0.001, rectArea(item.rect));
    const cabinetArea = Math.max(0.001, rectArea(cabinet.rect));
    const overlapRatio = intersectionArea(cabinet.rect, item.rect) / itemArea;
    const itemCenter = rectCenter(item.rect);
    const centerInside = containsPoint(cabinet.rect, itemCenter);
    const proximity = Math.max(0, 1 - distanceFromPointToRect(cabinet.rect, itemCenter) / 0.16);
    const specificity = Math.max(0, 1 - Math.min(1, cabinetArea / 0.6));
    const score = overlapRatio * 0.68 + (centerInside ? 0.22 : 0) + proximity * 0.06 + specificity * 0.04;
    return { cabinet, score, overlapRatio, centerInside, proximity, cabinetArea };
}
function placementReason(match) {
    if (match.centerInside && match.overlapRatio >= 0.8) {
        return `物品框基本落在「${match.cabinet.name}」内`;
    }
    if (match.overlapRatio >= 0.25) {
        return `物品区域与「${match.cabinet.name}」重叠度最高`;
    }
    return `物品位置最接近「${match.cabinet.name}」`;
}
function inferScanCandidatePlacements(candidates) {
    const activeCabinets = candidates.filter((candidate) => candidate.kind === 'cabinet' && candidate.reviewStatus !== 'rejected');
    return candidates.map((candidate) => {
        if (candidate.kind !== 'item')
            return candidate;
        const manualTargetStillValid = candidate.placementSource === 'user' &&
            (!candidate.suggestedCabinetCandidateId ||
                activeCabinets.some((cabinet) => cabinet.id === candidate.suggestedCabinetCandidateId));
        if (manualTargetStillValid)
            return candidate;
        const best = activeCabinets
            .map((cabinet) => scorePlacement(cabinet, candidate))
            .filter((match) => match.score >= 0.28 &&
            (match.overlapRatio >= 0.08 || match.centerInside || match.proximity >= 0.45))
            .sort((a, b) => b.score - a.score || a.cabinetArea - b.cabinetArea)[0];
        if (!best) {
            return {
                ...candidate,
                suggestedCabinetCandidateId: undefined,
                placementConfidence: 0.35,
                placementReason: '未找到明显包含它的柜子，应用后进入房间自由区',
                placementSource: 'ai',
            };
        }
        return {
            ...candidate,
            suggestedCabinetCandidateId: best.cabinet.id,
            placementConfidence: Math.min(0.96, Math.max(0.42, best.score)),
            placementReason: placementReason(best),
            placementSource: 'ai',
        };
    });
}
async function createScanSessionFromDetection(storage, photo, result) {
    const candidates = inferScanCandidatePlacements([
        ...result.cabinets.map((box) => toCandidate('cabinet', box)),
        ...result.items.map((box) => toCandidate('item', box)),
    ]);
    const session = {
        id: (0, id_1.uid)(),
        photoId: photo.id,
        roomId: photo.roomId,
        status: 'reviewing',
        candidates,
        createdAt: Date.now(),
    };
    await storage.put('scanSessions', session);
    await (0, actionLog_1.logAction)(storage, {
        source: 'ai',
        type: 'scan_session_created',
        summary: `生成扫描审核：${result.cabinets.length} 个柜子 · ${result.items.length} 件物品`,
        targetType: 'scanSession',
        targetId: session.id,
    });
    return session;
}
async function updateScanCandidate(storage, sessionId, candidateId, patch) {
    const session = await storage.get('scanSessions', sessionId);
    if (!session)
        throw new Error('扫描会话不存在');
    const candidates = session.candidates.map((candidate) => candidate.id === candidateId
        ? {
            ...candidate,
            ...patch,
            reviewStatus: patch.reviewStatus || (patch.name || patch.rect ? 'edited' : candidate.reviewStatus),
        }
        : candidate);
    const next = {
        ...session,
        candidates: inferScanCandidatePlacements(candidates),
    };
    await storage.put('scanSessions', next);
    return next;
}
async function applyScanSession(storage, sessionId, acceptedIds) {
    const session = await storage.get('scanSessions', sessionId);
    if (!session)
        throw new Error('扫描会话不存在');
    if (session.status === 'applied')
        throw new Error('这个扫描会话已经应用过');
    const photo = await storage.get('photos', session.photoId);
    if (!photo)
        throw new Error('来源照片不存在');
    const accepted = new Set(acceptedIds ||
        session.candidates
            .filter((candidate) => candidate.reviewStatus !== 'rejected')
            .map((candidate) => candidate.id));
    const reviewedCandidates = inferScanCandidatePlacements(session.candidates);
    const cabinets = [];
    const items = [];
    const cabinetIdByCandidateId = new Map();
    for (const candidate of reviewedCandidates) {
        if (!accepted.has(candidate.id))
            continue;
        if (candidate.kind === 'cabinet') {
            const cabinet = {
                id: (0, id_1.uid)(),
                photoId: photo.id,
                roomId: photo.roomId,
                name: candidate.name,
                rect: candidate.rect,
                type: 'normal',
                createdAt: Date.now(),
            };
            await storage.put('cabinets', cabinet);
            cabinets.push(cabinet);
            cabinetIdByCandidateId.set(candidate.id, cabinet.id);
        }
    }
    const itemCandidates = reviewedCandidates.filter((candidate) => candidate.kind === 'item' && accepted.has(candidate.id));
    if (itemCandidates.length) {
        let loose;
        for (const candidate of itemCandidates) {
            const targetCabinet = candidate.suggestedCabinetCandidateId
                ? cabinets.find((cabinet) => cabinet.id === cabinetIdByCandidateId.get(candidate.suggestedCabinetCandidateId))
                : undefined;
            if (!targetCabinet) {
                loose = loose || (await (0, cabinet_1.ensureLooseCabinet)(storage, photo.roomId));
                await storage.put('cabinets', loose);
            }
            const cabinet = targetCabinet || loose;
            const crop = await (0, image_1.cropItemFromPhoto)(photo.blob, candidate.rect);
            const reason = [candidate.aiReason, targetCabinet && candidate.placementReason ? `归属建议：${candidate.placementReason}` : '']
                .filter(Boolean)
                .join('；');
            const item = {
                id: (0, id_1.uid)(),
                cabinetId: cabinet.id,
                roomId: cabinet.roomId,
                name: candidate.name,
                qty: 1,
                note: '',
                tags: [],
                image: crop || (await (0, image_1.generateItemThumb)(candidate.name, candidate.emoji || 'box')),
                status: targetCabinet ? 'placed' : 'pending',
                source: 'ai',
                sourcePhotoId: photo.id,
                aiEmoji: candidate.emoji,
                aiRect: candidate.rect,
                confidence: targetCabinet
                    ? Math.min(candidate.confidence || 0.7, candidate.placementConfidence || 0.7)
                    : candidate.confidence,
                aiReason: reason || candidate.aiReason,
                reviewStatus: candidate.reviewStatus === 'edited' ? 'edited' : 'accepted',
                userCorrection: candidate.userCorrection,
                createdAt: Date.now(),
            };
            await storage.put('items', item);
            items.push(item);
        }
    }
    const next = { ...session, candidates: reviewedCandidates, status: 'applied', appliedAt: Date.now() };
    await storage.put('scanSessions', next);
    const placedCount = items.filter((item) => item.status === 'placed').length;
    await (0, actionLog_1.logAction)(storage, {
        source: 'user',
        type: 'scan_session_applied',
        summary: `应用扫描审核：${cabinets.length} 个柜子 · ${items.length} 件物品 · ${placedCount} 件已按位置归柜`,
        targetType: 'scanSession',
        targetId: session.id,
        after: { cabinetIds: cabinets.map((cabinet) => cabinet.id), itemIds: items.map((item) => item.id) },
    });
    return { cabinets, items };
}
async function discardScanSession(storage, sessionId) {
    const session = await storage.get('scanSessions', sessionId);
    if (!session)
        return;
    await storage.put('scanSessions', { ...session, status: 'discarded' });
    await (0, actionLog_1.logAction)(storage, {
        source: 'user',
        type: 'scan_session_discarded',
        summary: '丢弃扫描审核',
        targetType: 'scanSession',
        targetId: session.id,
    });
}
