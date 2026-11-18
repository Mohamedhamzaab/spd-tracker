// The rules behind the Stakeholder Engagement page. Plain JavaScript, so it
// runs with Node's own test runner:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, cleanText } from './model.js';

const row = (id, current, desired, critical = false) => ({
  sub_division_id: id, sub_division_name: `Line ${id}`,
  engagement_current: current, engagement_desired: desired, is_critical: critical,
});
const action = (sub, status, extra = {}) => ({ sub_division_id: sub, status, orgs: ['ECG'], ...extra });

test('each stakeholder lands in the right lane', () => {
  const { byId } = buildModel([
    row(1, null, 'Supportive'),               // no position recorded
    row(2, 'Unaware', 'Supportive', true),    // not reached yet, even when critical
    row(3, 'Neutral', 'Supportive', true),    // critical and short of the target
    row(4, 'Neutral', 'Supportive'),          // short of the target, not critical
    row(5, 'Supportive', 'Supportive', true), // already there
    row(6, 'Leading', 'Supportive'),          // past the target
  ], []);
  const lanes = [1, 2, 3, 4, 5, 6].map((id) => byId.get(id).lane);
  assert.deepEqual(lanes, ['none', 'unengaged', 'discuss', 'moving', 'ok', 'ok']);
});

test('only Pending, Ongoing and Closed actions are counted', () => {
  const m = buildModel([row(1, 'Neutral', 'Supportive')], [
    action(1, 'Pending', { is_overdue: true }),
    action(1, 'Open/Ongoing', { orgs: [] }),
    action(1, 'Closed', { orgs: [] }),
    action(1, 'Cancelled'),
    action(1, 'Superseded'),
    action(99, 'Pending'), // its stakeholder is not on the matrix
  ]);
  const line = m.byId.get(1);
  assert.deepEqual(line.count, { p: 1, o: 1, c: 1 });
  assert.equal(line.open, 2);
  assert.equal(line.overdue, true);
  assert.deepEqual(m.totals, { p: 2, o: 1, c: 1 });
  assert.equal(m.resolved.length, 2);
  // A closed action needs no owner; an open one with none is flagged.
  assert.equal(m.ownerless, 1);
  assert.equal(m.overdue, 1);
});

test('the source numbering is dropped from action text', () => {
  assert.equal(cleanText('Item# 5.3:  ECG will  send the drawings'), 'ECG will send the drawings');
  assert.equal(cleanText(null), '');
});
