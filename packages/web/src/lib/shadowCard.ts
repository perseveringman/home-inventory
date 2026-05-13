export function initShadowCardBridge() {
  if (typeof window === 'undefined' || window.parent === window) return () => {};

  window.parent.postMessage(
    {
      type: 'shadow.card.ready',
      name: 'home-inventory',
      entry: window.location.pathname,
    },
    '*'
  );

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type !== 'shadow.card.launch') return;
    window.dispatchEvent(new CustomEvent('shadow:card-launch', { detail: event.data }));
  };

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
