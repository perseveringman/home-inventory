/**
 * 领域模型 —— 三端共享的纯 TS 数据类型。
 * 与存储层、UI 层完全解耦。
 */

/* ========== 基础 ========== */

export type ID = string;

export interface Rect {
  x: number; // 0~1 归一化
  y: number;
  w: number;
  h: number;
}

/* ========== 房间 / 照片 / 柜子 / 物品 ========== */

export interface Room {
  id: ID;
  name: string;
  icon: string;
  createdAt: number;
}

export interface Photo {
  id: ID;
  roomId: ID;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

/* ========== AI 审核 / 标签 / 操作日志 ========== */

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited';
export type ScanCandidateKind = 'cabinet' | 'item';
export type PlacementSource = 'ai' | 'user';

export interface ScanCandidate {
  id: ID;
  kind: ScanCandidateKind;
  name: string;
  rect: Rect;
  emoji?: string;
  confidence?: number;
  aiReason?: string;
  suggestedCabinetCandidateId?: ID;
  placementConfidence?: number;
  placementReason?: string;
  placementSource?: PlacementSource;
  reviewStatus: ReviewStatus;
  userCorrection?: string;
  createdAt: number;
}

export type ScanSessionStatus = 'reviewing' | 'applied' | 'discarded';

export interface ScanSession {
  id: ID;
  photoId: ID;
  roomId: ID;
  status: ScanSessionStatus;
  candidates: ScanCandidate[];
  createdAt: number;
  appliedAt?: number;
}

export type RecognitionTaskStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type RecognitionTaskSource = 'camera' | 'gallery' | 'photo' | 'native-items';

export interface RecognitionTaskNativeItem {
  id: ID;
  image: Blob;
  rect?: Rect;
  rotation?: number;
  confidence?: number;
  nameHint?: string;
}

export interface RecognitionTask {
  id: ID;
  photoId: ID;
  roomId: ID | '__global__';
  source: RecognitionTaskSource;
  status: RecognitionTaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  scanSessionId?: ID;
  candidateCounts?: {
    cabinets: number;
    items: number;
  };
  nativeItems?: RecognitionTaskNativeItem[];
  errorMessage?: string;
}

export type LabelTargetType = 'room' | 'cabinet' | 'item';
export type LabelStatus = 'unclaimed' | 'linked' | 'revoked';

export interface Label {
  id: ID;
  code: string;
  homeId?: string;
  labelNo?: string;
  targetType?: LabelTargetType;
  targetId?: ID;
  status: LabelStatus;
  createdAt: number;
  updatedAt?: number;
}

export type ActionLogSource = 'user' | 'ai' | 'system';

export interface ActionLog {
  id: ID;
  source: ActionLogSource;
  type: string;
  summary: string;
  targetType?: string;
  targetId?: ID;
  before?: unknown;
  after?: unknown;
  createdAt: number;
}

export type CabinetType = 'normal' | 'loose' | 'loose-global';

export interface Cabinet {
  id: ID;
  photoId: ID | null; // loose / loose-global 时为 null
  roomId: ID; // loose-global 时为 '__global__'
  name: string;
  rect: Rect;
  type?: CabinetType;
  createdAt: number;
}

export const GLOBAL_ROOM_ID = '__global__';

export type ItemStatus = 'pending' | 'placed';
export type ItemSource = 'manual' | 'ai';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | '';

export interface Item {
  id: ID;
  cabinetId: ID;
  roomId: ID | '__global__';
  name: string;
  qty: number;
  note: string;
  tags: string[];
  image?: Blob;
  /** yyyy-mm-dd */
  expiry?: string;

  status: ItemStatus;
  source: ItemSource;
  sourcePhotoId?: ID | null;

  aiEmoji?: string;
  aiRect?: Rect;

  // 扩展字段
  openedAt?: string;        // yyyy-mm-dd
  openedShelfDays?: number | null;
  purchasedAt?: string;
  warrantyMonths?: number | null;
  minStock?: number | null;
  season?: Season;

  // 家庭资产脑字段
  brand?: string;
  modelNumber?: string;
  serialNumber?: string;
  purchasePrice?: number | null;
  manualUrl?: string;
  receiptNote?: string;

  // AI 信任与反馈
  confidence?: number;
  aiReason?: string;
  reviewStatus?: ReviewStatus;
  userCorrection?: string;

