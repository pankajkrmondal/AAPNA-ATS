import { CheckOutlined } from '@ant-design/icons';

/**
 * Quiet, premium success confirmation shown when an upload batch is accepted — a
 * single refined check with a soft expanding ring. No confetti. Pure CSS
 * (keyframes in theme/index.css); render with `show` true for ~1s.
 */
export default function UploadCelebration({ show }) {
  if (!show) return null;
  return (
    <div className="upload-celebration" aria-hidden="true">
      <span className="celebration-check">
        <CheckOutlined />
        <span className="check-ripple" />
      </span>
    </div>
  );
}
