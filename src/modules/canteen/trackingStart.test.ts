import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ar } from '@/i18n/locales/ar';

function translate(locale: typeof en, key: string, vars?: Record<string, string | number>): string {
  const parts = key.split('.');
  let value: unknown = locale;
  for (const part of parts) {
    if (typeof value !== 'object' || value === null || !(part in value)) return key;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

describe('canteen tracking start date banner', () => {
  it('shows trackingOff text when no start date is set', () => {
    const text = translate(en, 'canteen.trackingOff');
    expect(text).not.toBe('canteen.trackingOff');
    expect(text.length).toBeGreaterThan(0);
    const arText = translate(ar, 'canteen.trackingOff');
    expect(arText.length).toBeGreaterThan(0);
  });

  it('shows trackingSince line with the saved date', () => {
    const text = translate(en, 'canteen.trackingSince', { date: '15/09/2026' });
    expect(text).toContain('15/09/2026');
    expect(text.toLowerCase()).toContain('tracking since');
  });

  it('shows enableTracking button text in both languages', () => {
    const enText = translate(en, 'canteen.enableTracking');
    const arText = translate(ar, 'canteen.enableTracking');
    expect(enText.toLowerCase()).toContain('enable');
    expect(arText).toContain('تفعيل');
  });

  it('shows trackingEdit button text in both languages', () => {
    const enText = translate(en, 'canteen.trackingEdit');
    const arText = translate(ar, 'canteen.trackingEdit');
    expect(enText.toLowerCase()).toContain('edit');
    expect(arText).toContain('تعديل');
  });

  it('banner logic: canteenTrackingStart truthy → trackingSince, falsy → trackingOff', () => {
    function bannerKey(canteenTrackingStart: string | null | undefined): string {
      return canteenTrackingStart ? 'canteen.trackingSince' : 'canteen.trackingOff';
    }
    expect(bannerKey(null)).toBe('canteen.trackingOff');
    expect(bannerKey(undefined)).toBe('canteen.trackingOff');
    expect(bannerKey('')).toBe('canteen.trackingOff');
    expect(bannerKey('2026-09-15')).toBe('canteen.trackingSince');
  });

  it('confirmation body includes affected day count and date', () => {
    const text = translate(en, 'canteen.trackingConfirmBody', { count: 3, date: '2026-09-01' });
    expect(text).toContain('3');
    expect(text).toContain('2026-09-01');
    const arText = translate(ar, 'canteen.trackingConfirmBody', { count: 3, date: '2026-09-01' });
    expect(arText).toContain('3');
    expect(arText).toContain('2026-09-01');
  });

  it('sheet hint explains no day before the date is counted as absent', () => {
    const enText = translate(en, 'canteen.trackingSheetHint');
    const arText = translate(ar, 'canteen.trackingSheetHint');
    expect(enText.toLowerCase()).toContain('no day before');
    expect(arText).toContain('قبل هذا التاريخ');
  });
});
