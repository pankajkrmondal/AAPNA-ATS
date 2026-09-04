/**
 * DossierDownloadModal — "what will be shared" before a candidate pack leaves
 * the building.
 *
 * WHY THIS IS NOT A BARE DOWNLOAD BUTTON. One click here produces one file that
 * a recruiter emails to someone with no ATS account. There is no expiry, no
 * recall and no way to see who it is forwarded to; the recruiter's decision at
 * this dialog is the last point at which anything can be changed. So the dialog
 * shows what is going, what has been stripped, and that the download is recorded
 * against their name — before the file exists, not after.
 *
 * SCOPE (docs/phase3/CANDIDATE-COMPLETE-DOWNLOAD-PLAN.md §9). Live controls:
 * contact details (HR decision #10), the resume and personal documents (Phase 2,
 * decision #11), the written-test breakdown, the AI screening assessment and its
 * vendor link (Phase 3, decision #8), the recording share links (Phase 4,
 * decision #7), and the format.
 *
 * A checkbox appears only once the thing it controls can actually travel — the
 * screening-report tick is hidden for a candidate with no Zeko report, and the
 * recordings tick for one with no recordings, so neither ever implies something
 * exists. A ticked box that silently sends nothing is worse than no box at all.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App as AntApp, Button, Checkbox, Descriptions, Modal, Radio, Space, Spin, Tag, Typography,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

import pipelineService from '../../services/pipeline';
import { downloadFile } from '../../utils/downloadFile';
import { MODAL_WIDTH } from './modalWidths';

const { Text, Paragraph } = Typography;

/**
 * What the written test will contribute, in the recruiter's terms.
 *
 * Three states, not two. A result whose breakdown was never captured (imported
 * before the ATS kept it) reads differently from one the recruiter chose to send
 * as scores only — otherwise "scores only" looks like a setting they got wrong.
 */
function assessmentSummary(model, includeAssessmentDetail) {
  const results = model.assessments?.length || 0;
  if (!results) return '0 result(s)';
  const withDetail = model.assessments.filter((a) => a.detail_available).length;
  if (!withDetail) return `${results} result(s) — scores only (imported before the breakdown was recorded)`;
  return `${results} result(s) — ${includeAssessmentDetail ? 'full breakdown included' : 'scores only'}`;
}

/** One row per section, so the recruiter sees volume as well as presence. */
function contentsSummary(model, {
  includeScreeningDetail, includeScreeningReport, includeAssessmentDetail, includeRecordingLinks,
} = {}) {
  if (!model) return [];
  const rounds = model.zeko?.length || 0;
  // The preview deliberately fetches nothing from Zeko — looking at what a pack
  // would contain must not spend vendor round trips, nor mint public links — so
  // this row describes what the DOWNLOAD will do, from the round data plus the
  // ticks.
  const extras = [
    includeScreeningDetail ? 'assessment included' : null,
    includeScreeningReport ? 'vendor report linked' : null,
  ].filter(Boolean);
  const screening = rounds === 0 ? '0 round(s)'
    : `${rounds} round(s)${model.zeko.some((z) => z.report_available)
      ? ` — ${extras.length ? extras.join(', ') : 'scores only'}` : ''}`;
  return [
    ['Candidate profile', model.profile?.length ? 'Included' : 'Nothing on file'],
    ['Contact details', model.contact_details_included ? 'Included' : 'Removed for this download'],
    ['Position brief', model.position?.some((f) => f.value) ? 'Included' : 'Nothing on file'],
    ['Stage history', `${model.stages?.length || 0} recorded decision(s)`],
    ['Interviewer scorecards', `${model.scorecards?.length || 0} submitted`],
    ['Consolidated feedback', model.consolidated_feedback ? 'Included' : 'None yet'],
    ['Screening scores', screening],
    ['Assessment results', assessmentSummary(model, includeAssessmentDetail)],
    ['Interview history', `${model.interviews?.length || 0} booking(s)`],
    ['Recordings', model.recordings?.length
      ? `${model.recordings.length} ${includeRecordingLinks
        ? 'watchable from the pack, without a login'
        : 'listed — not playable from the pack'}`
      : 'None'],
  ];
}

