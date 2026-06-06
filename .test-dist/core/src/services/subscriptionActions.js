"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSubscriptionActionPlan = extractSubscriptionActionPlan;
exports.stripSubscriptionActionBlock = stripSubscriptionActionBlock;
exports.describeSubscriptionAction = describeSubscriptionAction;
exports.applySubscriptionActionPlan = applySubscriptionActionPlan;
exports.previewSubscriptionAction = previewSubscriptionAction;
const models_1 = require("../models");
const id_1 = require("../utils/id");
const actionLog_1 = require("./actionLog");
const subscription_1 = require("./subscription");
const appStore_1 = require("./appStore");
const CATEGORY_IDS = new Set(models_1.SUB_CATEGORIES.map((c) => c.id));
const CYCLE_IDS = new Set(models_1.SUB_CYCLES.map((c) => c.id));
const STATUS_IDS = new Set(['active', 'paused', 'cancelled']);
const SOURCE_IDS = new Set(['manual', 'ai_text', 'ai_vision', 'csv', 'email', 'sms', 'bank']);
const DECISION_IDS = new Set(['keep', 'review', 'cancel']);
const CANCEL_DIFFICULTY_IDS = new Set(['easy', 'medium', 'hard']);
function cleanText(value, max = 120) {
    const text = String(value ?? '').trim();
    return text ? text.slice(0, max) : undefined;
}
/** 接受 https URL 或 data: 内联图（限 256KB 以内的 base64 长度），其它一律丢弃 */
function cleanIconUrl(value) {
    const text = String(value ?? '').trim();
    if (!text)
        return undefined;
    if (/^data:image\//i.test(text))
        return text.length <= 350_000 ? text : undefined;
    if (/^https:\/\//i.test(text))
        return text.slice(0, 600);
    return undefined;
}
function cleanAppStoreId(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
function cleanDate(value) {
    const text = cleanText(value, 10);
    if (!text)
        return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}
function cleanAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
        return undefined;
    return Math.round(n * 100) / 100;
}
function cleanBool(value) {
    if (typeof value === 'boolean')
        return value;
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    return undefined;
}
function cleanCategory(value) {
    const id = String(value || '');
    return CATEGORY_IDS.has(id) ? id : undefined;
}
function cleanCycle(value) {
    const id = String(value || '');
    return CYCLE_IDS.has(id) ? id : undefined;
}
function cleanStatus(value) {
    const id = String(value || '');
    return STATUS_IDS.has(id) ? id : undefined;
}
function cleanSource(value) {
    const id = String(value || '');
    return SOURCE_IDS.has(id) ? id : undefined;
}
function cleanDecision(value) {
    const id = String(value || '');
    return DECISION_IDS.has(id) ? id : undefined;
}
function cleanCancelDifficulty(value) {
    const id = String(value || '');
    return CANCEL_DIFFICULTY_IDS.has(id) ? id : undefined;
}
function cleanCycleDays(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0 || n > 3660)
        return undefined;
    return n;
}
function cleanConfidence(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return undefined;
    return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}
function cleanNullablePositiveInt(value) {
    if (value === null)
        return null;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 365)
        return undefined;
    return n;
}
function cleanPriceHistory(value) {
    if (!Array.isArray(value))
        return undefined;
    const points = value
        .map((item) => {
        const amount = cleanAmount(item?.amount);
        const date = cleanDate(item?.date);
        if (amount == null || !date)
            return null;
        const note = cleanText(item?.note, 160);
        return { amount, date, ...(note ? { note } : {}) };
    })
        .filter(Boolean);
    return points.length ? points.slice(0, 40) : undefined;
}
function cleanCancellationPlan(value) {
    if (!Array.isArray(value))
        return undefined;
    const steps = value
        .map((item, index) => {
        const text = cleanText(typeof item === 'string' ? item : item?.text, 160);
        if (!text)
            return null;
        return {
            id: cleanText(item?.id, 40) || `step-${index + 1}`,
            text,
            done: cleanBool(item?.done) || false,
        };
    })
        .filter(Boolean);
    return steps.length ? steps.slice(0, 12) : undefined;
}
function sanitizePatch(input) {
    const patch = {};
    const name = cleanText(input?.name, 80);
    const icon = cleanText(input?.icon, 4);
    const iconUrl = cleanIconUrl(input?.iconUrl);
    const appStoreId = cleanAppStoreId(input?.appStoreId);
    const category = cleanCategory(input?.category);
    const amount = cleanAmount(input?.amount);
    const currency = cleanText(input?.currency, 8);
    const cycle = cleanCycle(input?.cycle);
    const cycleDays = cleanCycleDays(input?.cycleDays);
    const nextDueAt = cleanDate(input?.nextDueAt);
    const startedAt = cleanDate(input?.startedAt);
    const endAt = cleanDate(input?.endAt);
    const autoRenew = cleanBool(input?.autoRenew);
    const paymentMethod = cleanText(input?.paymentMethod, 80);
    const url = cleanText(input?.url, 240);
    const note = cleanText(input?.note, 500);
    const status = cleanStatus(input?.status);
    const lastPaidAt = cleanDate(input?.lastPaidAt);
    const planName = cleanText(input?.planName, 80);
    const owner = cleanText(input?.owner, 80);
    const usageNote = cleanText(input?.usageNote, 360);
    const lastUsedAt = cleanDate(input?.lastUsedAt);
    const decision = cleanDecision(input?.decision);
    const reviewBeforeDays = cleanNullablePositiveInt(input?.reviewBeforeDays);
    const source = cleanSource(input?.source);
    const confidence = cleanConfidence(input?.confidence);
    const evidenceText = cleanText(input?.evidenceText, 1200);
    const importBatchId = cleanText(input?.importBatchId, 80);
    const priceHistory = cleanPriceHistory(input?.priceHistory);
    const cancelUrl = cleanText(input?.cancelUrl, 240);
    const cancelDifficulty = cleanCancelDifficulty(input?.cancelDifficulty);
    const cancellationPlan = cleanCancellationPlan(input?.cancellationPlan);
    const cancellationCheckedAt = cleanDate(input?.cancellationCheckedAt);
    if (name)
        patch.name = name;
    if (icon)
        patch.icon = icon;
    if (iconUrl)
        patch.iconUrl = iconUrl;
    if (appStoreId != null)
        patch.appStoreId = appStoreId;
    if (category)
        patch.category = category;
    if (amount != null)
        patch.amount = amount;
    if (currency)
        patch.currency = currency;
    if (cycle)
        patch.cycle = cycle;
    if (cycleDays)
        patch.cycleDays = cycleDays;
    if (nextDueAt)
        patch.nextDueAt = nextDueAt;
    if (startedAt)
        patch.startedAt = startedAt;
    if (endAt)
        patch.endAt = endAt;
    if (autoRenew != null)
        patch.autoRenew = autoRenew;
    if (paymentMethod)
        patch.paymentMethod = paymentMethod;
    if (url)
        patch.url = url;
    if (note)
        patch.note = note;
    if (status)
        patch.status = status;
    if (lastPaidAt)
        patch.lastPaidAt = lastPaidAt;
    if (planName)
        patch.planName = planName;
    if (owner)
        patch.owner = owner;
    if (usageNote)
        patch.usageNote = usageNote;
    if (lastUsedAt)
        patch.lastUsedAt = lastUsedAt;
    if (decision)
        patch.decision = decision;
    if (reviewBeforeDays !== undefined)
        patch.reviewBeforeDays = reviewBeforeDays;
    if (source)
        patch.source = source;
    if (confidence != null)
        patch.confidence = confidence;
    if (evidenceText)
        patch.evidenceText = evidenceText;
    if (importBatchId)
        patch.importBatchId = importBatchId;
    if (priceHistory)
        patch.priceHistory = priceHistory;
    if (cancelUrl)
        patch.cancelUrl = cancelUrl;
    if (cancelDifficulty)
        patch.cancelDifficulty = cancelDifficulty;
    if (cancellationPlan)
        patch.cancellationPlan = cancellationPlan;
    if (cancellationCheckedAt)
        patch.cancellationCheckedAt = cancellationCheckedAt;
    if (patch.cycle !== 'custom')
        delete patch.cycleDays;
    return patch;
}
function buildSubscription(draft) {
    const patch = sanitizePatch(draft);
    if (!patch.name)
        return null;
    return {
        id: (0, id_1.uid)(),
        name: patch.name,
        icon: patch.icon,
        iconUrl: patch.iconUrl,
        appStoreId: patch.appStoreId,
        category: patch.category || 'other',
        amount: patch.amount || 0,
        currency: patch.currency,
        cycle: patch.cycle || 'monthly',
        cycleDays: patch.cycle === 'custom' ? patch.cycleDays || 30 : undefined,
        nextDueAt: patch.nextDueAt,
        startedAt: patch.startedAt,
        endAt: patch.endAt,
        autoRenew: patch.autoRenew ?? true,
        paymentMethod: patch.paymentMethod,
        url: patch.url,
        note: patch.note,
        status: patch.status || 'active',
        lastPaidAt: patch.lastPaidAt,
        planName: patch.planName,
        owner: patch.owner,
        usageNote: patch.usageNote,
        lastUsedAt: patch.lastUsedAt,
        decision: patch.decision,
        reviewBeforeDays: patch.reviewBeforeDays,
        source: patch.source,
        confidence: patch.confidence,
        evidenceText: patch.evidenceText,
        importBatchId: patch.importBatchId,
        priceHistory: patch.priceHistory || (patch.amount != null ? [{ amount: patch.amount, date: patch.startedAt || patch.nextDueAt || new Date().toISOString().slice(0, 10), note: '初始记录' }] : undefined),
        cancelUrl: patch.cancelUrl,
        cancelDifficulty: patch.cancelDifficulty,
        cancellationPlan: patch.cancellationPlan,
        cancellationCheckedAt: patch.cancellationCheckedAt,
        createdAt: Date.now(),
    };
}
function sanitizeAction(raw) {
    const type = String(raw?.type || '');
    if (type === 'createSubscription') {
        const sub = buildSubscription(raw?.draft);
        if (!sub)
            return null;
        const { id: _id, createdAt: _createdAt, ...draft } = sub;
        return { type, draft };
    }
    if (type === 'updateSubscription') {
        const subId = cleanText(raw?.subId, 120);
        const patch = sanitizePatch(raw?.patch);
        if (!subId || Object.keys(patch).length === 0)
            return null;
        return { type, subId, patch };
    }
    if (type === 'mergeSubscriptions') {
        const sourceSubId = cleanText(raw?.sourceSubId, 120);
        const targetSubId = cleanText(raw?.targetSubId, 120);
        const patch = sanitizePatch(raw?.patch);
        if (!sourceSubId || !targetSubId || sourceSubId === targetSubId)
            return null;
        return { type, sourceSubId, targetSubId, ...(Object.keys(patch).length ? { patch } : {}) };
    }
    if (type === 'markPaid' ||
        type === 'pauseSubscription' ||
        type === 'resumeSubscription' ||
        type === 'cancelSubscription') {
        const subId = cleanText(raw?.subId, 120);
        return subId ? { type, subId } : null;
    }
    return null;
}
function extractSubscriptionActionPlan(text) {
    const match = text.match(/```subscription_actions\s*([\s\S]*?)```/i);
    if (!match)
        return null;
    try {
        const parsed = JSON.parse(match[1].trim());
        if (!parsed || !Array.isArray(parsed.actions))
            return null;
        const actions = parsed.actions
            .slice(0, 20)
            .map(sanitizeAction)
            .filter(Boolean);
        if (!actions.length)
            return null;
        return {
            summary: String(parsed.summary || `准备执行 ${actions.length} 项订阅操作`).slice(0, 160),
            actions,
        };
    }
    catch {
        return null;
    }
}
function stripSubscriptionActionBlock(text) {
    return text.replace(/```subscription_actions\s*[\s\S]*?```/gi, '').trim();
}
function describePatch(patch) {
    const labels = [];
    if (patch.name)
        labels.push(`名称改为「${patch.name}」`);
    if (patch.planName)
        labels.push(`套餐改为「${patch.planName}」`);
    if (patch.amount != null)
        labels.push(`金额改为 ¥${patch.amount.toFixed(2)}`);
    if (patch.cycle)
        labels.push(`周期改为 ${patch.cycle}`);
    if (patch.nextDueAt)
        labels.push(`下次扣款改为 ${patch.nextDueAt}`);
    if (patch.paymentMethod)
        labels.push(`支付方式改为「${patch.paymentMethod}」`);
    if (patch.url)
        labels.push('补充管理链接');
    if (patch.cancelUrl)
        labels.push('补充退订链接');
    if (patch.decision)
        labels.push(`决策改为 ${patch.decision}`);
    if (patch.usageNote)
        labels.push('更新使用价值记录');
    if (patch.cancellationPlan)
        labels.push('更新退订步骤');
    if (patch.note)
        labels.push('更新备注');
    if (patch.status)
        labels.push(`状态改为 ${patch.status}`);
    return labels.join('，') || '更新字段';
}
function describeSubscriptionAction(action) {
    switch (action.type) {
        case 'createSubscription':
            return `新增订阅「${action.draft.name || '未命名'}」`;
        case 'updateSubscription':
            return `更新订阅：${describePatch(action.patch)}`;
        case 'mergeSubscriptions':
            return '合并疑似重复订阅';
        case 'markPaid':
            return '标记本期已付款，并推进下次扣款日';
        case 'pauseSubscription':
            return '暂停订阅';
        case 'resumeSubscription':
            return '恢复订阅';
        case 'cancelSubscription':
            return '标记订阅为已取消';
        default:
            return '未知订阅操作';
    }
}
function mergePriceHistory(target, source, patch) {
    const points = [...(target.priceHistory || []), ...(source.priceHistory || [])];
    if (target.amount != null)
        points.push({ amount: target.amount, date: target.startedAt || new Date(target.createdAt || Date.now()).toISOString().slice(0, 10), note: '合并前目标金额' });
    if (source.amount != null)
        points.push({ amount: source.amount, date: source.startedAt || new Date(source.createdAt || Date.now()).toISOString().slice(0, 10), note: `来自重复项：${source.name}` });
    if (patch?.priceHistory)
        points.push(...patch.priceHistory);
    const seen = new Set();
    const deduped = points
        .filter((point) => {
        const key = `${point.date}:${point.amount}:${point.note || ''}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    })
        .sort((a, b) => a.date.localeCompare(b.date));
    return deduped.length ? deduped.slice(-40) : undefined;
}
function appendPricePoint(sub, patch, today) {
    const history = sub.priceHistory || [];
    if (patch.amount == null || patch.amount === sub.amount)
        return patch.priceHistory || sub.priceHistory;
    return [
        ...history,
        { amount: sub.amount, date: sub.lastPaidAt || sub.startedAt || today, note: '变更前金额' },
        { amount: patch.amount, date: patch.nextDueAt || today, note: 'AI 更新金额' },
    ].slice(-40);
}
/** 给订阅就地补上 App Store 真实图标（拿不到则保持原样，不抛错） */
async function enrichSubscriptionIcon(sub) {
    try {
        const apps = await (0, appStore_1.searchAppStoreApps)(sub.name, { limit: 1 });
        const app = apps[0];
        if (!app)
            return;
        sub.appStoreId = sub.appStoreId || app.trackId;
        const inline = await (0, appStore_1.fetchIconAsDataUrl)(app.iconUrl).catch(() => null);
        sub.iconUrl = inline || app.iconUrl;
    }
    catch {
        // 无网络或被限流时静默跳过
    }
}
async function applySubscriptionActionPlan(storage, plan) {
    let applied = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const action of plan.actions) {
        if (action.type === 'createSubscription') {
            const sub = buildSubscription(action.draft);
            if (!sub)
                continue;
            if (!sub.iconUrl)
                await enrichSubscriptionIcon(sub);
            await storage.put('subscriptions', sub);
            applied += 1;
            continue;
        }
        if (action.type === 'mergeSubscriptions') {
            const source = await storage.get('subscriptions', action.sourceSubId);
            const target = await storage.get('subscriptions', action.targetSubId);
            if (!source || !target)
                continue;
            const patch = action.patch || {};
            await storage.put('subscriptions', {
                ...target,
                note: [target.note, source.note, patch.note].filter(Boolean).join('\n'),
                evidenceText: [target.evidenceText, source.evidenceText, patch.evidenceText].filter(Boolean).join('\n---\n') || undefined,
                ...patch,
                priceHistory: mergePriceHistory(target, source, patch),
            });
            await storage.del('subscriptions', source.id);
            applied += 1;
            continue;
        }
        const sub = await storage.get('subscriptions', action.subId);
        if (!sub)
            continue;
        if (action.type === 'updateSubscription') {
            await storage.put('subscriptions', {
                ...sub,
                ...action.patch,
                priceHistory: appendPricePoint(sub, action.patch, today),
            });
            applied += 1;
            continue;
        }
        if (action.type === 'markPaid') {
            const advanced = (0, subscription_1.renewSubDue)(sub);
            await storage.put('subscriptions', { ...advanced, lastPaidAt: today });
            applied += 1;
            continue;
        }
        if (action.type === 'pauseSubscription') {
            await storage.put('subscriptions', { ...sub, status: 'paused' });
            applied += 1;
            continue;
        }
        if (action.type === 'resumeSubscription') {
            await storage.put('subscriptions', { ...sub, status: 'active' });
            applied += 1;
            continue;
        }
        if (action.type === 'cancelSubscription') {
            await storage.put('subscriptions', {
                ...sub,
                status: 'cancelled',
                autoRenew: false,
                endAt: sub.endAt || today,
            });
            applied += 1;
        }
    }
    if (applied) {
        await (0, actionLog_1.logAction)(storage, {
            source: 'ai',
            type: 'subscription_action_plan_applied',
            summary: `${plan.summary}：已应用 ${applied} 项订阅变更`,
            after: plan,
        });
    }
    return applied;
}
function findSub(subscriptions, id) {
    return subscriptions?.find((sub) => sub.id === id);
}
function money(value) {
    return `¥${(value || 0).toFixed(2)}`;
}
const SOURCE_LABEL = {
    manual: '手动',
    ai_text: '文本',
    ai_vision: '截图',
    csv: 'CSV',
    email: '邮件',
    sms: '短信',
    bank: '账单',
};
function cycleName(value) {
    return models_1.SUB_CYCLES.find((cycle) => cycle.id === value)?.name || '每月';
}
function sourceName(value) {
    return value ? SOURCE_LABEL[value] || value : '';
}
function previewSubscriptionAction(action, subscriptions = []) {
    if (action.type === 'createSubscription') {
        const draft = action.draft;
        return {
            title: `新增「${draft.name || '未命名'}」`,
            detail: `${money(draft.amount)} / ${cycleName(draft.cycle)}${draft.nextDueAt ? `，下次 ${draft.nextDueAt}` : ''}${draft.source ? `，来源 ${sourceName(draft.source)}` : ''}`,
            tone: 'neutral',
        };
    }
    if (action.type === 'mergeSubscriptions') {
        const source = findSub(subscriptions, action.sourceSubId);
        const target = findSub(subscriptions, action.targetSubId);
        return {
            title: `合并「${source?.name || action.sourceSubId}」`,
            detail: `并入「${target?.name || action.targetSubId}」，保留价格历史和证据文本`,
            tone: 'warn',
        };
    }
    const sub = findSub(subscriptions, action.subId);
    if (!sub)
        return { title: describeSubscriptionAction(action), detail: `目标：${action.subId}`, tone: 'neutral' };
    if (action.type === 'updateSubscription') {
        const changes = [];
        if (action.patch.amount != null && action.patch.amount !== sub.amount)
            changes.push(`金额 ${money(sub.amount)} → ${money(action.patch.amount)}`);
        if (action.patch.cycle && action.patch.cycle !== sub.cycle)
            changes.push(`周期 ${cycleName(sub.cycle)} → ${cycleName(action.patch.cycle)}`);
        if (action.patch.nextDueAt && action.patch.nextDueAt !== sub.nextDueAt)
            changes.push(`扣款日 ${sub.nextDueAt || '未设定'} → ${action.patch.nextDueAt}`);
        if (action.patch.decision && action.patch.decision !== sub.decision)
            changes.push(`决策 ${sub.decision || '未定'} → ${action.patch.decision}`);
        if (action.patch.cancellationPlan)
            changes.push(`退订步骤 ${action.patch.cancellationPlan.length} 步`);
        return {
            title: `更新「${sub.name}」`,
            detail: changes.join('；') || describePatch(action.patch),
            tone: 'neutral',
        };
    }
    if (action.type === 'pauseSubscription') {
        return {
            title: `暂停「${sub.name}」`,
            detail: `状态 active → paused，预计月均少支出 ${money((0, subscription_1.subscriptionMonthlyCost)(sub))}`,
            tone: 'save',
        };
    }
    if (action.type === 'cancelSubscription') {
        return {
            title: `取消「${sub.name}」`,
            detail: `状态 ${sub.status} → cancelled，关闭自动续费并记录结束日期`,
            tone: 'save',
        };
    }
    if (action.type === 'resumeSubscription') {
        return {
            title: `恢复「${sub.name}」`,
            detail: `状态 ${sub.status} → active`,
            tone: 'warn',
        };
    }
    return {
        title: `标记「${sub.name}」已付`,
        detail: `lastPaidAt 更新为今天，并按周期推进下次扣款日`,
        tone: 'neutral',
    };
}
