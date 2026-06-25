import { useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

const VIEWPORT_GUTTER = 8;
const MENU_GAP = 6;
const MIN_MENU_HEIGHT = 120;
const MAX_MENU_HEIGHT = 320;

type PortalStyle = CSSProperties & {
  "--dropdown-max-height": string;
};

export function useDropdownPortalPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  preferredWidth?: number,
) {
  const [style, setStyle] = useState<PortalStyle | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const anchor = anchorRef.current;
    if (!anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const maxWidth = Math.max(0, viewportWidth - VIEWPORT_GUTTER * 2);
      const width = Math.min(
        Math.max(rect.width, preferredWidth ?? rect.width),
        maxWidth,
      );
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, rect.right - width),
        Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER),
      );
      const spaceBelow = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_GUTTER;
      const spaceAbove = rect.top - MENU_GAP - VIEWPORT_GUTTER;
      const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(
        Math.min(MIN_MENU_HEIGHT, viewportHeight - VIEWPORT_GUTTER * 2),
        Math.min(MAX_MENU_HEIGHT, placeAbove ? spaceAbove : spaceBelow),
      );

      setStyle({
        position: "fixed",
        zIndex: 90,
        left,
        right: "auto",
        width,
        maxWidth,
        ...(placeAbove
          ? { top: "auto", bottom: viewportHeight - rect.top + MENU_GAP }
          : { top: rect.bottom + MENU_GAP, bottom: "auto" }),
        "--dropdown-max-height": `${availableHeight}px`,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    observer?.observe(anchor);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer?.disconnect();
    };
  }, [anchorRef, open, preferredWidth]);

  return style;
}
