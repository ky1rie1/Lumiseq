import { describe, expect, it } from 'vitest';
import { handleModalCancel } from './Modal';

describe('controlled native modal cancellation', () => {
  it('prevents native Escape dismissal while a pending operation disables closing', () => {
    let open = true;
    const event = new Event('cancel', { cancelable: true });
    handleModalCancel(event, () => { open = false; }, false);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toBe(true);
  });

  it('closes through the supplied state callback when dismissal is allowed', () => {
    let open = true;
    const event = new Event('cancel', { cancelable: true });
    handleModalCancel(event, () => { open = false; });
    expect(open).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });
});
