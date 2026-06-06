"use strict";
/**
 * 领域模型 —— 三端共享的纯 TS 数据类型。
 * 与存储层、UI 层完全解耦。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROOM_PRESETS = exports.ROOM_ICONS = exports.REMINDER_KIND_LABEL = exports.REMINDER_ICONS = exports.SUB_CYCLES = exports.SUB_CATEGORIES = exports.PRESET_TAGS = exports.GLOBAL_ROOM_ID = void 0;
exports.GLOBAL_ROOM_ID = '__global__';
/* ========== 常量 ========== */
exports.PRESET_TAGS = [
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
exports.SUB_CATEGORIES = [
    { id: 'software', name: '软件', emoji: '💻' },
    { id: 'loan', name: '贷款', emoji: '🏦' },
    { id: 'utility', name: '水电煤', emoji: '💡' },
    { id: 'rent', name: '房租', emoji: '🏠' },
    { id: 'membership', name: '会员', emoji: '🎫' },
    { id: 'insurance', name: '保险', emoji: '🛟' },
    { id: 'telecom', name: '通讯', emoji: '📱' },
    { id: 'other', name: '其他', emoji: '📌' },
];
exports.SUB_CYCLES = [
    { id: 'weekly', name: '每周', days: 7 },
    { id: 'monthly', name: '每月', days: 30 },
    { id: 'quarterly', name: '每季', days: 91 },
    { id: 'yearly', name: '每年', days: 365 },
    { id: 'custom', name: '自定义', days: 30 },
];
exports.REMINDER_ICONS = {
    expiry: '⏰',
    opened: '🧃',
    warranty: '🛡️',
    lowstock: '📉',
    seasonal: '🗓️',
    dust: '💤',
    subscription: '💳',
};
exports.REMINDER_KIND_LABEL = {
    expiry: '保质期',
    opened: '开封后',
    warranty: '保修',
    lowstock: '库存',
    seasonal: '换季',
    dust: '久未动',
    subscription: '订阅扣款',
};
exports.ROOM_ICONS = ['🛋️', '🛏️', '🍳', '🚿', '📚', '👕', '🧸', '🧺', '🧑‍💻', '🏠'];
exports.ROOM_PRESETS = [
    { name: '客厅', icon: '🛋️' },
    { name: '卧室', icon: '🛏️' },
    { name: '厨房', icon: '🍳' },
    { name: '书房', icon: '📚' },
    { name: '卫生间', icon: '🚿' },
    { name: '衣帽间', icon: '👕' },
    { name: '儿童房', icon: '🧸' },
    { name: '阳台', icon: '🧺' },
];
