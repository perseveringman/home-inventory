"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reminder_1 = require("../src/services/reminder");
const subscription_1 = require("../src/services/subscription");
const subscriptionActions_1 = require("../src/services/subscriptionActions");
const subscriptionImport_1 = require("../src/services/subscriptionImport");
const appStore_1 = require("../src/services/appStore");
const quickAdd_1 = require("../src/services/quickAdd");
const kitchenSuggestion_1 = require("../src/services/kitchenSuggestion");
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
class MemoryStorage {
    data = new Map();
    constructor(subscriptions = []) {
        this.data.set('subscriptions', new Map(subscriptions.map((sub) => [sub.id, sub])));
        this.data.set('actionLogs', new Map());
    }
    async all(store) {
        return Array.from((this.data.get(store) || new Map()).values());
    }
    async get(store, id) {
        return (this.data.get(store) || new Map()).get(id);
    }
    async byIndex() {
        return [];
    }
    async put(store, obj) {
        if (!this.data.has(store))
            this.data.set(store, new Map());
        this.data.get(store).set(obj.id, obj);
    }
    async add(store, obj) {
        await this.put(store, obj);
    }
    async del(store, id) {
        this.data.get(store)?.delete(id);
    }
    async clearAll() {
        this.data.clear();
    }
}
const baseSub = (patch) => ({
    id: patch.id || `sub-${Math.random()}`,
    name: patch.name || 'Test',
    category: patch.category || 'software',
    amount: patch.amount ?? 10,
    cycle: patch.cycle || 'monthly',
    status: patch.status || 'active',
    autoRenew: patch.autoRenew ?? true,
    createdAt: patch.createdAt || Date.now(),
    ...patch,
});
function localDateAfter(days) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
const baseItem = (patch) => ({
    id: patch.id || `item-${Math.random()}`,
    cabinetId: patch.cabinetId || 'cabinet',
    roomId: patch.roomId || 'kitchen',
    name: patch.name || 'Item',
    qty: patch.qty ?? 1,
    note: patch.note || '',
    tags: patch.tags || [],
    status: patch.status || 'placed',
    source: patch.source || 'manual',
    createdAt: patch.createdAt || Date.now(),
    ...patch,
});
async function run() {
    const quickAdd = (0, quickAdd_1.parseQuickAddDraft)('书房里有一对真力g1音箱，四个充电宝', {
        rooms: [
            { id: 'study', name: '书房' },
            { id: 'living', name: '客厅' },
        ],
    });
    assert(quickAdd.mode === 'natural', 'voice-style quick add should use natural parser');
    assert(quickAdd.roomId === 'study', 'voice-style quick add should infer room');
    assert(quickAdd.lines.length === 2, 'voice-style quick add should extract two items');
    assert(quickAdd.lines[0]?.name === '真力g1音箱', 'voice-style quick add should extract speaker name');
    assert(quickAdd.lines[0]?.qty === 2, 'one pair should become quantity 2');
    assert(quickAdd.lines[1]?.name === '充电宝', 'voice-style quick add should extract power bank name');
    assert(quickAdd.lines[1]?.qty === 4, 'Chinese quantity should be parsed');
    assert((0, quickAdd_1.formatQuickAddLines)(quickAdd.lines) === '真力g1音箱×2\n充电宝×4', 'voice lines should format as quick-add syntax');
    const quickAddWithoutRooms = (0, quickAdd_1.parseQuickAddDraft)('书房里有一对真力g1音箱，四个充电宝');
    assert(quickAddWithoutRooms.lines[0]?.name === '真力g1音箱', 'location prefix should not leak into item name');
    const manual = (0, quickAdd_1.parseQuickAddDraft)('螺丝刀, 工具盒里');
    assert(manual.lines.length === 1 && manual.lines[0]?.note === '工具盒里', 'manual comma note should stay a note');
    const kitchenRooms = [
        { id: 'kitchen', name: '厨房', icon: '🍳', createdAt: 1 },
        { id: 'study', name: '书房', icon: '📚', createdAt: 1 },
    ];
    const kitchenCabinets = [
        { id: 'desk', roomId: 'study', photoId: null, name: '桌面抽屉收纳盒', rect: { x: 0, y: 0, w: 0, h: 0 }, createdAt: 1 },
        { id: 'fridge', roomId: 'kitchen', photoId: null, name: '冰箱冷藏', rect: { x: 0, y: 0, w: 0, h: 0 }, createdAt: 1 },
    ];
    assert(!(0, kitchenSuggestion_1.isKitchenInventoryItem)(baseItem({ name: '粉色章鱼玩偶', roomId: 'study', cabinetId: 'desk' }), kitchenRooms, kitchenCabinets), 'octopus plush should not be kitchen food');
    assert(!(0, kitchenSuggestion_1.isKitchenInventoryItem)(baseItem({ name: '桌面杂物', roomId: 'study', cabinetId: 'desk' }), kitchenRooms, kitchenCabinets), 'desktop clutter should not match the single char 面');
    assert(!(0, kitchenSuggestion_1.isKitchenInventoryItem)(baseItem({ name: '白色抽屉盒', roomId: 'study', cabinetId: 'desk' }), kitchenRooms, kitchenCabinets), 'storage drawer box should not be kitchen food');
    assert((0, kitchenSuggestion_1.isKitchenInventoryItem)(baseItem({ name: '番茄', roomId: 'study', cabinetId: 'desk' }), kitchenRooms, kitchenCabinets), 'food name should be kitchen inventory even outside kitchen room');
    assert((0, kitchenSuggestion_1.isKitchenInventoryItem)(baseItem({ name: '牛奶', roomId: 'kitchen', cabinetId: 'fridge' }), kitchenRooms, kitchenCabinets), 'milk should be kitchen inventory');
    assert((0, kitchenSuggestion_1.isKitchenInventoryItem)(baseItem({ name: '酱油', roomId: 'kitchen', cabinetId: 'fridge' }), kitchenRooms, kitchenCabinets), 'seasoning should be kitchen inventory');
    const csv = [
        'name,amount,cycle,nextDueAt,paymentMethod,url,note',
        'ChatGPT Plus,145,monthly,2026-05-20,Apple Pay,,工作工具',
        'iCloud+,21,每月,2026/05/28,Apple Pay,https://apple.example/manage,云盘',
    ].join('\n');
    const importPlan = (0, subscriptionImport_1.buildSubscriptionImportPlanFromCsv)(csv);
    assert(importPlan?.actions.length === 2, 'CSV should create two subscription actions');
    assert(importPlan.actions[1].type === 'createSubscription', 'CSV action should create subscription');
    const receiptPlan = (0, subscriptionImport_1.buildSubscriptionImportPlanFromText)(`续费凭证
续费金额
¥7.90
续费项目: 买菜会员包月微信自动续费
续费方式: 零钱`);
    assert(receiptPlan?.actions.length === 1, 'receipt text should create one subscription action');
    const receiptAction = receiptPlan.actions[0];
    assert(receiptAction.type === 'createSubscription', 'receipt action should create subscription');
    assert(receiptAction.draft.name === '买菜会员包月', 'receipt should extract the subscription name');
    assert(receiptAction.draft.amount === 7.9, 'receipt should extract the amount');
    assert(receiptAction.draft.cycle === 'monthly', 'receipt should infer monthly cycle');
    assert(receiptAction.draft.paymentMethod === '零钱', 'receipt should extract payment method');
    const parsed = (0, subscriptionActions_1.extractSubscriptionActionPlan)(`ok
\`\`\`subscription_actions
{"summary":"处理订阅","actions":[
{"type":"updateSubscription","subId":"chatgpt","patch":{"amount":168,"priceHistory":[{"amount":145,"date":"2026-04-01"},{"amount":168,"date":"2026-05-01"}]}},
{"type":"mergeSubscriptions","sourceSubId":"icloud-old","targetSubId":"icloud-new"}
]}
\`\`\``);
    assert(parsed?.actions.length === 2, 'subscription_actions should parse update and merge');
    const storage = new MemoryStorage([
        baseSub({ id: 'chatgpt', name: 'ChatGPT Plus', amount: 145, nextDueAt: '2026-05-20' }),
        baseSub({ id: 'icloud-old', name: 'iCloud Plus', amount: 21, nextDueAt: '2026-05-28', note: 'old' }),
        baseSub({ id: 'icloud-new', name: 'iCloud+', amount: 21, nextDueAt: '2026-05-28', note: 'new' }),
    ]);
    const applied = await (0, subscriptionActions_1.applySubscriptionActionPlan)(storage, parsed);
    const updated = await storage.get('subscriptions', 'chatgpt');
    const mergedOld = await storage.get('subscriptions', 'icloud-old');
    const mergedNew = await storage.get('subscriptions', 'icloud-new');
    assert(applied === 2, 'two actions should apply');
    assert(updated?.amount === 168, 'update should change amount');
    assert((updated?.priceHistory || []).length >= 2, 'update should preserve price history');
    assert(!mergedOld, 'merge should delete source subscription');
    assert(mergedNew?.note?.includes('old'), 'merge should carry source note');
    const subs = [
        baseSub({ id: 'a', name: 'Notion Plus', amount: 80 }),
        baseSub({ id: 'b', name: 'Notion 会员', amount: 80 }),
        baseSub({
            id: 'c',
            name: 'Domain',
            amount: 120,
            cycle: 'yearly',
            nextDueAt: '2026-06-01',
            decision: 'review',
            priceHistory: [
                { amount: 80, date: '2025-06-01' },
                { amount: 120, date: '2026-06-01' },
            ],
        }),
    ];
    assert((0, subscription_1.findDuplicateSubscriptions)(subs).length === 1, 'duplicate finder should group similar subscriptions');
    assert((0, subscription_1.buildSubscriptionInsights)(subs).some((insight) => insight.id === 'price-hike'), 'insights should include price hike');
    assert((0, reminder_1.computeSubscriptionEvents)(subs).some((event) => event.subId === 'c' && event.subtitle.includes('续费前复核')), 'events should include renewal review reminder');
    const autoRenewDue = baseSub({
        id: 'auto-renew-due',
        name: 'Auto Renew',
        autoRenew: true,
        nextDueAt: localDateAfter(2),
    });
    const manualRenewDue = baseSub({
        id: 'manual-renew-due',
        name: 'Manual Renew',
        autoRenew: false,
        nextDueAt: localDateAfter(6),
    });
    const renewalEvents = (0, reminder_1.computeSubscriptionEvents)([autoRenewDue, manualRenewDue]);
    const autoEvent = renewalEvents.find((event) => event.subId === 'auto-renew-due' && event.subtitle.includes('自动续期'));
    const manualEvent = renewalEvents.find((event) => event.subId === 'manual-renew-due' && event.subtitle.includes('到期'));
    assert(autoEvent?.level === 'info', 'auto-renew subscription reminders should stay info');
    assert(manualEvent?.level === 'warn', 'manual-renew subscription reminders should warn inside seven days');
    // ===== App Store 图标：尺寸升级 =====
    const up = (0, appStore_1.upgradeArtwork)('https://is1-ssl.mzstatic.com/image/thumb/abc/100x100bb.jpg');
    assert(up.includes('512x512bb.jpg'), 'artwork url should upgrade to 512');
    // ===== 语音订阅草稿：本地规则解析 =====
    const voice = (0, subscriptionImport_1.buildVoiceSubscriptionDraft)('我开了爱奇艺黄金会员，每个月25块，用微信付的');
    assert(!!voice && voice.name?.includes('爱奇艺'), 'voice draft should extract name');
    assert(voice.amount === 25, 'voice draft should extract amount');
    assert(voice.cycle === 'monthly', 'voice draft should infer monthly cycle');
    assert(voice.paymentMethod === '微信', 'voice draft should detect WeChat payment');
    assert(voice.category === 'membership', 'voice draft should classify membership');
    const voiceYearly = (0, subscriptionImport_1.buildVoiceSubscriptionDraft)('订阅了 Netflix，每年 588 元');
    assert(voiceYearly.cycle === 'yearly', 'voice draft should infer yearly cycle');
    assert(voiceYearly.amount === 588, 'voice draft should extract yearly amount');
    // ===== 新增图标字段的清洗：iconUrl / appStoreId 落库 =====
    const iconPlan = (0, subscriptionActions_1.extractSubscriptionActionPlan)('```subscription_actions\n' +
        JSON.stringify({
            summary: 'with icon',
            actions: [
                {
                    type: 'createSubscription',
                    draft: {
                        name: 'Spotify',
                        category: 'membership',
                        amount: 18,
                        cycle: 'monthly',
                        iconUrl: 'https://example.com/a/512x512bb.jpg',
                        appStoreId: 324684580,
                    },
                },
            ],
        }) +
        '\n```');
    assert(!!iconPlan, 'icon plan should parse');
    const created = iconPlan.actions[0];
    assert(created?.type === 'createSubscription', 'should be create action');
    if (created?.type === 'createSubscription') {
        assert(created.draft.iconUrl === 'https://example.com/a/512x512bb.jpg', 'iconUrl should survive sanitize');
        assert(created.draft.appStoreId === 324684580, 'appStoreId should survive sanitize');
    }
}
run()
    .then(() => {
    console.log('subscription AI tests passed');
})
    .catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
