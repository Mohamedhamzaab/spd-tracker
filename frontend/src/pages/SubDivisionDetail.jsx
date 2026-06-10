// ---------------------------------------------------------------------------
//  Sub-division detail. The sub-division profile and its full communication
//  thread, with document upload and download on each communication.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import {
  Loading, Empty, ErrorBanner, Section, Modal, FormFields, ConfirmDialog,
  EngagementPill, StatusPill, DirectionPill, Pill, fmtDate, fileSize, useToast, FileDrop,
} from '../components/ui.jsx';
import AuditFeed from '../components/AuditFeed.jsx';
import { SubForm } from './SubDivisions.jsx';
import { MeetingForm } from './Meetings.jsx';
import CommentsThread from '../components/CommentsThread.jsx';
import TasksPanel from '../components/TasksPanel.jsx';
import DocViewer, { isPreviewable } from '../components/DocViewer.jsx';

export default function SubDivisionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { lists, isEditor } = useStore();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingMeeting, setAddingMeeting] = useState(false);
  const [openComm, setOpenComm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [authorities, setAuthorities] = useState([]);
  useEffect(() => { api.authorities().then(setAuthorities).catch(() => {}); }, []);

  function load() {
    api.subDivision(id).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => {
    setData(null);
    load();
  }, [id]);

  if (error) {
    return (
      <>
        <div className="topbar">
          <div className="page-title">Sub-Division</div>
        </div>
        <div className="page">
          <ErrorBanner message={error} />
        </div>
      </>
    );
  }
  if (!data) return <Loading label="Loading sub-division" />;

  const comms = data.communications || [];
  const meetings = data.meetings || [];
  const MOM_VIEW = {
    pending: { label: 'MoM pending', tone: 'red' },
    draft: { label: 'MoM draft', tone: 'amber' },
    final: { label: 'MoM final', tone: 'green' },
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-crumb">
            <Link to="/app/sub-divisions">Sub-Divisions</Link> &nbsp;/&nbsp;{' '}
            {data.sub_reference}
          </div>
          <div className="page-title">{data.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isEditor && (
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              Edit sub-division
            </button>
          )}
          <button className="btn" onClick={() => navigate('/app/sub-divisions')}>
            Back to register
          </button>
        </div>
      </div>
      <div className="page stack-lg">
        <div className="card card-pad">
          <Section
            title="Sub-Division Profile"
            action={<EngagementPill status={data.engagement_status} />}
          >
            <div className="detail-grid">
              <Item label="Reference" value={data.sub_reference} />
              <Item
                label="Authority"
                value={
                  <Link to={'/app/authorities/' + data.authority_id}>
                    {data.authority_name}
                  </Link>
                }
              />
              <Item label="Discipline" value={data.discipline || '-'} />
              <Item label="Primary Objective" value={data.primary_objective || '-'} />
              <Item label="Target Stage" value={data.target_stage || '-'} />
              <Item label="Date Identified" value={fmtDate(data.date_identified) || '-'} />
              <Item label="Primary Contact" value={data.primary_contact || '-'} />
              <Item label="Designation" value={data.designation || '-'} />
              <Item
                label="Email"
                value={data.contact_email
                  ? <a href={`mailto:${data.contact_email}`}>{data.contact_email}</a>
                  : '-'}
              />
              <Item
                label="Phone"
                value={data.contact_phone
                  ? <a href={`tel:${data.contact_phone}`}>{data.contact_phone}</a>
                  : '-'}
              />
              {data.contact_details && (
                <Item label="Contact Details" value={data.contact_details} />
              )}
              <Item
                label="Data Collection"
                value={<Pill tone="grey">{data.data_collection_status}</Pill>}
              />
              <Item
                label="Consultation"
                value={<Pill tone="grey">{data.consultation_status}</Pill>}
              />
              <Item label="NOC Status" value={<StatusPill status={data.noc_status} />} />
            </div>
          </Section>
        </div>

        <div>
          <Section
            title="Communication Thread"
            note={`${comms.length} logged`}
            action={
              isEditor && (
                <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                  + Log Communication
                </button>
              )
            }
          >
            {comms.length === 0 ? (
              <Empty
                title="No communications yet"
                sub={isEditor ? 'Log the first one above.' : undefined}
              />
            ) : (
              comms.map((c) => (
                <div
                  key={c.id}
                  className={
                    'thread-item ' +
                    (c.direction === 'Inbound' ? 'inbound' : 'outbound')
                  }
                  style={{ cursor: 'pointer' }}
                  onClick={() => setOpenComm(c.id)}
                >
                  <div className="thread-head">
                    <span className="mono" style={{ fontSize: 12 }}>
                      {c.comm_code}
                    </span>
                    <DirectionPill direction={c.direction} />
                    <span className="section-note">{fmtDate(c.comm_date)}</span>
                    {c.purpose && <Pill tone="grey">{c.purpose}</Pill>}
                    {c.is_overdue && <Pill tone="red">Overdue</Pill>}
                    {c.direction === 'Outbound' && c.reply_received && (
                      <Pill tone="green">Reply received</Pill>
                    )}
                    {Number(c.document_count) > 0 && (
                      <span className="section-note">
                        {c.document_count} document
                        {Number(c.document_count) > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="thread-summary">{c.summary || '-'}</div>
                  <div className="thread-meta">
                    {c.mode || 'Mode not set'}
                    {c.submission_reference && ' \u00b7 ' + c.submission_reference}
                  </div>
                </div>
              ))
            )}
          </Section>
        </div>

        <div>
          <Section
            title="Meetings"
            note={`${meetings.length} logged`}
            action={
              isEditor && (
                <button className="btn btn-primary btn-sm" onClick={() => setAddingMeeting(true)}>
                  + Add Meeting
                </button>
              )
            }
          >
            {meetings.length === 0 ? (
              <Empty
                title="No meetings yet"
                sub={isEditor
                  ? 'Add one above — it will be linked to this sub-division.'
                  : 'Meetings where this is the primary sub-division appear here.'}
              />
            ) : (
              meetings.map((m) => {
                const mom = MOM_VIEW[m.mom_status] || MOM_VIEW.pending;
                return (
                  <Link
                    key={m.id}
                    to={`/app/meetings?open=${m.id}`}
                    className="thread-item"
                    style={{ display: 'block', cursor: 'pointer', textDecoration: 'none' }}
                  >
                    <div className="thread-head">
                      <span className="mono" style={{ fontSize: 12 }}>{m.meeting_code}</span>
                      <span className="section-note">
                        {fmtDate(m.meeting_date)}
                        {m.meeting_time ? ' · ' + String(m.meeting_time).slice(0, 5) : ''}
                      </span>
                      {m.purpose && <Pill tone="grey">{m.purpose}</Pill>}
                      {m.mode && <Pill tone="grey">{m.mode}</Pill>}
                      <Pill tone={mom.tone}>{mom.label}</Pill>
                      {Number(m.document_count) > 0 && (
                        <span className="section-note">
                          {m.document_count} document{Number(m.document_count) > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {m.attendees && (
                      <div className="thread-meta">Attendees: {m.attendees}</div>
                    )}
                  </Link>
                );
              })
            )}
          </Section>
        </div>

        <div className="card card-pad">
          <Section title="Tasks" />
          <TasksPanel parentType="sub_division" parentId={data.id} />
        </div>

        <div className="card card-pad">
          <Section title="Discussion" />
          <CommentsThread parentType="sub_division" parentId={data.id} />
        </div>

        <div className="card card-pad">
          <Section title="Recent activity" />
          <AuditFeed targetType="sub_division" targetId={data.id} />
        </div>
      </div>

      {editing && (
        <SubForm
          lists={lists}
          authorities={authorities}
          existing={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast('Sub-division updated');
            load();
          }}
        />
      )}
      {adding && (
        <CommForm
          lists={lists}
          subId={data.id}
          onClose={() => setAdding(false)}
          onSaved={(code) => {
            setAdding(false);
            toast('Communication logged: ' + code);
            load();
          }}
        />
      )}
      {addingMeeting && (
        <MeetingForm
          lists={lists}
          authorities={authorities}
          defaults={{
            authority_id: String(data.authority_id),
            primary_sub_id: String(data.id),
          }}
          onClose={() => setAddingMeeting(false)}
          onSaved={(code) => {
            setAddingMeeting(false);
            toast('Meeting added: ' + code);
            load();
          }}
        />
      )}
      {openComm && (
        <CommDetail
          commId={openComm}
          isEditor={isEditor}
          onClose={() => setOpenComm(null)}
          onChanged={() => {
            load();
          }}
        />
      )}
    </>
  );
}

function Item({ label, value }) {
  return (
    <div className="detail-item">
      <div className="dl">{label}</div>
      <div className="dv">{value}</div>
    </div>
  );
}

/* ---- log a communication ------------------------------------------------ */
// Field definitions are shared between create and edit so the two flows
// always present an identical form.
function commFieldDefs(lists, subDivisions) {
  const defs = [];
  // When the form is opened outside a specific sub-division (e.g. from the
  // Communications list page) the caller passes the list of sub-divisions so
  // the user can choose which one this communication belongs to.
  if (subDivisions) {
    defs.push({
      name: 'sub_division_id', label: 'Sub-Division', type: 'select', required: true,
      span: 2, placeholder: 'Choose a sub-division…',
      options: subDivisions.map((s) => ({
        value: s.id,
        label: `${s.sub_reference} — ${s.name}`,
      })),
    });
  }
  defs.push(
    { name: 'comm_date', label: 'Date', type: 'date', required: true },
    { name: 'direction', label: 'Direction', type: 'select', required: true,
      options: lists.direction },
    { name: 'purpose', label: 'Purpose', type: 'select',
      options: lists.communication_purpose },
    { name: 'mode', label: 'Mode', type: 'select', options: lists.communication_mode },
    { name: 'submission_reference', label: 'Submission Reference', span: 2,
      placeholder: 'e.g. 3659-LET-ECG-KMW-26-0001' },
    { name: 'in_response_to', label: 'In Response To', span: 2,
      placeholder: 'Comm code of the original, e.g. C-0003',
      help: 'For an Inbound reply, enter the Outbound code it answers.' },
    { name: 'related_to', label: 'Related To', span: 2,
      placeholder: 'Comm code of a related item, e.g. C-0001',
      help: 'Link a related communication/thread that this is NOT a direct reply to.' },
    { name: 'summary', label: 'Summary / Key Content', type: 'textarea', span: 2 },
    { name: 'acc_link', label: 'Document Link (ACC)', span: 2,
      placeholder: 'Optional link to the document in ACC' },
    { name: 'reply_needed', label: 'A reply is needed for this communication',
      type: 'checkbox', span: 2,
      help: 'Outbound items needing a reply are flagged overdue after 7 days.' },
  );
  return defs;
}

function emptyCommValues() {
  return {
    comm_date: new Date().toISOString().slice(0, 10),
    direction: 'Outbound',
    purpose: '',
    mode: '',
    submission_reference: '',
    in_response_to: '',
    related_to: '',
    summary: '',
    reply_needed: false,
    acc_link: '',
  };
}

function commValuesFromExisting(existing, parentCommCode) {
  return {
    comm_date: existing.comm_date ? String(existing.comm_date).slice(0, 10) : '',
    direction: existing.direction || 'Outbound',
    purpose: existing.purpose || '',
    mode: existing.mode || '',
    submission_reference: existing.submission_reference || '',
    in_response_to: parentCommCode || '',
    related_to: existing.related_to_code || '',
    summary: existing.summary || '',
    reply_needed: !!existing.reply_needed,
    acc_link: existing.acc_link || '',
  };
}

// Used in create mode. Opened either from a sub-division thread (subId is
// fixed) or from the Communications list page (subDivisions is supplied so the
// user picks one).
export function CommForm({ lists, subId, subDivisions, onClose, onSaved }) {
  const [values, setValues] = useState(emptyCommValues());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [createdId, setCreatedId] = useState(null);
  const [createdCode, setCreatedCode] = useState(null);
  const onChange = (n, v) => setValues((s) => ({ ...s, [n]: v }));

  async function save() {
    setError('');
    const targetSub = subId || Number(values.sub_division_id);
    if (!targetSub) return setError('Please choose a sub-division.');
    if (!values.comm_date) return setError('A date is required.');
    setBusy(true);
    try {
      // Create once. If a prior attempt created the comm but the upload failed,
      // reuse it on retry so we never log a duplicate.
      let commId = createdId;
      let commCode = createdCode;
      if (!commId) {
        const created = await api.createComm({ ...values, sub_division_id: targetSub });
        commId = created.id;
        commCode = created.comm_code;
        setCreatedId(commId);
        setCreatedCode(commCode);
      }
      if (pendingFiles.length) {
        await api.uploadDocs('communication', commId, pendingFiles);
      }
      onSaved(commCode);
    } catch (e) {
      setError(
        createdId
          ? 'Communication saved, but the documents failed to upload. Click "Log communication" again to retry, or attach them later by opening the communication. (' + e.message + ')'
          : e.message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title="Log Communication"
      sub="One row per communication event"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving...' : 'Log communication'}
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <FormFields
        fields={commFieldDefs(lists, subId ? null : subDivisions)}
        values={values}
        onChange={onChange}
        disabled={busy}
      />
      <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
        <div className="section-title" style={{ marginBottom: 10 }}>Documents</div>
        {pendingFiles.length === 0 && (
          <div className="section-note" style={{ marginBottom: 10 }}>
            Attach letters or shared files now — they upload when you click “Log communication”.
          </div>
        )}
        {pendingFiles.map((f, i) => (
          <div className="doc-chip" key={i}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="doc-name">{f.name}</div>
              <div className="doc-meta">{fileSize(f.size)}</div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => setPendingFiles((fs) => fs.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          <FileDrop
            label="+ Add document"
            hint="or drag & drop files here — they upload when you save"
            uploading={busy}
            onFiles={(files) => setPendingFiles((fs) => [...fs, ...Array.from(files)])}
          />
        </div>
      </div>
    </Modal>
  );
}

/* ---- communication detail with documents -------------------------------- */
export function CommDetail({ commId, isEditor, onClose, onChanged }) {
  const toast = useToast();
  const { lists } = useStore();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [zipping, setZipping] = useState(false);

  // Edit mode: shares the modal shell, swaps the field grid for the form.
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  function load() {
    api.communication(commId).then(setData).catch((e) => setError(e.message));
  }
  useEffect(load, [commId]);

  // Whenever the user clicks Edit, prefill the form from the current data,
  // including the parent comm_code (looked up once) so the in-response-to
  // field reads naturally instead of an internal id.
  async function startEdit() {
    setEditError('');
    let parentCode = '';
    if (data.in_response_to) {
      try {
        const parent = await api.communication(data.in_response_to);
        parentCode = parent.comm_code || '';
      } catch {
        // not fatal — the field just renders empty
      }
    }
    setValues(commValuesFromExisting(data, parentCode));
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditError('');
  }

  async function saveEdit() {
    setEditError('');
    if (!values.comm_date) { setEditError('A date is required.'); return; }
    setSavingEdit(true);
    try {
      await api.updateComm(commId, values);
      setEditing(false);
      toast('Communication updated');
      load();
      onChanged && onChanged();
    } catch (e) {
      setEditError(e.message || 'Could not update.');
    } finally {
      setSavingEdit(false);
    }
  }

  const onChangeField = (n, v) => setValues((s) => ({ ...s, [n]: v }));

  async function upload(files) {
    if (!files || !files.length) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadDocs('communication', commId, files);
      toast('Document uploaded');
      load();
      onChanged && onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(docId) {
    try {
      await api.deleteDoc(docId);
      toast('Document removed');
      load();
      onChanged && onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
    <Modal
      wide
      title={data ? data.comm_code : 'Communication'}
      sub={data ? data.sub_division_name : ''}
      onClose={onClose}
      footer={
        editing ? (
          <>
            <button className="btn" onClick={cancelEdit} disabled={savingEdit}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? 'Saving…' : 'Save changes'}
            </button>
          </>
        ) : (
          <>
            {isEditor && (
              <button className="btn" onClick={startEdit}>
                Edit
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </>
        )
      }
    >
      <ErrorBanner message={error || editError} />
      {!data ? (
        <Loading label="Loading" />
      ) : editing && values ? (
        <FormFields
          fields={commFieldDefs(lists)}
          values={values}
          onChange={onChangeField}
          disabled={savingEdit}
        />
      ) : (
        <>
          <div className="detail-grid">
            <DItem label="Direction" value={<DirectionPill direction={data.direction} />} />
            <DItem label="Date" value={fmtDate(data.comm_date)} />
            <DItem label="Purpose" value={data.purpose || '-'} />
            <DItem label="Mode" value={data.mode || '-'} />
            <DItem
              label="Reply Needed"
              value={data.reply_needed ? 'Yes' : 'No'}
            />
            <DItem
              label="Status"
              value={
                data.is_overdue ? (
                  <Pill tone="red">Overdue</Pill>
                ) : data.direction === 'Outbound' && data.reply_received ? (
                  <Pill tone="green">Reply received</Pill>
                ) : (
                  <Pill tone="grey">Open</Pill>
                )
              }
            />
            {data.in_response_to_code && (
              <DItem
                label="In response to"
                value={<span className="mono">↩ {data.in_response_to_code}</span>}
              />
            )}
            {data.reply_code && (
              <DItem
                label="Answered by"
                value={<span className="mono">→ {data.reply_code}</span>}
              />
            )}
            {data.related_to_code && (
              <DItem
                label="Related to"
                value={<span className="mono">≈ {data.related_to_code}</span>}
              />
            )}
          </div>
          {data.submission_reference && (
            <DRow label="Submission Reference" value={data.submission_reference} />
          )}
          <DRow label="Summary" value={data.summary || '-'} />
          {data.acc_link && (
            <DRow
              label="ACC Link"
              value={
                <a href={data.acc_link} target="_blank" rel="noreferrer">
                  Open in ACC
                </a>
              }
            />
          )}

          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="section-title">Documents</div>
              {(data.documents || []).length >= 2 && (
                <button
                  className="btn btn-sm"
                  disabled={zipping}
                  onClick={async () => {
                    setZipping(true);
                    setError('');
                    try {
                      await api.downloadDocsZip('communication', commId, `${data.comm_code}-documents.zip`);
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setZipping(false);
                    }
                  }}
                >
                  {zipping ? 'Preparing…' : 'Download all'}
                </button>
              )}
            </div>
            {(data.documents || []).length === 0 && (
              <div className="section-note" style={{ marginBottom: 10 }}>
                No documents uploaded.
              </div>
            )}
            {(data.documents || []).map((d) => (
              <div className="doc-chip" key={d.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="doc-name">{d.original_name}</div>
                  <div className="doc-meta">
                    {fileSize(d.size_bytes)}
                    {d.uploaded_by ? ' \u00b7 ' + d.uploaded_by : ''}
                  </div>
                </div>
                {isPreviewable(d) && (
                  <button className="btn btn-sm" onClick={() => setViewerDoc(d)}>
                    View
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={() => api.downloadDoc(d.id, d.original_name)}
                >
                  Download
                </button>
                {isEditor && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => removeDoc(d.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {isEditor && (
              <div style={{ marginTop: 10 }}>
                <FileDrop onFiles={upload} uploading={uploading} />
              </div>
            )}
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>
              Tasks
            </div>
            <TasksPanel parentType="communication" parentId={commId} />
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="section-title" style={{ marginBottom: 10 }}>
              Discussion
            </div>
            <CommentsThread parentType="communication" parentId={commId} />
          </div>
        </>
      )}
    </Modal>
    {viewerDoc && <DocViewer doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </>
  );
}

function DItem({ label, value }) {
  return (
    <div className="detail-item">
      <div className="dl">{label}</div>
      <div className="dv">{value}</div>
    </div>
  );
}
function DRow({ label, value }) {
  return (
    <div className="detail-item" style={{ marginTop: 12 }}>
      <div className="dl">{label}</div>
      <div className="dv">{value}</div>
    </div>
  );
}
