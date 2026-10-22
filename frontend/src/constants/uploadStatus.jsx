/**
 * uploadStatus.jsx — what each resume-upload job status means, shared by HR
 * Upload and the Vendor portal (Phase 3 "Do Now", N35). The two pages used to
 * carry identical copies; one list keeps their wording from drifting apart.
 *
 * Keys are the stored rpa_cv_upload status values; `hint` is the hover text.
 */
import {
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, SyncOutlined, WarningOutlined,
} from '@ant-design/icons';

export const UPLOAD_STATUS_META = Object.freeze({
  Uploaded: { label: 'Received', color: 'default', hint: 'Received and queued — reading the resume hasn’t started yet.' },
  Queued: { label: 'Waiting in Queue', color: 'blue', icon: <SyncOutlined />, hint: 'Waiting for the background worker to pick it up. Usually a few seconds to a few minutes.' },
  Processing: { label: 'Processing', color: 'processing', icon: <SyncOutlined spin />, hint: 'Reading the resume and filling in the candidate’s details with AI.' },
  Duplicate_Pending_Review: { label: 'Pending Recruiter Review', color: 'warning', icon: <WarningOutlined />, hint: 'This candidate already exists. A recruiter must merge the new resume into the existing record or reject it.' },
  Missing_Information: { label: 'Awaiting Candidate Details', color: 'orange', icon: <ExclamationCircleOutlined />, hint: 'Saved, but some mandatory details are missing; the candidate has been asked to fill them in.' },
  Completed: { label: 'Saved to Database', color: 'success', icon: <CheckCircleOutlined />, hint: 'Done: the candidate is saved and can be found in Search Candidate and Screening.' },
  Failed: { label: 'Processing Failed', color: 'error', icon: <CloseCircleOutlined />, hint: 'Something went wrong while reading the resume. You can reprocess it.' },
  Rejected_By_System: { label: 'Rejected by System', color: 'volcano', icon: <CloseCircleOutlined />, hint: 'No valid email or phone on the resume, so it was not saved. Re-upload with at least one.' },
  Cancelled: { label: 'Rejected by Recruiter', color: 'default', icon: <CloseCircleOutlined />, hint: 'A recruiter rejected this duplicate; the existing record was kept.' },
});

/** Options for the status filter on both pages. */
export const UPLOAD_STATUS_FILTERS = Object.keys(UPLOAD_STATUS_META).map((s) => ({
  value: s,
  label: UPLOAD_STATUS_META[s].label,
}));

/** Meta for any status, falling back to the raw value for one this list doesn't know. */
export const uploadStatusMeta = (status) => UPLOAD_STATUS_META[status] || { label: status, color: 'default' };
