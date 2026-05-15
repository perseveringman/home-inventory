import type { StoreName, StoreSchema, Storage } from '../src/storage/types';
import type { Subscription } from '../src/models';
import { computeSubscriptionEvents } from '../src/services/reminder';
import {
  buildSubscriptionInsights,
  findDuplicateSubscriptions,
} from '../src/services/subscription';
import {
  applySubscriptionActionPlan,
  extractSubscriptionActionPlan,
} from '../src/services/subscriptionActions';
import {
  buildSubscriptionImportPlanFromCsv,
  buildSubscriptionImportPlanFromText,
} from '../src/services/subscriptionImport';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryStorage implements Storage {
  data = new Map<StoreName, Map<string, any>>();

  constructor(subscriptions: Subscription[] = []) {
    this.data.set('subscriptions', new Map(subscriptions.map((sub) => [sub.id, sub])));
    this.data.set('actionLogs', new Map());
  }

  async all<K extends StoreName>(store: K): Promise<StoreSchema[K][]> {
    return Array.from((this.data.get(store) || new Map()).values());
  }

  async get<K extends StoreName>(store: K, id: string): Promise<StoreSchema[K] | undefined> {
    return (this.data.get(store) || new Map()).get(id);
  }

  async byIndex<K extends StoreName>(): Promise<StoreSchema[K][]> {
    return [];
  }

  async put<K extends StoreName>(store: K, obj: StoreSchema[K]): Promise<void> {
    if (!this.data.has(store)) this.data.set(store, new Map());
    this.data.get(store)!.set((obj as any).id, obj);
  }

  async add<K extends StoreName>(store: K, obj: StoreSchema[K]): Promise<void> {
    await this.put(store, obj);
  }

  async del(store: StoreName, id: string): Promise<void> {
    this.data.get(store)?.delete(id);
  }

  async clearAll(): Promise<void> {
    this.data.clear();
  }
}

const baseSub = (patch: Partial<Subscription>): Subscription => ({
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

async function run() {
  const csv = [
    'name,amount,cycle,nextDueAt,paymentMethod,url,note',
    'ChatGPT Plus,145,monthly,2026-05-20,Apple Pay,,工作工具',
    'iCloud+,21,每月,2026/05/28,Apple Pay,https://apple.example/manage,云盘',
  ].join('\n');
  const importPlan = buildSubscriptionImportPlanFromCsv(csv);
  assert(importPlan?.actions.length === 2, 'CSV should create two subscription actions');
  assert(importPlan.actions[1]!.type === 'createSubscription', 'CSV action should create subscription');

  const receiptPlan = buildSubscriptionImportPlanFromText(`续费凭证
续费金额
¥7.90
续费项目: 买菜会员包月微信自动续费
续费方式: 零钱`);
  assert(receiptPlan?.actions.length === 1, 'receipt text should create one subscription action');
  const receiptAction = receiptPlan.actions[0]!;
  assert(receiptAction.type === 'createSubscription', 'receipt action should create subscription');
  assert(receiptAction.draft.name === '买菜会员包月', 'receipt should extract the subscription name');
  assert(receiptAction.draft.amount === 7.9, 'receipt should extract the amount');
  assert(receiptAction.draft.cycle === 'monthly', 'receipt should infer monthly cycle');
  assert(receiptAction.draft.paymentMethod === '零钱', 'receipt should extract payment method');

  const parsed = extractSubscriptionActionPlan(`ok
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
  const applied = await applySubscriptionActionPlan(storage, parsed!);
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
  assert(findDuplicateSubscriptions(subs).length === 1, 'duplicate finder should group similar subscriptions');
  assert(buildSubscriptionInsights(subs).some((insight) => insight.id === 'price-hike'), 'insights should include price hike');
  assert(computeSubscriptionEvents(subs).some((event) => event.subId === 'c' && event.subtitle.includes('续费前复核')), 'events should include renewal review reminder');
}

run()
  .then(() => {
    console.log('subscription AI tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
