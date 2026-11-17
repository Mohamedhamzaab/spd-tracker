// ---------------------------------------------------------------------------
//  One reading of the engagement data, shared by all three tabs.
//
//  A "line" is one stakeholder as the weekly matrix lists it (a sub-division):
//  how much power and interest it has, where it stands today and where the
//  project needs it. Actions hang off lines. Everything the tabs show is
//  derived here once, so the three views can never disagree.
// ---------------------------------------------------------------------------

export const LADDER = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading'];
export const LADDER_HINT = [
  'Not aware of the project', 'Opposed or blocking', 'Aware, no position',
  'Helping', 'Championing it',
];
export const BANDS = [
  { key: 'Manage Closely', label: 'Manage closely', hint: 'High power, high interest' },
  { key: 'Keep Satisfied', label: 'Keep satisfied', hint: 'High power, lower interest' },
  { key: 'Keep Informed', label: 'Keep informed', hint: 'Lower power, high interest' },
  { key: 'Monitor', label: 'Monitor', hint: 'Lower power, lower interest' },
];
export const LIVE = ['Pending', 'Open/Ongoing', 'Closed'];
export const STATUS_LABEL = { Pending: 'Pending', 'Open/Ongoing': 'Ongoing', Closed: 'Closed' };
export const STATUS_KEY = { Pending: 'p', 'Open/Ongoing': 'o', Closed: 'c' };

export const LANES = [
  { key: 'discuss', title: 'Needs discussion', hint: 'Critical stakeholders who are not yet where the project needs them.' },
  { key: 'unengaged', title: 'Not engaged yet', hint: 'We have not reached them yet, and we need to.' },
  { key: 'moving', title: 'Moving, not there yet', hint: 'Engaged, but still short of where we need them.' },
  { key: 'ok', title: 'On track', hint: 'Already where the project needs them.' },
  { key: 'none', title: 'Not assessed yet', hint: 'No position recorded yet.' },
];

const step = (s) => LADDER.indexOf(s);

// "Item# 5.3: ECG will…" reads as "ECG will…"; the item number is the
// source's numbering and the action already carries its own.
export const cleanText = (t) =>
  String(t || '').replace(/^\s*item\s*#?\s*[\d.]+\s*[:.]*\s*/i, '').replace(/\s+/g, ' ').trim();

export const shortName = (name) =>
  String(name || '').replace(/\s+General$/i, '').replace(/^Ministry of /, '');

export function cut(text, n) {
  const t = cleanText(text);
  if (t.length <= n) return t;
  const at = t.lastIndexOf(' ', n);
  return t.slice(0, at > n * 0.6 ? at : n) + '…';
}

export function buildModel(matrixRows, actions) {
  const lines = (matrixRows || []).map((m) => ({
    id: m.sub_division_id,
    ref: m.sub_reference,
    name: m.sub_division_name,
    short: shortName(m.sub_division_name),
    authority: m.authority_name,
    authorityCode: m.authority_code,
    power: m.influence,
    interest: m.involvement,
    current: m.engagement_current,
    desired: m.engagement_desired,
    priority: m.action_priority,
    critical: !!m.is_critical,
    gapNote: m.gap_remarks,
    gapBy: m.gap_action_by,
    // Its number in the weekly matrix (7, 4.2…) and the matrix's Remarks.
    no: m.matrix_no,
    remarks: m.remarks,
    raw: m,
    actions: [],
    count: { p: 0, o: 0, c: 0 },
  }));
  const byId = new Map(lines.map((l) => [l.id, l]));

  const live = [];
  const resolved = [];
  for (const a of actions || []) {
    if (LIVE.includes(a.status)) live.push(a); else resolved.push(a);
    const l = byId.get(a.sub_division_id);
    if (l && LIVE.includes(a.status)) {
      l.actions.push(a);
      l.count[STATUS_KEY[a.status]] += 1;
    }
  }

  for (const l of lines) {
    l.cs = step(l.current);
    l.ds = step(l.desired);
    l.assessed = l.cs >= 0 && l.ds >= 0;
    l.behind = l.assessed && l.ds > l.cs;
    l.overdue = l.actions.some((a) => a.is_overdue);
    l.open = l.count.p + l.count.o;
    l.lane = !l.assessed ? 'none'
      : l.behind && l.cs === 0 ? 'unengaged'
      : l.behind && l.critical ? 'discuss'
      : l.behind ? 'moving'
      : 'ok';
  }

  const totals = live.reduce((t, a) => { t[STATUS_KEY[a.status]] += 1; return t; }, { p: 0, o: 0, c: 0 });
  const ownerless = live.filter((a) => a.status !== 'Closed' && !(a.orgs || []).length).length;
  const overdue = live.filter((a) => a.is_overdue).length;
  return { lines, byId, live, resolved, totals, ownerless, overdue };
}

// "6 critical stakeholders need discussion" with the counts that are zero
// left out, so the sentence never says "0 are not engaged yet".
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