  createdAt: number;
  lastTouchedAt?: number;
}

/* ========== 物品清单（手动维护的物品集合，多对多） ========== */

export interface ItemList {
  id: ID;
  name: string;
  /** 单 emoji，做为清单封面图标 */
  emoji?: string;
  /** 清单包含的物品 id（多对多关系存这里） */
  itemIds: ID[];
  /** 用户写的简短描述 */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/* ========== 订阅（定期账单） ========== */

export type SubCategory =
  | 'software'
  | 'loan'
  | 'utility'
  | 'rent'
  | 'membership'
  | 'insurance'
  | 'telecom'
  | 'other';

export type SubCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type SubStatus = 'active' | 'paused' | 'cancelled';
export type SubscriptionSource =
  | 'manual'
  | 'ai_text'
  | 'ai_vision'
  | 'csv'
  | 'email'
  | 'sms'
  | 'bank';
export type SubscriptionDecision = 'keep' | 'review' | 'cancel';
export type CancellationDifficulty = 'easy' | 'medium' | 'hard';

export interface SubscriptionPricePoint {
  amount: number;
  /** yyyy-mm-dd */
  date: string;
  note?: string;
}

export interface CancellationStep {
  id: ID;
  text: string;
  done?: boolean;
}

export interface Subscription {
  id: ID;
  name: string;
  /** 短文字标识（如 NF），无图标时回退展示 */
  icon?: string;
  /** 应用图标：可为远程 url 或内联 dataURL（来自 App Store / 用户上传） */
  iconUrl?: string;
  /** iTunes trackId，标记该订阅关联的 App Store 应用 */
  appStoreId?: number;
  category: SubCategory;
  amount: number;
  currency?: string;
  cycle: SubCycle;
  cycleDays?: number; // custom 时生效
  /** yyyy-mm-dd 下次扣款日 */
  nextDueAt?: string;
  startedAt?: string;
  endAt?: string;
  autoRenew?: boolean;
  paymentMethod?: string;
  url?: string;
  note?: string;
  status: SubStatus;
  lastPaidAt?: string;

  // AI native subscription brain
  planName?: string;
  owner?: string;
  usageNote?: string;
  lastUsedAt?: string;
  decision?: SubscriptionDecision;
  reviewBeforeDays?: number | null;
  source?: SubscriptionSource;
  confidence?: number;
  evidenceText?: string;
  importBatchId?: string;
  priceHistory?: SubscriptionPricePoint[];
  cancelUrl?: string;
  cancelDifficulty?: CancellationDifficulty;
  cancellationPlan?: CancellationStep[];
  cancellationCheckedAt?: string;

  createdAt: number;
}

/* ========== 提醒事件 ========== */

export type ReminderKind =
  | 'expiry'
  | 'opened'
  | 'warranty'
  | 'lowstock'
  | 'seasonal'
  | 'dust'
  | 'subscription';

export type ReminderLevel = 'critical' | 'warn' | 'info';

export interface ReminderEvent {
  kind: ReminderKind;
  level: ReminderLevel;
  /** 事件指向的物品（订阅事件没有） */
  itemId?: ID;
  /** 订阅事件指向订阅 */
  subId?: ID;
  title: string;
  subtitle: string;
  /** 越小越紧急，负数为已过 */
  daysLeft: number;
  icon: string;
}

/* ========== 常量 ========== */

export const PRESET_TAGS: Array<{ name: string; emoji: string }> = [
  { name: '药品', emoji: '💊' },
  { name: '保健品', emoji: '🌿' },
  { name: '食品', emoji: '🍱' },
  { name: '零食', emoji: '🍪' },
  { name: '饮料', emoji: '🥤' },
  { name: '数码', emoji: '💻' },
  { name: '家电', emoji: '🔌' },
  { name: '衣物', emoji: '👕' },
  { name: '书籍', emoji: '📚' },
  { name: '文具', emoji: '✏️' },
  { name: '工具', emoji: '🔧' },
  { name: '玩具', emoji: '🧸' },
  { name: '美妆', emoji: '💄' },
  { name: '日用', emoji: '🧻' },
  { name: '厨具', emoji: '🍳' },
];

export const SUB_CATEGORIES: Array<{ id: SubCategory; name: string; emoji: string }> = [
  { id: 'software', name: '软件', emoji: '💻' },
  { id: 'loan', name: '贷款', emoji: '🏦' },
  { id: 'utility', name: '水电煤', emoji: '💡' },
  { id: 'rent', name: '房租', emoji: '🏠' },
  { id: 'membership', name: '会员', emoji: '🎫' },
  { id: 'insurance', name: '保险', emoji: '🛟' },
  { id: 'telecom', name: '通讯', emoji: '📱' },
  { id: 'other', name: '其他', emoji: '📌' },
];

export const SUB_CYCLES: Array<{ id: SubCycle; name: string; days: number }> = [
  { id: 'weekly', name: '每周', days: 7 },
  { id: 'monthly', name: '每月', days: 30 },
  { id: 'quarterly', name: '每季', days: 91 },
  { id: 'yearly', name: '每年', days: 365 },
  { id: 'custom', name: '自定义', days: 30 },
];

export const REMINDER_ICONS: Record<ReminderKind, string> = {
  expiry: '⏰',
  opened: '🧃',
  warranty: '🛡️',
  lowstock: '📉',
  seasonal: '🗓️',
  dust: '💤',
  subscription: '💳',
};

export const REMINDER_KIND_LABEL: Record<ReminderKind, string> = {
  expiry: '保质期',
  opened: '开封后',
  warranty: '保修',
  lowstock: '库存',
  seasonal: '换季',
  dust: '久未动',
  subscription: '订阅扣款',
};

export const ROOM_ICONS = ['🛋️', '🛏️', '🍳', '🚿', '📚', '👕', '🧸', '🧺', '🧑‍💻', '🏠'];

export const ROOM_PRESETS: Array<{ name: string; icon: string }> = [
  { name: '客厅', icon: '🛋️' },
  { name: '卧室', icon: '🛏️' },
  { name: '厨房', icon: '🍳' },
  { name: '书房', icon: '📚' },
  { name: '卫生间', icon: '🚿' },
  { name: '衣帽间', icon: '👕' },
  { name: '儿童房', icon: '🧸' },
  { name: '阳台', icon: '🧺' },
];
