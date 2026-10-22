import { useState } from 'react';
import useEmailIframeEditor from './useEmailIframeEditor';
import Toolbar, { DEFAULT_TOOLBAR } from './Toolbar';
import ImageUrlModal from './ImageUrlModal';

/**
 * Shared visual (WYSIWYG) email body editor — the one rich-text editor every
 * email-editing surface in the app uses (Email Templates page, Candidate
 * Screening's shortlist/reject modal, the Pipeline drawer's outcome/
 * interview-schedule modals).
 *
 * Uncontrolled after mount: `initialHtml` seeds the document once, edits
 * stream out via `onChange` as serialized HTML. To load different content,
 * remount the component (change its `key`) rather than pushing a new
 * `initialHtml`.
 *
 * Two editing modes, selected purely by whether `wrapper` is passed — see
 * useEmailIframeEditor.js for the full rationale:
 *   - whole-document (no `wrapper`): the entire iframe is editable.
 *   - protected-chrome (`wrapper = {headerHtml, footerHtml}`): only the body
 *     slot inside the real branded email shell is editable.
 */
export default function EmailBodyEditor({
  initialHtml,
  onChange,
  wrapper,
  subject,
  placeholders = [],
  toolbar = DEFAULT_TOOLBAR,
  compact = false,
  height,
  // Grow the frame to its content instead of using a fixed height. Opt-in:
  // callers that pass an explicit `height` (the Pipeline drawer modals) keep it.
  autoHeight = false,
}) {
  const editor = useEmailIframeEditor({ initialHtml, onChange, wrapper, subject, compact, autoHeight });
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const showImageModal = toolbar.includes('image');

  return (
    <div className="email-editor-shell">
      <Toolbar
        buttons={toolbar}
        editor={editor}
        onImageClick={() => setImgModalOpen(true)}
        placeholders={placeholders}
        onInsertPlaceholder={editor.insertPlaceholder}
      />
      <iframe
        ref={editor.iframeRef}
        title="Email body editor"
        className="email-editor-iframe"
        srcDoc={editor.srcDoc}
        onLoad={editor.handleLoad}
        style={height ? { height } : undefined}
      />
      {showImageModal && (
        <ImageUrlModal
          open={imgModalOpen}
          onCancel={() => setImgModalOpen(false)}
          onInsert={(html) => {
            editor.exec('insertHTML', html);
            setImgModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
