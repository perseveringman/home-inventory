/**
 * AI 跳转动作：AI 输出 ```navigate``` 块，前端提取后渲染按钮，
 * 用户点击才真正跳转（与 inventory_actions 一致的"提议→确认"模型）。
 */

export interface NavigateAction {
  /** 目标路径，如 /views/list/abc 或 /views?tab=tags */
  path: string;
  /** 给用户看的按钮文案，例如"打开你的旅行必备清单" */
  reason?: string;
}

export function extractNavigateActions(text: string): NavigateAction[] {
  const matches = text.matchAll(/```navigate\s*([\s\S]*?)```/gi);
  const actions: NavigateAction[] = [];
  for (const m of matches) {
    const body = (m[1] || '').trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.path === 'string' && item.path.startsWith('/')) {
            actions.push({ path: item.path, reason: item.reason ? String(item.reason) : undefined });
          }
        }
      } else if (parsed && typeof parsed.path === 'string' && parsed.path.startsWith('/')) {
        actions.push({
          path: parsed.path,
          reason: parsed.reason ? String(parsed.reason) : undefined,
        });
      }
    } catch {
      // skip malformed block
    }
  }
  // 去重 + 限制数量
  const seen = new Set<string>();
  const unique: NavigateAction[] = [];
  for (const a of actions) {
    if (seen.has(a.path)) continue;
    seen.add(a.path);
    unique.push(a);
    if (unique.length >= 6) break;
  }
  return unique;
}

export function stripNavigateBlock(text: string): string {
  return text.replace(/```navigate\s*[\s\S]*?```/gi, '').trim();
}
