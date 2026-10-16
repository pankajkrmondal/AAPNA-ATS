/**
 * What happened to each candidate after a shortlist that left some out
 * (Phase 3 "Do Now", N21): who was added, and who was not and why
 * ("Rejected on … Can be added again after …", "Already shortlisted for this
 * MRF", …). Used by Candidate Screening and by Search Candidate's "Add to JD".
 * Skipped candidates get no email.
 */
import { Modal, Button, Typography } from 'antd';

const { Text } = Typography;

/**
 * @param {{
 *   open: boolean,
 *   roleLabel: string,
 *   added: string[],                 names added to the MRF
 *   emailed: boolean,                whether the added ones were emailed
 *   skipped: Array<{ cv_id: number, name: string, message: string }>,
 *   emailFailures?: Array<{ name: string, reason: string }>,
 *   onClose: () => void,
 * }} props
 */
export default function ShortlistResultModal({ open, roleLabel, added = [], emailed, skipped = [], emailFailures = [], onClose }) {
  return (
    <Modal
      open={open}
      title="Result"
      onCancel={onClose}
      footer={<Button type="primary" onClick={onClose}>Close</Button>}
      width={560}
      destroyOnClose
    >
      <div data-testid="shortlist-result" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          {added.length > 0 ? (
            <Text>
              <Text strong>{added.length} added</Text> to {roleLabel}{emailed ? ' and emailed' : ''}: {added.join(', ')}.
            </Text>
          ) : (
            <Text>Nobody was added to {roleLabel}.</Text>
          )}
        </div>

        {emailFailures.length > 0 && (
          <Text type="warning">
            Email not sent to {emailFailures.map((x) => x.name).join(', ')}: {[...new Set(emailFailures.map((x) => x.reason))].join(' ')}
          </Text>
        )}

        {skipped.length > 0 && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>{skipped.length} not added</Text>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {skipped.map((s) => (
                <li key={s.cv_id} style={{ marginBottom: 4 }}>
                  <Text strong>{s.name}</Text>: {s.message}
                </li>
              ))}
            </ul>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
              Candidates not added get no email.
            </Text>
          </div>
        )}
      </div>
    </Modal>
  );
}
