/**
 * Change-only DOM writes for per-frame HUD updates. Writing the same text or
 * style every frame still costs style recalculation (and on iOS a repaint of
 * text-shadowed layers over the canvas); these skip the write when the value
 * hasn't changed.
 */

export function textSetter(el: HTMLElement): (value: string) => void {
  let last: string | null = null;
  return (value) => {
    if (value === last) return;
    last = value;
    el.textContent = value;
  };
}

export function styleSetter(el: HTMLElement, prop: 'width' | 'background' | 'transform' | 'opacity'): (value: string) => void {
  let last: string | null = null;
  return (value) => {
    if (value === last) return;
    last = value;
    el.style[prop] = value;
  };
}

export function hiddenSetter(el: HTMLElement): (hidden: boolean) => void {
  let last: boolean | null = null;
  return (hidden) => {
    if (hidden === last) return;
    last = hidden;
    el.hidden = hidden;
  };
}
