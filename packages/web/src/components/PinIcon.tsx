import addIcon from '../assets/pin-icons/add.png';
import backIcon from '../assets/pin-icons/back.png';
import bookIcon from '../assets/pin-icons/book.png';
import boxIcon from '../assets/pin-icons/box.png';
import cameraIcon from '../assets/pin-icons/camera.png';
import editIcon from '../assets/pin-icons/edit.png';
import galleryIcon from '../assets/pin-icons/gallery.png';
import inboxIcon from '../assets/pin-icons/inbox.png';
import overviewIcon from '../assets/pin-icons/overview.png';
import searchIcon from '../assets/pin-icons/search.png';
import settingsIcon from '../assets/pin-icons/settings.png';
import sparkIcon from '../assets/pin-icons/spark.png';
import subscribeIcon from '../assets/pin-icons/subscribe.png';
import trashIcon from '../assets/pin-icons/trash.png';

export type PinIconName =
  | 'storage'
  | 'inbox'
  | 'overview'
  | 'subscribe'
  | 'settings'
  | 'room'
  | 'items'
  | 'search'
  | 'box'
  | 'cabinet'
  | 'camera'
  | 'gallery'
  | 'edit'
  | 'chat'
  | 'photo'
  | 'spark'
  | 'tag'
  | 'trash'
  | 'folder'
  | 'book'
  | 'ai'
  | 'add'
  | 'back';

interface Props {
  name: PinIconName;
  size?: number;
  className?: string;
  tile?: boolean;
}

const ICONS: Record<PinIconName, string> = {
  storage: boxIcon,
  inbox: inboxIcon,
  overview: overviewIcon,
  subscribe: subscribeIcon,
  settings: settingsIcon,
  room: boxIcon,
  items: boxIcon,
  search: searchIcon,
  box: boxIcon,
  cabinet: boxIcon,
  camera: cameraIcon,
  gallery: galleryIcon,
  edit: editIcon,
  chat: sparkIcon,
  photo: galleryIcon,
  spark: sparkIcon,
  tag: sparkIcon,
  trash: trashIcon,
  folder: bookIcon,
  book: bookIcon,
  ai: sparkIcon,
  add: addIcon,
  back: backIcon,
};

export function PinIcon({ name, size = 42, className = '', tile: _tile = true }: Props) {
  return (
    <span
      className={`pin-icon pin-icon-asset ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src={ICONS[name]} alt="" draggable={false} />
    </span>
  );
}

export function titleIcon(title: string): PinIconName {
  if (title.includes('待处理')) return 'inbox';
  if (title.includes('总览')) return 'overview';
  if (title.includes('订阅')) return 'subscribe';
  if (title.includes('设置')) return 'settings';
  if (title.includes('搜索')) return 'search';
  if (title.includes('物品')) return 'items';
  if (title.includes('照片')) return 'photo';
  if (title.includes('柜')) return 'cabinet';
  if (title.includes('AI')) return 'ai';
  return 'room';
}

export function stripLeadingEmoji(text: string): string {
  return text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
}
