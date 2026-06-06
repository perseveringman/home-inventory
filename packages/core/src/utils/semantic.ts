/**
 * 根据物品名称 / 标签 推断一个语义 emoji 与配色，
 * 主要服务于"没有用户照片的物品"自动生成漂亮的语义缩略图。
 *
 * 完全本地，无网络。AI 增强建议走 services/itemEmoji.ts。
 */

interface KeywordRule {
  emoji: string;
  hue: number; // 0~360 主色调
  words: string[];
}

const RULES: KeywordRule[] = [
  // 食品 / 厨房
  { emoji: '💊', hue: 200, words: ['药', '片剂', '胶囊', '膏', '布洛芬', '感冒', '退烧', '消炎', '抗', '维生素'] },
  { emoji: '🌿', hue: 145, words: ['保健', '鱼油', '蛋白粉', '钙片', '益生菌', '叶绿素'] },
  { emoji: '☕', hue: 28, words: ['咖啡', 'coffee', '美式', '拿铁', '挂耳'] },
  { emoji: '🍵', hue: 110, words: ['茶', '抹茶', '红茶', '绿茶', '茶包', 'tea'] },
  { emoji: '🥛', hue: 210, words: ['奶', '牛奶', '酸奶', '酸乳'] },
  { emoji: '🍶', hue: 200, words: ['酱油', '醋', '料酒', '调料', '调味', '酱'] },
  { emoji: '🍚', hue: 38, words: ['米', '大米', '糙米', '糯米', '杂粮'] },
  { emoji: '🍜', hue: 32, words: ['面', '挂面', '拉面', '泡面', '方便面'] },
  { emoji: '🍪', hue: 26, words: ['饼干', '曲奇', '小饼'] },
  { emoji: '🍫', hue: 18, words: ['巧克力', '可可', '黑巧'] },
  { emoji: '🍬', hue: 330, words: ['糖', '糖果', '硬糖', '软糖'] },
  { emoji: '🥜', hue: 30, words: ['坚果', '花生', '杏仁', '核桃', '腰果', '开心果'] },
  { emoji: '🥤', hue: 200, words: ['饮料', '汽水', '可乐', '雪碧', '果汁', '气泡水'] },
  { emoji: '🍺', hue: 42, words: ['啤酒', 'beer'] },
  { emoji: '🍷', hue: 350, words: ['红酒', '葡萄酒', 'wine'] },
  { emoji: '🥃', hue: 25, words: ['威士忌', '白酒', '伏特加'] },
  // 餐厨
  { emoji: '🍳', hue: 38, words: ['锅', '炒锅', '汤锅', '平底锅'] },
  { emoji: '🔪', hue: 220, words: ['刀', '菜刀', '剪刀'] },
  { emoji: '🥄', hue: 40, words: ['勺', '汤勺', '量勺'] },
  { emoji: '🍴', hue: 220, words: ['餐具', '叉', '筷'] },
  { emoji: '🍽️', hue: 200, words: ['盘', '碟', '碗'] },
  { emoji: '🧊', hue: 200, words: ['冰', '冷藏', '冷冻'] },
  // 数码
  { emoji: '💻', hue: 220, words: ['电脑', '笔记本', 'macbook', 'thinkpad', 'pc'] },
  { emoji: '⌨️', hue: 220, words: ['键盘', 'keyboard'] },
  { emoji: '🖱️', hue: 220, words: ['鼠标', 'mouse'] },
  { emoji: '🎧', hue: 260, words: ['耳机', 'airpods', 'headset'] },
  { emoji: '🔊', hue: 250, words: ['音箱', '音响', 'speaker'] },
  { emoji: '📱', hue: 220, words: ['手机', 'iphone', 'phone', '安卓'] },
  { emoji: '📷', hue: 0, words: ['相机', '镜头', 'camera'] },
  { emoji: '🔌', hue: 50, words: ['插座', '插头', '排插', '转换器'] },
  { emoji: '🔋', hue: 130, words: ['电池', '充电宝', '电源'] },
  { emoji: '🔗', hue: 220, words: ['数据线', '充电线', 'usb', 'type-c', '线缆'] },
  { emoji: '💾', hue: 220, words: ['硬盘', 'u盘', 'sd', 'tf', '存储卡', 'ssd'] },
  // 家电
  { emoji: '💡', hue: 50, words: ['灯', '台灯', '灯泡', '灯具'] },
  { emoji: '🌬️', hue: 200, words: ['风扇', '空调'] },
  { emoji: '📺', hue: 220, words: ['电视', '显示器', 'monitor', '投影'] },
  { emoji: '🔉', hue: 240, words: ['遥控器', '遥控', 'remote'] },
  // 衣物
  { emoji: '👕', hue: 200, words: ['t恤', 'tshirt', '上衣', '衬衫', 'polo'] },
  { emoji: '👖', hue: 220, words: ['裤', '牛仔', '休闲裤', '短裤'] },
  { emoji: '🧦', hue: 280, words: ['袜'] },
  { emoji: '🧥', hue: 12, words: ['外套', '夹克', '羽绒', '大衣', '风衣'] },
  { emoji: '👟', hue: 280, words: ['鞋', '运动鞋', '跑鞋', '球鞋', '凉鞋'] },
  { emoji: '🎒', hue: 200, words: ['包', '背包', '书包', '通勤包'] },
  { emoji: '🧤', hue: 30, words: ['手套'] },
  { emoji: '🧣', hue: 350, words: ['围巾'] },
  { emoji: '🎩', hue: 30, words: ['帽', '棒球帽', '渔夫帽'] },
  // 居家 / 床品
  { emoji: '🛏️', hue: 220, words: ['床单', '被', '被子', '枕'] },
  { emoji: '🧻', hue: 30, words: ['纸巾', '卫生纸', '抽纸', '湿巾'] },
  { emoji: '🪥', hue: 200, words: ['牙刷', '牙膏', '漱口'] },
  { emoji: '🧴', hue: 320, words: ['洗发', '沐浴', '护发', '身体乳', '洗手液'] },
  { emoji: '🧼', hue: 180, words: ['肥皂', '香皂', '洗衣皂'] },
  { emoji: '🧹', hue: 30, words: ['扫', '清洁', '抹布', '拖把'] },
  { emoji: '🧺', hue: 30, words: ['脏衣篮', '衣篮', '收纳篮', '收纳箱'] },
  { emoji: '🧯', hue: 0, words: ['灭火器', '消防'] },
  // 美妆护肤
  { emoji: '💄', hue: 340, words: ['口红', '唇膏'] },
  { emoji: '💋', hue: 340, words: ['彩妆', '化妆品'] },
  { emoji: '🧴', hue: 320, words: ['乳液', '精华', '面霜', '爽肤水', '化妆水', '护肤'] },
  { emoji: '🧼', hue: 200, words: ['洗面奶', '清洁霜'] },
  { emoji: '💅', hue: 340, words: ['指甲', '美甲'] },
  { emoji: '🌸', hue: 320, words: ['面膜'] },
  { emoji: '🧴', hue: 60, words: ['防晒'] },
  // 玩具 / 文具 / 书
  { emoji: '🧸', hue: 30, words: ['玩具', '毛绒', '娃娃'] },
  { emoji: '🧩', hue: 200, words: ['拼图', '积木', '乐高', 'lego'] },
  { emoji: '🎮', hue: 240, words: ['手柄', '游戏机', '游戏', 'switch', 'ps5'] },
  { emoji: '✏️', hue: 50, words: ['笔', '铅笔', '中性笔', '签字笔'] },
  { emoji: '📓', hue: 200, words: ['本', '笔记本', '日记'] },
  { emoji: '📚', hue: 12, words: ['书', '小说', '绘本', '杂志'] },
  { emoji: '📁', hue: 30, words: ['文件', '资料', '档案'] },
  { emoji: '🖇️', hue: 220, words: ['夹', '订书', '回形针'] },
  { emoji: '🖌️', hue: 320, words: ['颜料', '画笔', '画材'] },
  // 工具
  { emoji: '🔧', hue: 200, words: ['扳手', '螺丝刀', '螺丝'] },
  { emoji: '🔨', hue: 30, words: ['锤', '榔头'] },
  { emoji: '🪛', hue: 220, words: ['工具箱', '工具'] },
  { emoji: '🪚', hue: 30, words: ['锯'] },
  { emoji: '📏', hue: 60, words: ['尺', '卷尺'] },
  // 户外 / 运动
  { emoji: '⛺', hue: 30, words: ['帐篷', '露营'] },
  { emoji: '🎒', hue: 30, words: ['登山', '徒步'] },
  { emoji: '🏀', hue: 24, words: ['篮球'] },
  { emoji: '⚽', hue: 0, words: ['足球'] },
  { emoji: '🎾', hue: 80, words: ['网球'] },
  { emoji: '🏓', hue: 0, words: ['乒乓'] },
  { emoji: '🏸', hue: 200, words: ['羽毛球'] },
  { emoji: '🏊', hue: 200, words: ['泳', '游泳'] },
  { emoji: '🚴', hue: 30, words: ['自行车', '骑行'] },
  // 旅行
  { emoji: '🧳', hue: 30, words: ['行李', '箱', '旅行箱', '登机'] },
  { emoji: '✈️', hue: 220, words: ['机票'] },
  { emoji: '🪪', hue: 200, words: ['身份证', '护照'] },
  { emoji: '🌂', hue: 220, words: ['伞'] },
  // 季节性 / 标签
  { emoji: '🎄', hue: 130, words: ['圣诞', '过年', '春节装饰'] },
  { emoji: '🎁', hue: 0, words: ['礼物', '礼盒'] },
];

