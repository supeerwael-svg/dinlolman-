import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/StatusBlock';
import { updateCanteenTrackingStart } from '@/db/institutions';
import { listAllCanteenEntries } from '@/db/canteen';
import { useSession } from '@/modules/auth/AuthContext';
import { todayIso } from '@/utils/dates';
import { errorKey } from '@/utils/errors';

interface TrackingStartSheetProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function TrackingStartSheet({ open, onClose, onSaved }: TrackingStartSheetProps) {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const current = institution.canteenTrackingStart ?? '';
  const [date, setDate] = useState(current || todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [affectedCount, setAffectedCount] = useState(0);

  const isHead = user.role === 'head';

  const handleSaveClick = async () => {
    if (!date) return;
    if (date === current) { onClose(); return; }

    // Count how many distinct days have entries before the new date
    if (current && date < current) {
      try {
        const entries = await listAllCanteenEntries(institution.id);
        const beforeDates = new Set(
          entries
            .filter((e) => e.deletedAt === null && e.date < date)
            .map((e) => e.date),
        );
        setAffectedCount(beforeDates.size);
        setConfirmOpen(true);
        return;
      } catch { /* proceed without confirmation */ }
    }

    await commitSave();
  };

  const commitSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateCanteenTrackingStart(institution.id, date || null, user.id);
      await onSaved();
      onClose();
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setConfirmOpen(false);
    setDate(current || todayIso());
    onClose();
  };

  return (
    <>
      <Modal open={open && !confirmOpen} title={t('canteen.trackingSheetTitle')} onClose={handleClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600">{t('canteen.trackingSheetHint')}</p>
          <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
            {t('canteen.trackingStartDate')}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-11 rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900"
            />
          </label>
          {!isHead ? (
            <p className="text-sm text-neutral-500">{t('canteen.trackingEditBlocked')}</p>
          ) : null}
          <FormError message={error} />
          <div className="flex gap-3">
            <Button variant="ghost" fullWidth onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button fullWidth onClick={handleSaveClick} disabled={saving || !isHead}>
              {t('canteen.trackingSave')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        title={t('canteen.trackingConfirmTitle')}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600">
            {t('canteen.trackingConfirmBody', { count: affectedCount, date })}
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" fullWidth onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button fullWidth onClick={commitSave} disabled={saving}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

interface TrackingBannerProps {
  onOpen: () => void;
}

export function TrackingOffBanner({ onOpen }: TrackingBannerProps) {
  const { t } = useTranslation();
  const { user } = useSession();
  const isHead = user.role === 'head';
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-700">
      <span>{t('canteen.trackingOff')}</span>
      {isHead ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-h-9 w-fit rounded-lg bg-warning-600 px-3 text-sm font-medium text-white transition hover:bg-warning-700"
        >
          {t('canteen.enableTracking')}
        </button>
      ) : null}
    </div>
  );
}

export function TrackingSinceLine({ onEdit }: { onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const { user, institution } = useSession();
  const isHead = user.role === 'head';
  const rawDate = institution.canteenTrackingStart ?? '';
  const formatted = rawDate
    ? new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(rawDate + 'T00:00:00'))
    : '';
  return (
    <div className="flex items-center gap-3 rounded-xl bg-success-50 px-4 py-2 text-sm text-success-700">
      <span>{t('canteen.trackingSince', { date: formatted })}</span>
      {isHead ? (
        <button
          type="button"
          onClick={onEdit}
          className="min-h-8 rounded-lg px-2 text-xs font-medium text-success-700 underline hover:text-success-800"
        >
          {t('canteen.trackingEdit')}
        </button>
      ) : null}
    </div>
  );
}
