// ---------------------------------------------------------------------------
//  Reference lists  -  the fixed dropdown options used by the entry forms.
//  Kept in one place so the front end and the database rules never drift.
// ---------------------------------------------------------------------------
const express = require('express');
const { wrap } = require('../helpers');

const router = express.Router();

const LISTS = {
  authority_category: [
    'Government Ministry',
    'Statutory or Regulatory Authority',
    'Utility Provider',
    'Service Provider',
    'Certification Body',
    'Adjacent Operator',
  ],
  influence_level: ['High', 'Medium', 'Low'],
  decision_authority: [
    'Statutory Approval',
    'NOC / Non-objection',
    'Review and Recommend',
    'Certification',
    'Service Provision',
    'Coordination Only',
  ],
  engagement_strategy: [
    'Manage Closely',
    'Keep Satisfied',
    'Keep Informed',
    'Monitor',
  ],
  discipline: [
    'Planning and Lands', 'Potable Water', 'Electricity', 'Roads',
    'Drainage and Sewage', 'TSE Networks', 'Transport', 'Telecommunications',
    'Broadband Network', 'Communications and IT', 'Security Systems',
    'Civil Defence', 'Traffic', 'Environment', 'Sustainability', 'Gas',
    'Diesel and Fuel', 'Tourism', 'Public Health', 'Defence',
    'Animal Resources', 'General',
  ],
  primary_objective: ['Data Collection Only', 'NOC / Non-objection'],
  target_stage: [
    'Stage 1 - Project Brief',
    'Stage 2 - Master Plan',
    'Stage 3 - Concept Design',
    'Stage 4 - Schematic Design',
    'Stage 5 - Tender Document',
    'Stage 6 - Tendering Support',
  ],
  direction: ['Outbound', 'Inbound'],
  communication_mode: [
    'Letter', 'Email', 'Letter and Email', 'Authority Portal',
    'Phone Call', 'Other',
  ],
  communication_purpose: ['Data Collection', 'Consultation', 'NOC / Approval'],
  data_collection_status: [
    'Not Started', 'Requested', 'Partially Received', 'Received in Full',
  ],
  consultation_status: ['Not Started', 'Ongoing', 'Closed'],
  noc_status: [
    'Not Started', 'Submitted', 'Under Review', 'Comments Received',
    'Non-objection Granted', 'Non-objection with Conditions', 'Objection Raised',
  ],
  meeting_mode: ['In Person', 'Online', 'Hybrid'],
  meeting_purpose: ['Data Collection', 'Consultation', 'NOC / Approval'],
};

// GET /api/lists  -  every dropdown list in one response.
router.get(
  '/',
  wrap(async (req, res) => {
    res.json(LISTS);
  })
);

module.exports = { router, LISTS };