const TAG_EMOJI: Record<string, { emoji: string; hue: number }> = {
  药品: { emoji: '💊', hue: 200 },
  保健品: { emoji: '🌿', hue: 145 },
  食品: { emoji: '🍱', hue: 32 },
  零食: { emoji: '🍪', hue: 26 },
  饮料: { emoji: '🥤', hue: 200 },
  数码: { emoji: '💻', hue: 220 },
  家电: { emoji: '🔌', hue: 50 },
  衣物: { emoji: '👕', hue: 220 },
  书籍: { emoji: '📚', hue: 12 },
  文具: { emoji: '✏️', hue: 50 },
  工具: { emoji: '🔧', hue: 200 },
  玩具: { emoji: '🧸', hue: 30 },
  美妆: { emoji: '💄', hue: 340 },
  日用: { emoji: '🧻', hue: 30 },
  厨具: { emoji: '🍳', hue: 38 },
};

export interface SemanticGuess {
  emoji: string;
  hue: number;
}

function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

/**
 * 启发式：根据名称（必填）+ 标签（可选）+ 已有 emoji（可选）推断 emoji 和主色调。
 * 完全本地，毫秒级。
 */
export function inferItemSemantic(
  name: string,
  tags: string[] = [],
  existingEmoji?: string
): SemanticGuess {
  const lower = (name || '').toLowerCase().trim();

  // 优先用已有 emoji
  if (existingEmoji && /\p{Extended_Pictographic}/u.test(existingEmoji)) {
    return { emoji: existingEmoji, hue: nameHue(name || existingEmoji) };
  }

  // 名称关键词命中
  for (const rule of RULES) {
    for (const word of rule.words) {
      if (lower.includes(word.toLowerCase())) {
        return { emoji: rule.emoji, hue: rule.hue };
      }
    }
  }

  // 标签兜底
  for (const tag of tags) {
    if (TAG_EMOJI[tag]) return TAG_EMOJI[tag];
  }

  // 没有线索 → 用通用包裹
  return { emoji: '📦', hue: nameHue(name || 'box') };
}

