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
// Room icons (sliced from the new icon sheet)
import roomSofa from '../assets/pin-icons/rooms/sofa.png';
import roomBed from '../assets/pin-icons/rooms/bed.png';
import roomKitchen from '../assets/pin-icons/rooms/kitchen.png';
import roomStudy from '../assets/pin-icons/rooms/study.png';
import roomBathroom from '../assets/pin-icons/rooms/bathroom.png';
import roomBathroom2 from '../assets/pin-icons/rooms/bathroom2.png';
import roomWardrobe from '../assets/pin-icons/rooms/wardrobe.png';
import roomWardrobe2 from '../assets/pin-icons/rooms/wardrobe2.png';
import roomKids from '../assets/pin-icons/rooms/kids.png';
import roomBalcony from '../assets/pin-icons/rooms/balcony.png';

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
  | 'back'
  | 'room-sofa'
  | 'room-bed'
  | 'room-kitchen'
  | 'room-study'
  | 'room-bathroom'
  | 'room-bathroom2'
  | 'room-wardrobe'
  | 'room-wardrobe2'
  | 'room-kids'
  | 'room-balcony';

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
  room: roomSofa,
  items: boxIcon,
  search: searchIcon,
  box: boxIcon,
  cabinet: roomWardrobe2,
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
  'room-sofa': roomSofa,
  'room-bed': roomBed,
  'room-kitchen': roomKitchen,
  'room-study': roomStudy,
  'room-bathroom': roomBathroom,
  'room-bathroom2': roomBathroom2,
  'room-wardrobe': roomWardrobe,
  'room-wardrobe2': roomWardrobe2,
  'room-kids': roomKids,
  'room-balcony': roomBalcony,
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

// Maps the (legacy) emoji-based room.icon strings to a PinIconName so the
// freshly sliced room icon set can be used everywhere a room appears.
const EMOJI_TO_ROOM_ICON: Record<string, PinIconName> = {
  '🛋️': 'room-sofa',
  '🛋': 'room-sofa',
  '🛏️': 'room-bed',
  '🛏': 'room-bed',
  '🍳': 'room-kitchen',
  '🚿': 'room-bathroom',
  '🛁': 'room-bathroom2',
  '📚': 'room-study',
  '🧑‍💻': 'room-study',
  '💻': 'room-study',
  '👕': 'room-wardrobe',
  '👚': 'room-wardrobe2',
  '🧸': 'room-kids',
  '🧺': 'room-balcony',
  '🪴': 'room-balcony',
  '🏠': 'room-sofa',
};

export function roomIconName(icon?: string): PinIconName {
  if (!icon) return 'room-sofa';
  return EMOJI_TO_ROOM_ICON[icon] ?? 'room-sofa';
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
