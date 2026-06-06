"use strict";
/**
 * AI 跳转动作：AI 输出 ```navigate``` 块，前端提取后渲染按钮，
 * 用户点击才真正跳转（与 inventory_actions 一致的"提议→确认"模型）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNavigateActions = extractNavigateActions;
exports.stripNavigateBlock = stripNavigateBlock;
function extractNavigateActions(text) {
    const matches = text.matchAll(/```navigate\s*([\s\S]*?)```/gi);
    const actions = [];
    for (const m of matches) {
        const body = (m[1] || '').trim();
        if (!body)
            continue;
        try {
            const parsed = JSON.parse(body);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (item && typeof item.path === 'string' && item.path.startsWith('/')) {
                        actions.push({ path: item.path, reason: item.reason ? String(item.reason) : undefined });
                    }
                }
            }
            else if (parsed && typeof parsed.path === 'string' && parsed.path.startsWith('/')) {
                actions.push({
                    path: parsed.path,
                    reason: parsed.reason ? String(parsed.reason) : undefined,
                });
            }
        }
        catch {
            // skip malformed block
        }
    }
    // 去重 + 限制数量
    const seen = new Set();
    const unique = [];
    for (const a of actions) {
        if (seen.has(a.path))
            continue;
        seen.add(a.path);
        unique.push(a);
        if (unique.length >= 6)
            break;
    }
    return unique;
}
function stripNavigateBlock(text) {
    return text.replace(/```navigate\s*[\s\S]*?```/gi, '').trim();
}
