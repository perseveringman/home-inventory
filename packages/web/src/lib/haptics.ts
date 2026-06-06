import { Capacitor } from '@capacitor/core';

const ACTIONABLE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[data-haptic]',
].join(',');

const ICON_CONTROL_SELECTOR = [
  '[data-haptic="icon"]',
  '.scene-btn',
  '.fab-btn',
  '.enamel-icon-btn',
  '.room-menu-btn',
  '.sub-action-close',
  '.subscribe-hero-add',
].join(',');

const ICON_CONTENT_SELECTOR = [
  '.pin-icon',
  '.tab-icon',
  '.sub-icon',
  'svg[aria-hidden="true"]',
  '[data-icon]',
].join(',');

let lastHapticAt = 0;
let hapticsModulePromise: Promise<typeof import('@capacitor/haptics')> | null = null;

function isDisabled(element: HTMLElement): boolean {
  return element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true';
}

function isCompactIconButton(element: HTMLElement): boolean {
  const hasAccessibleName = Boolean(element.getAttribute('aria-label') || element.getAttribute('title'));
  if (!hasAccessibleName) return false;
  return (element.textContent || '').trim().length <= 2;
}

function getActionableIconElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('[data-haptic="off"]')) return null;

  const action = target.closest<HTMLElement>(ACTIONABLE_SELECTOR);
  if (!action || isDisabled(action)) return null;
  if (action.matches(ICON_CONTROL_SELECTOR)) return action;
  if (action.querySelector(ICON_CONTENT_SELECTOR)) return action;
  if (isCompactIconButton(action)) return action;

  return null;
}

async function impactNative() {
  const { Haptics, ImpactStyle } = await loadHapticsModule();
  await Haptics.impact({ style: ImpactStyle.Medium });
}

function loadHapticsModule() {
  return (hapticsModulePromise ??= import('@capacitor/haptics'));
}

export function triggerIconHaptic(): void {
  const now = Date.now();
  if (now - lastHapticAt < 80) return;
  lastHapticAt = now;

  if (Capacitor.isNativePlatform()) {
    void impactNative().catch(() => {});
    return;
  }

  // Web has no native "medium impact" equivalent; keep this no-op outside Capacitor.
}

export function installIconHaptics(): () => void {
  if (Capacitor.isNativePlatform()) void loadHapticsModule().catch(() => {});

  const onTouchStart = (event: TouchEvent) => {
    if (getActionableIconElement(event.target)) triggerIconHaptic();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (getActionableIconElement(event.target)) triggerIconHaptic();
  };

  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  return () => {
    document.removeEventListener('touchstart', onTouchStart, { capture: true });
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  };
}
