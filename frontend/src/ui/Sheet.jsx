/**
 * Sheet — an iOS-style presented panel over AntD's Modal.
 *
 * The app has 47 <Modal> and 3 <Drawer> instances. They already receive the tier-4
 * material app-wide through OVERLAY_CONFIG in App.jsx, which stamps a class onto
 * every instance wherever it portals to — that mechanism stays and this does not
 * replace it. What this adds is the presentation: a spring rise from the bottom
 * edge, a grabber, and one width scale instead of a number chosen per call site.
 *
 * WHY THE WIDTH SCALE MATTERS MORE THAN IT SOUNDS
 * components/pipeline/modalWidths.js already exists for exactly this reason and is
 * reused here rather than duplicated. A dialog whose width is a bare number at the
 * call site is a dialog whose footer buttons go unreachable at 1366x768, which the
 * global `.ant-modal` viewport caps in index.css:1741 exist to prevent. Those caps
 * must keep winning — this component does not set a max-width that could beat them.
 */
import { Modal } from 'antd';

/**
 * Named widths. Deliberately few: the point is that a caller picks a size rather
 * than inventing a pixel value, so dialogs across the app line up.
 */
const WIDTHS = { sm: 460, md: 640, lg: 880, xl: 1080 };

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {React.ReactNode} [props.title]
 * @param {'sm'|'md'|'lg'|'xl'} [props.size='md']
 * @param {React.ReactNode} [props.footer]  pass null to remove AntD's default buttons
 * @param {boolean} [props.grabber=true]  the iOS drag affordance at the top edge
 */
export default function Sheet({
  open,
  onClose,
  title,
  size = 'md',
  footer,
  grabber = true,
  className = '',
  children,
  ...rest
}) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={title}
      footer={footer}
      width={WIDTHS[size] || WIDTHS.md}
      centered
      // The class carries the presentation; OVERLAY_CONFIG in App.jsx separately
      // stamps `ats-overlay` on the same element for the tier-4 material, so both
      // apply without either knowing about the other.
      className={['ui-sheet', className].filter(Boolean).join(' ')}
      // Keeps a closed sheet's form state from surviving into the next open, which is
      // the usual surprise with reused dialogs. `destroyOnClose` was renamed in the
      // installed antd 5.29 and warns on every mount.
      destroyOnHidden
      {...rest}
    >
      {grabber && <div className="ui-sheet__grabber" aria-hidden />}
      {children}
    </Modal>
  );
}

export { WIDTHS as SHEET_WIDTHS };
