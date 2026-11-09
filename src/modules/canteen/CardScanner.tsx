import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { BarcodeFormat, BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { Flashlight, FlashlightOff, PencilLine, RefreshCw, Settings as SettingsIcon, SwitchCamera, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';

const DUPLICATE_WINDOW_MS = 2000;
const NATIVE_FORMATS = [
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Ean13,
  BarcodeFormat.Itf,
  BarcodeFormat.QrCode,
  BarcodeFormat.DataMatrix,
  BarcodeFormat.Pdf417,
];

type ScannerStatus = 'checking' | 'needPermission' | 'running' | 'denied' | 'unsupported' | 'pluginMissing' | 'noCamera';

export interface ScannerDiagnostics {
  platform: string;
  permission: string;
  pluginAvailable: boolean;
  usingFallback: boolean;
  lastError: string | null;
}

interface CardScannerProps {
  paused: boolean;
  onDetect: (text: string) => void;
  onManual: () => void;
  onClose: () => void;
  onDiagnostics?: (diag: ScannerDiagnostics) => void;
}

export function CardScanner({ paused, onDetect, onManual, onClose, onDiagnostics }: CardScannerProps) {
  const { t } = useTranslation();
  const isNative = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<ScannerStatus>('checking');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [permissionVersion, setPermissionVersion] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const pausedRef = useRef(paused);
  const onDetectRef = useRef(onDetect);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const zxingReaderRef = useRef<unknown>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
    onDetectRef.current = onDetect;
  }, [paused, onDetect]);

  const emit = (text: string) => {
    const value = text.trim();
    if (!value || pausedRef.current) return;
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.text === value && now - last.at < DUPLICATE_WINDOW_MS) return;
    lastRef.current = { text: value, at: now };
    onDetectRef.current(value);
  };

  const reportDiagnostics = (diag: Partial<ScannerDiagnostics>) => {
    if (onDiagnostics) {
      onDiagnostics({
        platform: isNative ? 'native' : 'web',
        permission: status === 'running' ? 'granted' : status === 'denied' ? 'denied' : status === 'needPermission' ? 'prompt' : 'unknown',
        pluginAvailable: !usingFallback,
        usingFallback,
        lastError: lastError,
        ...diag,
      });
    }
  };

  // --- Native scanner (MLKit) ---
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    let listener: { remove: () => Promise<void> } | null = null;
    document.documentElement.classList.add('barcode-scanner-active');

    const startNative = async () => {
      listener = await BarcodeScanner.addListener('barcodesScanned', (event) => {
        const value = event.barcodes[0]?.rawValue;
        if (value) emit(value);
      });
      await BarcodeScanner.startScan({
        formats: NATIVE_FORMATS,
        lensFacing: facing === 'user' ? LensFacing.Front : LensFacing.Back,
      });
      const torch = await BarcodeScanner.isTorchAvailable();
      if (!cancelled) setTorchAvailable(torch.available);
      if (!cancelled) { setStatus('running'); setUsingFallback(false); setLastError(null); }
    };

    const tryNativeOrFallback = async () => {
      try {
        const current = await BarcodeScanner.checkPermissions();
        if (cancelled) return;
        if (current.camera === 'granted') {
          await startNative();
        } else {
          setStatus('needPermission');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLastError(msg);
        setStatus('pluginMissing');
        await startWebFallback();
      }
    };

    (async () => {
      await tryNativeOrFallback();
    })().catch(async (err) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      await startWebFallback();
    });

    return () => {
      cancelled = true;
      document.documentElement.classList.remove('barcode-scanner-active');
      void listener?.remove();
      void BarcodeScanner.stopScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, facing, permissionVersion]);

  // --- Web fallback scanner (@zxing/browser) ---
  const startWebFallback = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      setStatus('denied');
      return;
    }
    const track = stream.getVideoTracks()[0] ?? null;
    if (!track) {
      setLastError('No video track');
      setStatus('noCamera');
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    trackRef.current = track;
    const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
    setTorchAvailable(Boolean(capabilities.torch));

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    setUsingFallback(true);
    setStatus('running');
    setLastError(null);

    // Use @zxing/browser for decoding
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      zxingReaderRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (result) emit(result.getText());
      });
      zxingControlsRef.current = controls;
    } catch {
      // If zxing fails to load, fall back to BarcodeDetector if available
      const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (Detector) {
        const detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'pdf417'] });
        const timer = window.setInterval(() => {
          const src = videoRef.current;
          if (!src || src.readyState < 2) return;
          detector.detect(src).then((codes) => {
            const value = codes[0]?.rawValue;
            if (value) emit(value);
          }).catch(() => undefined);
        }, 200);
        zxingControlsRef.current = { stop: () => window.clearInterval(timer) };
      }
    }
  };

  // --- Web scanner for non-native platforms ---
  useEffect(() => {
    if (isNative) return;
    let cancelled = false;

    (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      } catch (err) {
        if (cancelled) return;
        setLastError(err instanceof Error ? err.message : String(err));
        setStatus('denied');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const track = stream.getVideoTracks()[0] ?? null;
      if (!track) {
        if (!cancelled) { setLastError('No video track'); setStatus('noCamera'); }
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      trackRef.current = track;
      const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchAvailable(Boolean(capabilities.torch));
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      if (!cancelled) { setStatus('running'); setLastError(null); }

      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        zxingReaderRef.current = reader;
        const controls = await reader.decodeFromVideoDevice(undefined, video!, (result) => {
          if (result) emit(result.getText());
        });
        zxingControlsRef.current = controls;
      } catch {
        const Detector = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        if (Detector) {
          const detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix', 'pdf417'] });
          const timer = window.setInterval(() => {
            const src = videoRef.current;
            if (!src || src.readyState < 2) return;
            detector.detect(src).then((codes) => {
              const value = codes[0]?.rawValue;
              if (value) emit(value);
            }).catch(() => undefined);
          }, 200);
          zxingControlsRef.current = { stop: () => window.clearInterval(timer) };
        }
      }
    })();

    return () => {
      cancelled = true;
      zxingControlsRef.current?.stop();
      zxingControlsRef.current = null;
      zxingReaderRef.current = null;
      trackRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, facing]);

  useEffect(() => {
    reportDiagnostics({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lastError, usingFallback]);

  const requestNativePermission = async () => {
    try {
      const result = await BarcodeScanner.requestPermissions();
      if (result.camera === 'granted') {
        setPermissionVersion((value) => value + 1);
      } else {
        setStatus('denied');
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setStatus('denied');
    }
  };

  const retry = async () => {
    setLastError(null);
    setStatus('checking');
    if (isNative) {
      setPermissionVersion((value) => value + 1);
    } else {
      setFacing((value) => value);
    }
  };

  const toggleTorch = async () => {
    const next = !torchOn;
    if (isNative && !usingFallback) {
      try {
        await BarcodeScanner.toggleTorch();
      } catch { /* ignore */ }
    } else {
      const track = trackRef.current;
      if (!track) return;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).catch(() => undefined);
    }
    setTorchOn(next);
  };

  const switchCamera = () => {
    setTorchOn(false);
    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    setFacing((value) => (value === 'environment' ? 'user' : 'environment'));
  };

  const overlayClass = isNative && !usingFallback ? 'bg-transparent' : 'bg-neutral-950';

  const showErrorButtons = status === 'denied' || status === 'unsupported' || status === 'pluginMissing' || status === 'noCamera';

  return (
    <div className={`fixed inset-0 z-50 flex flex-col text-white ${overlayClass}`}>
      {(!isNative || usingFallback) ? (
        <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : null}

      <div className="relative z-10 flex items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('canteen.scanner.close')}
          className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
        >
          <X className="size-7" aria-hidden />
        </button>
        <div className="flex gap-3">
          {torchAvailable ? (
            <button
              type="button"
              onClick={toggleTorch}
              aria-label={torchOn ? t('canteen.scanner.torchOff') : t('canteen.scanner.torchOn')}
              aria-pressed={torchOn}
              className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
            >
              {torchOn ? <FlashlightOff className="size-7" aria-hidden /> : <Flashlight className="size-7" aria-hidden />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={switchCamera}
            aria-label={t('canteen.scanner.switchCamera')}
            className="flex size-14 items-center justify-center rounded-full bg-black/50 transition active:scale-95"
          >
            <SwitchCamera className="size-7" aria-hidden />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6">
        {status === 'running' ? (
          <>
            <div className="aspect-[3/2] w-full max-w-sm rounded-3xl border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <p className="rounded-full bg-black/60 px-4 py-2 text-center text-base">{t('canteen.scanner.hint')}</p>
            {usingFallback ? (
              <p className="rounded-full bg-warning-600/80 px-4 py-1 text-center text-xs">{t('canteen.scanner.fallbackActive')}</p>
            ) : null}
          </>
        ) : null}
        {status === 'checking' ? <p className="text-lg">{t('canteen.scanner.starting')}</p> : null}
        {status === 'needPermission' ? (
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-neutral-900">
            <h2 className="text-lg font-bold">{t('canteen.scanner.permissionTitle')}</h2>
            <p className="text-base text-neutral-700">{t('canteen.scanner.permissionBody')}</p>
            <Button fullWidth onClick={requestNativePermission}>
              {t('canteen.scanner.allowCamera')}
            </Button>
          </div>
        ) : null}
        {showErrorButtons ? (
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-neutral-900">
            <h2 className="text-lg font-bold text-danger-700">
              {status === 'denied' ? t('canteen.scanner.permissionDenied')
                : status === 'pluginMissing' ? t('canteen.scanner.pluginMissing')
                : status === 'noCamera' ? t('canteen.scanner.noCamera')
                : t('canteen.scanner.unsupported')}
            </h2>
            {lastError ? (
              <p className="text-sm font-mono text-neutral-500 break-words">{lastError}</p>
            ) : null}
            <div className="flex gap-3">
              <Button variant="ghost" fullWidth onClick={retry}>
                <RefreshCw className="size-4" aria-hidden />
                {t('canteen.scanner.tryAgain')}
              </Button>
              <Button fullWidth onClick={() => {
                if (isNative) {
                  void BarcodeScanner.openSettings().catch(() => undefined);
                }
              }}>
                <SettingsIcon className="size-4" aria-hidden />
                {t('canteen.scanner.openSettings')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative z-10 p-4">
        <button
          type="button"
          onClick={onManual}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-neutral-900 transition active:scale-[0.98]"
        >
          <PencilLine className="size-5" aria-hidden />
          {t('canteen.scanner.manual')}
        </button>
      </div>
    </div>
  );
}