/**
 * @param {{ open: boolean, onClose: () => void, pipelineId: number, candidateName?: string }} props
 */
export default function DossierDownloadModal({ open, onClose, pipelineId, candidateName }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [includeContact, setIncludeContact] = useState(true);
  // On by default: the resume is the single thing an external interviewer is
  // most likely to need, and the whole point of Phase 2 was getting it into the
  // pack rather than making them ask.
  const [includeResume, setIncludeResume] = useState(true);
  // OFF by default, always. HR chose opt-in over exclusion (decision #11); we
  // recommended excluding these outright, so the deterrent has to live in the
  // interaction — an explicit tick, an expanded warning, and an audit entry.
  const [includeDocuments, setIncludeDocuments] = useState(false);
  // ON by default: the screening assessment rendered INTO the pack, under our
  // own redaction — compensation stripped, nothing playable, no link. This is
  // what HR asked for in decision #8, and it is the half that carries no
  // exposure the pack does not already govern.
  const [includeScreeningDetail, setIncludeScreeningDetail] = useState(true);
  // OFF by default. HR asked for the Zeko report in the pack (decision #8) and
  // Phase 3 makes it reachable — but what travels is a no-login link to Zeko's
  // page, and that page sits OUTSIDE this pack's redaction. Checked in a private
  // window with no session (2026-09-03): it shows the candidate's current and
  // expected CTC in plain text, the MRF's own salary band in the remarks ("within
  // the 0-7 LPA preference range"), the transcript with audio, and the video.
  // Three of those four are things §8 strips from the pack itself. So it is a
  // conscious tick with the exposure named, exactly like personal documents.
  const [includeScreeningReport, setIncludeScreeningReport] = useState(false);
  // ON by default: the written test's own breakdown, read out of the Evalground
  // import and rendered into section 7 under the same redaction as everything
  // else. No link, no login, nothing to withdraw — and a bare "90.5%" is the
  // thing interviewers ask a follow-up question about.
  const [includeAssessmentDetail, setIncludeAssessmentDetail] = useState(true);
  // ON by default, unlike the Zeko report link — and the difference is the
  // point. These links are OURS: one per round, a 14-day expiry enforced on the
  // server, revocable from this drawer the moment the recruiter changes their
  // mind, and every open written onto the candidate's timeline with the
  // viewer's IP. HR chose the share-link end state (decision #7) precisely
  // because attaching hundreds of MB of video was not sendable.
  const [includeRecordingLinks, setIncludeRecordingLinks] = useState(true);
  const [format, setFormat] = useState('zip');
  const [downloading, setDownloading] = useState(false);

  // The documents warning renders BELOW the tick that reveals it, and the modal
  // scrolls — so on a short window the deterrent appears off-screen and the
  // recruiter never reads it. A warning nobody sees is not a warning, so it is
  // scrolled into view. Found by screenshotting the real modal, not by reading
  // the code.
  const documentsWarningRef = useRef(null);
  useEffect(() => {
    if (!includeDocuments) return;
    documentsWarningRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [includeDocuments]);

  // Same treatment for the screening-report warning, and for the same reason:
  // it explains that the link escapes the redaction the recruiter was just
  // promised, which is worthless if it renders below the fold.
  const screeningWarningRef = useRef(null);
  useEffect(() => {
    if (!includeScreeningReport) return;
    screeningWarningRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [includeScreeningReport]);

  // The preview is the REAL post-redaction model, re-fetched when the contact
  // toggle changes so the summary below always describes the file that would
  // actually be produced. Describing it from the frontend instead would drift
  // from the backend's redaction the first time either changed.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dossier-preview', pipelineId, includeContact],
    queryFn: () => pipelineService.getDossierPreview(pipelineId, { contact_details: includeContact ? 1 : 0 }),
    enabled: open && Boolean(pipelineId),
    select: (res) => res.data?.data ?? res.data,
  });

  const model = data || null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await downloadFile(
        (cfg) => pipelineService.downloadDossier(
          pipelineId,
          {
            format,
            contact_details: includeContact ? 1 : 0,
            resume: includeResume ? 1 : 0,
            documents: includeDocuments ? 1 : 0,
            screening_detail: includeScreeningDetail ? 1 : 0,
            screening_report: includeScreeningReport ? 1 : 0,
            assessment_detail: includeAssessmentDetail ? 1 : 0,
            recording_links: includeRecordingLinks ? 1 : 0,
          },
          cfg,
        ),
        { fallbackName: 'AAPNA-ATS_Candidate-Dossier.zip' },
      );
      message.success(`Downloaded ${result.filename}`);
      // This download just minted (or reused) the no-login recording links, and
      // the drawer's "Shared recording links" panel is the only place a
      // recruiter can see or close them. Without this it kept showing the state
      // from before the download — so the links they had just sent out were
      // invisible, and the revoke button for them was not there. The timeline
      // gains the audit note for the download too, so the detail is stale as well.
      queryClient.invalidateQueries({ queryKey: ['recording-share-links', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-detail', pipelineId] });
      // Too big to email. Said here rather than left for a bounce message
      // hours later, by which time the recruiter believes the interviewer
      // already has the candidate's details (plan §6.4).
      if (result.oversizeMb) {
        // Deliberately quotes no second threshold. An earlier version said
        // "over about 25 MB" while the server's own limit defaults to 20, so a
        // 21 MB pack warned that it was too big and then named a bigger number
        // — the exact drift the server-side threshold was meant to prevent.
        message.warning(
          `This pack is ${result.oversizeMb} MB, which is larger than most mailboxes accept as an `
          + 'attachment. Share it as a OneDrive link, or download it again with the resume and '
          + 'documents unticked.',
          10,
        );
      }
      if (result.degraded) {
        // The download still succeeded — something the recruiter asked for could
        // not be fetched. The pack says which and why; this makes sure they know
        // to look rather than discovering it after they have sent it on.
        //
        // Worded for any of the four things that can degrade, not just files: a
        // Zeko link, a screening report and a recording link all set this header,
        // and "a file could not be attached" sent a recruiter looking for a
        // missing resume when what was missing was a way to watch a round.
        message.warning(
          'The pack was created, but something you asked for could not be included. Open "What is in '
          + 'this pack" in the report to see which, and why.',
          8,
        );
      }
      onClose();
    } catch (err) {
      message.error(err.message || 'Could not build the dossier. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // What this particular pack will NOT carry. Built here rather than inline so
  // the alert below can be skipped entirely when the list is empty.
  const notIncluded = [
    model?.recordings?.length > 0 && !includeRecordingLinks ? (
      <>
        The interviewer <Text strong>cannot watch the recordings</Text> from this pack — the report
        lists which ones exist and tells them to ask you.
      </>
    ) : null,
    model?.assessments?.length > 0 ? (
      <>
        The Evalground <Text strong>spreadsheet itself</Text> is never attached — it covers every
        candidate who sat that test, so it cannot go out in a pack about one of them. This
        candidate&apos;s own result is written into the report instead.
      </>
    ) : null,
    model?.zeko?.some((z) => z.report_available) ? (
      <>
        The AI screening <Text strong>transcript and recording</Text> are not in the pack — they are
        reachable only through Zeko&apos;s own report link above.
      </>
    ) : null,
  ].filter(Boolean);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Download candidate dossier${candidateName ? ` — ${candidateName}` : ''}`}
      width={MODAL_WIDTH.FORM}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={downloading}>Cancel</Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined />}
          loading={downloading}
          disabled={isLoading || isError}
          onClick={handleDownload}
        >
          Download
        </Button>,
      ]}
    >
      {isLoading && <Spin style={{ display: 'block', margin: '32px auto' }} />}

      {isError && (
        <Alert
          type="error"
          showIcon
          message="Could not read this candidate's details"
          description={error?.message || 'Please close this dialog and try again.'}
        />
      )}

      {model && (
        <>
          <Paragraph style={{ fontSize: 13 }}>
            This produces one file you can email to an interviewer outside the company. It opens in
            any browser <Text strong>without a login</Text>, so please send it only to the person who
            needs it.
          </Paragraph>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14, fontSize: 12.5 }}
            message="Removed from the pack automatically"
            description={(model.redaction || []).join(' · ')}
          />

          {/* The journey's state, in the words the pack itself will use. A
              dossier may be generated for a rejected or closed candidate (HR
              decision #13), so the recruiter should see that here rather than
              discovering it in the file. */}
          {model.status?.closed && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14, fontSize: 12.5 }}
              message="This application is closed"
              description={model.status.headline}
            />
          )}

          <Descriptions
            size="small"
            column={1}
            bordered
            style={{ marginBottom: 16 }}
            styles={{ label: { width: 200, fontSize: 12.5 }, content: { fontSize: 12.5 } }}
          >
            {contentsSummary(model, {
              includeScreeningDetail, includeScreeningReport, includeAssessmentDetail,
              includeRecordingLinks,
            })
              .map(([label, value]) => (
                <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>
              ))}
          </Descriptions>

          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Checkbox
              checked={includeContact}
              onChange={(e) => setIncludeContact(e.target.checked)}
            >
              Include the candidate&apos;s email and phone number
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                On by default — an external interviewer usually needs to reach the candidate to
                agree a slot. Untick if you are scheduling it yourself.
              </Text>
            </Checkbox>

            <Checkbox
              checked={includeResume}
              disabled={format !== 'zip'}
              onChange={(e) => setIncludeResume(e.target.checked)}
            >
              Attach the candidate&apos;s resume
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                {format === 'zip'
                  ? 'The actual file, inside the pack, so the interviewer does not have to ask for it.'
                  : 'Only a ZIP can carry attachments — choose ZIP below to include the resume.'}
              </Text>
            </Checkbox>

            {/* Not a bare tick. HR allowed these as an opt-in against our
                recommendation to exclude them, so the warning names exactly what
                would be attached and says the choice is recorded. */}
            <Checkbox
              checked={includeDocuments}
              disabled={format !== 'zip'}
              onChange={(e) => setIncludeDocuments(e.target.checked)}
            >
              Attach the candidate&apos;s personal documents
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                Off by default. Only tick this if the interviewer genuinely needs them.
              </Text>
            </Checkbox>

            {/* Shown only when the candidate has recordings — a tick offering to
                share footage that does not exist would be a promise the pack
                cannot keep. */}
            {model.recordings?.length > 0 && (
              <Checkbox
                checked={includeRecordingLinks}
                onChange={(e) => setIncludeRecordingLinks(e.target.checked)}
              >
                Let the interviewer watch the interview recordings
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  On by default. Each round gets its own link that plays in a browser with no login,
                  expires after 14 days, and can be revoked from this candidate&apos;s drawer at any time.
                </Text>
              </Checkbox>
            )}

            {includeRecordingLinks && model.recordings?.length > 0 && (
              // Stated plainly rather than buried: this is the one thing in the
              // pack that lets an outsider watch a real person's interview.
              //
              // No scrollIntoView here, unlike the two warnings below: this box
              // is ticked by default, so scrolling on open would yank the dialog
              // before the recruiter has read the top of it.
              <div>
                <Alert
                  type="warning"
                  showIcon
                  style={{ fontSize: 12.5 }}
                  message="Anyone with this file can watch these interviews"
                  description={(
                    <>
                      The links need <Text strong>no login</Text>, so whoever the file is forwarded to
                      can watch too, for <Text strong>14 days</Text>.
                      <br />
                      You can <Text strong>revoke any link immediately</Text> from
                      the &quot;Shared recording links&quot; list on this candidate. Every time a link
                      is opened is recorded on their timeline, with the viewer&apos;s IP address.
                    </>
                  )}
                />
              </div>
            )}

            {/* Same rule as the screening tick below: shown only when this
                candidate actually has a breakdown to send, so it never implies
                a written test that was never taken. */}
            {model.assessments?.some((a) => a.detail_available) && (
              <Checkbox
                checked={includeAssessmentDetail}
                onChange={(e) => setIncludeAssessmentDetail(e.target.checked)}
              >
                Include the written test breakdown
                <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  On by default. Section marks, correct/wrong/unattempted counts, the
                  easy-medium-hard split and topic scores, written into section 7 of the pack.
                  Untick to send the section scores alone.
                </Text>
              </Checkbox>
            )}

            {/* Shown only when there is a screening report — a tick that would do
                nothing is worse than no tick, and it would invite the recruiter
                to assume a report exists. */}
            {model.zeko?.some((z) => z.report_available) && (
              <>
                <Checkbox
                  checked={includeScreeningDetail}
                  onChange={(e) => setIncludeScreeningDetail(e.target.checked)}
                >
                  Include the AI screening assessment in the report
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    On by default. Requirement-by-requirement findings, strengths, concerns and the
                    recommendation, written into section 6 of the pack —{' '}
                    <Text strong>with compensation removed</Text>, like the rest of it. No link and
                    no login involved.
                  </Text>
                </Checkbox>

                <Checkbox
                  checked={includeScreeningReport}
                  onChange={(e) => setIncludeScreeningReport(e.target.checked)}
                >
                  Also add a link to Zeko&apos;s own report page
                  <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    Off by default. Only needed if the interviewer must see the interview recording
                    or the full transcript.
                  </Text>
                </Checkbox>
              </>
            )}

            {includeScreeningReport && (
              // Same construction as the personal-documents warning: the tick is
              // allowed, so the deterrent has to be what the tick reveals.
              <div ref={screeningWarningRef}>
                <Alert
                  type="warning"
                  showIcon
                  style={{ fontSize: 12.5 }}
                  message="This link is not covered by the redaction above"
                  description={(
                    <>
                      It opens Zeko&apos;s own report <Text strong>without a login</Text>, and that page
                      shows what this pack removes: the candidate&apos;s{' '}
                      <Text strong>current and expected CTC</Text>, the{' '}
                      <Text strong>salary range this role is being hired against</Text>, the full
                      interview transcript with audio, and the video recording. None of it is
                      redacted, because the page is Zeko&apos;s, not ours.
                      <br />
                      The ATS <Text strong>cannot expire or withdraw it</Text>: the link belongs to Zeko.
                      Ticking this is recorded against your name on the candidate&apos;s timeline.
                    </>
                  )}
                />
              </div>
            )}

            {includeDocuments && (
              // Wrapped in a plain div because AntD's Alert does not reliably
              // forward a ref to a DOM node, and scrollIntoView needs one.
              <div ref={documentsWarningRef}>
                <Alert
                  type="error"
                  showIcon
                  style={{ fontSize: 12.5 }}
                  message="You are about to send personal identity documents outside the company"
                  description={(
                    <>
                      This can include <Text strong>ID proof, PAN/Aadhaar, payslips and education
                      certificates</Text>. An interviewer assessing technical skill does not normally
                      need any of them, and once the file is emailed it cannot be recalled.
                      <br />
                      <Text strong>This choice is recorded against your name</Text>, along with how
                      many documents were included, on the candidate&apos;s timeline.
                    </>
                  )}
                />
              </div>
            )}

            <div>
              <Text strong style={{ fontSize: 13 }}>Format</Text>
              <Radio.Group
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                style={{ display: 'block', marginTop: 6 }}
              >
                <Radio value="zip">ZIP — report, spreadsheet and a read-me <Tag color="green">Recommended</Tag></Radio>
                <Radio value="html">Report only (opens in a browser, Ctrl+P to save as PDF)</Radio>
                <Radio value="xlsx">Spreadsheet only</Radio>
              </Radio.Group>
            </div>
          </Space>

          {/* Stated positively rather than as disabled checkboxes: these are not
              options the recruiter is declining, they are things the pack cannot
              carry — or has been told to leave out. Rendered only when there is
              something to say, because an empty warning box trains people to
              ignore the next one that is not empty. */}
          {notIncluded.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16, fontSize: 12.5 }}
              message="Not included"
              description={notIncluded.map((note, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={i} style={{ marginTop: i ? 6 : 0 }}>{note}</div>
              ))}
            />
          )}

          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
            This download is recorded against your name on the candidate&apos;s timeline, along with
            what it contained. The pack asks its recipient to delete it after 30 days.
          </Paragraph>
        </>
      )}
    </Modal>
  );
}
