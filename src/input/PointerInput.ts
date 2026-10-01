// src/input/PointerInput.ts
//! Unified Pointer Input Pipeline for Windows Desktop First (Stage 3.1)
//! Supports Mouse, Stylus / Pen (Windows Ink, Wacom pressure & tilt), and Touch.

export type PointerDeviceType = 'mouse' | 'pen' | 'touch';

export interface PointerInput {
  x: number;
  y: number;
  docX: number;
  docY: number;
  pressure: number; // Normalized 0.0 to 1.0 (defaults to 1.0 for mouse click)
  pointerType: PointerDeviceType;
  tiltX: number; // degrees -90 to 90
  tiltY: number; // degrees -90 to 90
  twist: number; // degrees 0 to 359
  isPrimary: boolean;
  button: number; // 0: primary, 1: middle, 2: secondary
  buttons: number; // bitmask of currently pressed buttons
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  pointerId: number;
  timestamp: number;
}

/**
 * Extracts a normalized, desktop-grade PointerInput object from a native PointerEvent
 * or React.PointerEvent, resolving document canvas coordinates.
 */
export function extractPointerInput(
  e: React.PointerEvent<HTMLCanvasElement> | PointerEvent,
  coords: { docX: number; docY: number }
): PointerInput {
  const pointerType: PointerDeviceType =
    e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';

  // W3C PointerEvent specifies pressure is 0.5 for active mouse button with no pressure sensor,
  // or 0 when not active. For pen devices, pressure ranges continuously from 0.0 to 1.0.
  let pressure = e.pressure;
  if (pointerType === 'mouse') {
    // For standard desktop mouse clicks, normalize active press to 1.0
    pressure = e.buttons !== 0 ? 1.0 : 0.0;
  } else if (pointerType === 'pen') {
    // Pen pressure: ensure valid clamp [0.0, 1.0]; fallback to 1.0 if hardware reports 0 on down
    if (pressure === 0 && e.buttons !== 0) {
      pressure = 0.5;
    }
  }

  return {
    x: e.clientX,
    y: e.clientY,
    docX: coords.docX,
    docY: coords.docY,
    pressure: Math.max(0.0, Math.min(1.0, pressure)),
    pointerType,
    tiltX: e.tiltX ?? 0,
    tiltY: e.tiltY ?? 0,
    twist: e.twist ?? 0,
    isPrimary: e.isPrimary ?? true,
    button: e.button,
    buttons: e.buttons,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey || e.metaKey,
    shiftKey: e.shiftKey,
    pointerId: e.pointerId,
    timestamp: e.timeStamp || Date.now(),
  };
}
