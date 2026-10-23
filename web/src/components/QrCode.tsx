import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * Renders `text` as a QR code image, generated in the browser. Dark modules
 * on a light background: inverted (light-on-dark) codes fail on many phone
 * scanners, even though they'd match the theme better.
 */
export function QrCode({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: '#0b0e13', light: '#e6edf3' } }).then(
      (url) => !cancelled && setSrc(url),
      () => !cancelled && setSrc(null),
    );
    return () => {
      cancelled = true; // a newer render replaced this one; ignore its result
    };
  }, [text, size]);

  return src ? (
    <img className="qr" src={src} width={size} height={size} alt={`QR code for ${text}`} />
  ) : (
    <div className="qr qr-placeholder" style={{ width: size, height: size }}>
      [qr]
    </div>
  );
}

/** Full-screen overlay with a large QR code. Click anywhere or press Escape to close. */
export function QrModal({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-label="QR code">
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <QrCode text={text} size={240} />
        <p className="muted">{text}</p>
        <button className="btn" onClick={onClose}>
          close [esc]
        </button>
      </div>
    </div>
  );
}
