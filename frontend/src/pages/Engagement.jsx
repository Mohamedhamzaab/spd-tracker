// ---------------------------------------------------------------------------
//  Stakeholder Engagement — three ways to read one register.
//
//    Weekly picture         for the Client: one sentence on how things stand,
//                           then every stakeholder grouped by what to do next
//    Where everyone stands  the whole register on one board: stance across,
//                           power and interest down; flip to where we need them
//    Work board             for the stakeholder manager: the actions as
//                           Pending / Ongoing / Closed
//
//  Status is never chosen here. It follows the timeline: an action is Pending
//  until someone logs what they did, and closes only with evidence behind it.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import { useLive, ENGAGEMENT_EVENTS } from '../lib/liveStream.js';
import { Loading, ErrorBanner, useToast, DownloadButton } from '../components/ui.jsx';
import ActionDetail from '../components/ActionDetail.jsx';
import ActionForm from '../components/ActionForm.jsx';
import { buildModel } from '../components/engagement/model.js';
import WeeklyPicture from '../components/engagement/WeeklyPicture.jsx';
import Standings from '../components/engagement/Standings.jsx';
import WorkBoard from '../components/engagement/WorkBoard.jsx';
import StakeholderPanel from '../components/engagement/StakeholderPanel.jsx';
import '../components/engagement/engagement.css';

const TABS = [
  { key: 'picture', label: 'Weekly picture' },
  { key: 'standings', label: 'Where everyone stands' },
  { key: 'board', label: 'Work board' },
];
// Links made before the redesign still land somewhere sensible.
const OLD_TABS = { items: 'board', removed: 'board', matrix: 'standings', assessment: 'standings' };

function tabFromUrl() {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.key === t) ? t : OLD_TABS[t] || 'picture';
}

// The matrix is built from sub-divisions and authorities too (v_engagement_matrix).
const LIVE_EVENTS = [
  ...ENGAGEMENT_EVENTS,
  'data.subdivision.created', 'data.subdivision.updated', 'data.subdivision.deleted',
  'data.authority.created', 'data.authority.updated', 'data.authority.deleted',
];

export default function Engagement() {
  const { isEditor } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState(tabFromUrl);
  const [matrix, setMatrix] = useState(null);
  const [actions, setActions] = useState(null);
  const [error, setError] = useState('');
  const [lineId, setLineId] = useState(null);
  const [detail, setDetail] = useState(null);   // { id, mode }
  const [raising, setRaising] = useState(null); // { sub_division_id } | {}

  const load = useCallback(() => {
    Promise.all([api.engMatrix(), api.engActions({})])
      .then(([m, a]) => { setMatrix(m.rows); setActions(a); setError(''); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  // Anyone's change shows here within a second, so a shared screen stays current.
  useLive(LIVE_EVENTS, load);

  const model = useMemo(
    () => (matrix && actions ? buildModel(matrix, actions) : null), [matrix, actions]);
  const line = model && lineId ? model.byId.get(lineId) : null;

  function pickTab(k) {
    setTab(k);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', k);
    window.history.replaceState(null, '', u);
  }

  function moveCard(a, status) {
    if (status === 'Pending') {
      toast('An action goes back to Pending only when its entries are removed. Open it to do that.');
      return;
    }
    setDetail({ id: a.id, mode: status === 'Closed' ? 'closure' : 'progress' });
  }

  const openAction = (id) => setDetail({ id, mode: null });
  const openLine = (l) => setLineId(l.id);
  const raise = (subId) => setRaising(subId ? { sub_division_id: subId } : {});

  return (
    <MotionConfig reducedMotion="user">
      <div className="topbar">
        <div>
          <div className="page-crumb">Tracker</div>
          <div className="page-title">Stakeholder Engagement</div>
        </div>
        <div className="eg-top-actions">
          <DownloadButton
            className="btn"
            title="The matrix, assessment and register in the weekly workbook layout"
            download={() => api.downloadExport('/exports/stakeholder-engagement.xlsx', 'stakeholder-engagement-matrix.xlsx')}
          >
            Export Excel
          </DownloadButton>
          <DownloadButton
            className="btn"
            download={() => api.downloadExport('/exports/stakeholder-engagement.pdf', 'stakeholder-engagement-matrix.pdf')}
          >
            Export PDF
          </DownloadButton>
          {isEditor && <button className="btn btn-primary" onClick={() => raise()}>Raise action</button>}
        </div>
      </div>

      <div className="page eg">
        <div className="eg-tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={'eg-tab' + (tab === t.key ? ' is-on' : '')}
              onClick={() => pickTab(t.key)}
            >
              {tab === t.key && <motion.span layoutId="eg-tab-pill" className="eg-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className="eg-tab-label">{t.label}</span>
            </button>
          ))}
        </div>

        <ErrorBanner message={error} />
        {!model ? (!error && <Loading label="Loading the register" />) : (
          // Enter only. An exit waiting on the board's moving names could
          // stall and leave the next tab unmounted, so the old view just goes.
          <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {tab === 'picture' && (
                <WeeklyPicture model={model} isEditor={isEditor}
                  onOpenAction={openAction} onOpenLine={openLine} onRaise={raise} />
              )}
              {tab === 'standings' && (
                <Standings model={model} onOpenLine={openLine} selectedId={lineId} />
              )}
              {tab === 'board' && (
                <WorkBoard model={model} isEditor={isEditor}
                  onOpenAction={openAction} onMove={moveCard} onChanged={load} />
              )}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {line && (
          <StakeholderPanel
            key="panel"
            line={line}
            isEditor={isEditor}
            onClose={() => setLineId(null)}
            onOpenAction={openAction}
            onRaise={raise}
            onSaved={() => { toast('Position saved'); load(); }}
          />
        )}
      </AnimatePresence>

      {detail && (
        <ActionDetail
          key={detail.id + ':' + detail.mode}
          id={detail.id}
          openProgress={detail.mode || undefined}
          isEditor={isEditor}
          onClose={() => setDetail(null)}
          onChanged={load}
        />
      )}
      {raising && (
        <ActionForm
          defaults={raising}
          onClose={() => setRaising(null)}
          onSaved={(code) => { setRaising(null); toast('Action raised: ' + code); load(); }}
        />
      )}
    </MotionConfig>
  );
}