/** 给定 emoji 和主色调，渲染一张干净现代的方形缩略图 (Blob) */
export async function generateSemanticThumb(
  emoji: string,
  name: string,
  hue: number
): Promise<Blob> {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  // 背景：柔和的渐变 + 内嵌圆角
  const radius = 36;
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, `hsl(${hue}, 88%, 92%)`);
  grad.addColorStop(1, `hsl(${(hue + 28) % 360}, 80%, 80%)`);
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, S, S, radius);
  ctx.fill();

  // 高光斑点
  ctx.globalAlpha = 0.55;
  const high = ctx.createRadialGradient(S * 0.3, S * 0.25, 6, S * 0.3, S * 0.25, S * 0.55);
  high.addColorStop(0, 'rgba(255,255,255,0.95)');
  high.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = high;
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 1;

  // 中间柔和的圆形台
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2 - 14, S * 0.31, 0, Math.PI * 2);
  ctx.fill();

  // emoji（大字号居中）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(S * 0.5)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillStyle = '#222';
  ctx.fillText(emoji, S / 2, S / 2 - 10);

  // 名称小字 — 简洁低调
  if (name) {
    ctx.font = '600 22px -apple-system,"PingFang SC","Microsoft Yahei",sans-serif';
    ctx.fillStyle = `hsl(${hue}, 38%, 28%)`;
    ctx.textBaseline = 'alphabetic';
    const label = name.length > 7 ? `${name.slice(0, 7)}…` : name;
    ctx.fillText(label, S / 2, S - 26);
  }

  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if ((ctx as any).roundRect) {
    ctx.beginPath();
    (ctx as any).roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
