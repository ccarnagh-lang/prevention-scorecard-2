/**
 * server/database.js — PostgreSQL data layer with children tracking
 */
const { pool } = require('./migrate');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}
async function queryOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

// ── SCORE CALCULATION ─────────────────────────────────────────
function calcAllScores(responses) {
  const score = cadence => {
    const items = responses.filter(r =>
      !r.unscored &&
      (cadence === 'all' || r.cadence === cadence) &&
      r.response && !['Not applicable','N/A',''].includes(r.response)
    );
    if (!items.length) return null;
    return Math.round(items.filter(r => r.response === 'Yes').length / items.length * 100);
  };
  const ws = score('weekly'), ms = score('monthly'), qs = score('quarterly');
  const valid = [ws,ms,qs].filter(s => s != null);
  const ls = valid.length ? Math.round(valid.reduce((a,b) => a+b, 0) / valid.length) : null;
  const w9  = responses.find(r => r.id === 'W9');
  const w10 = responses.find(r => r.id === 'W10');
  const sf  = w9?.response === 'Yes' && (w10?.response === 'No' || w10?.response === 'Some but not all') ? 'Yes' : 'No';
  const q1  = responses.find(r => r.id === 'Q1');
  const fasp = q1?.response === 'Yes' ? 'Current' : q1?.response === 'No' ? 'Overdue' : 'Pending';
  return { ws, ms, qs, ls, sf, fasp };
}

// ── CSV IMPORT ENGINE ─────────────────────────────────────────
/**
 * importRosterCSV — processes weekly CSV upload
 *
 * CSV columns (tab or comma separated):
 * Child Name | Child PID | CIN | Gender | DOB | Racial Identity | Ethnicity |
 * PPG | Program Choice 1 | Program Choice 2 | Program Choice 3 |
 * CONN Case ID | WMS Case ID | Case Name | CID | Stage ID | Stage Type |
 * Stage Start | Agency | Worker Name | Role | Site-Unit
 *
 * Logic:
 * - Cases in upload → active, add_date set if new
 * - Cases NOT in upload but were active → end_dated today
 * - Children matched by (case_id + CIN) → update if changed, add if new
 * - Children not in upload for active case → end_dated
 */
async function importRosterCSV(csvText, uploadedBy) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV file appears empty');

  // Detect delimiter — handle tab, comma, and Windows line endings
  const firstLine = lines[0].replace(/\r/g, '');
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const headers = firstLine.split(delim).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());

  // Map header positions
  const col = name => {
    const aliases = {
      'child_name':      ['child name'],
      'child_pid':       ['child pid'],
      'cin':             ['cin'],
      'gender':          ['gender'],
      'dob':             ['dob'],
      'racial_identity': ['racial identity'],
      'ethnicity':       ['ethnicity'],
      'ppg':             ['ppg'],
      'conn_case_id':    ['conn case id', 'cnnx case id', 'case id'],
      'wms_case_id':     ['wms case id'],
      'case_name':       ['case name'],
      'cid':             ['cid'],
      'stage_id':        ['stage id'],
      'stage_type':      ['stage type'],
      'stage_start':     ['stage start'],
      'agency':          ['agency'],
      'worker_name':     ['worker name'],
      'role':            ['role'],
      'site_unit':       ['site-unit', 'site unit'],
    };
    const aliasList = aliases[name] || [name];
    for (const alias of aliasList) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const get = (row, name) => {
    const idx = col(name);
    if (idx === -1) return '';
    return (row[idx] || '').trim().replace(/^"|"$/g, '');
  };

  // Parse all rows
  const rows = lines.slice(1).map(line => line.split(delim));
const validRows = rows.filter(r => r.length > 3 && get(r, 'conn_case_id') && get(r, 'conn_case_id').trim() !== '');

  if (validRows.length === 0) {
    throw new Error(`No valid rows found. Headers detected: [${headers.join(' | ')}]. First data row length: ${rows[0]?.length}. CONN Case ID index: ${headers.indexOf('conn case id')}`);
  }

  // Group by case_id
  const caseMap = {};
  for (const row of validRows) {
    const caseId   = get(row, 'conn_case_id');
    const siteUnit = get(row, 'site_unit');
    if (!caseMap[caseId]) {
      caseMap[caseId] = {
        case_id:     caseId,
        program_id:  siteUnit,
        wms_case_id: get(row, 'wms_case_id'),
        case_name:   get(row, 'case_name'),
        planner_name:get(row, 'worker_name'),
        agency:      get(row, 'agency'),
        open_date:   get(row, 'stage_start'),
        children: [],
      };
    }
    const cin = get(row, 'cin');
    if (cin && cin.trim() !== '') {
      caseMap[caseId].children.push({
        child_name:      get(row, 'child_name'),
        child_pid:       get(row, 'child_pid'),
        cin,
        gender:          get(row, 'gender'),
        dob:             get(row, 'dob'),
        racial_identity: get(row, 'racial_identity'),
        ethnicity:       get(row, 'ethnicity'),
        ppg:             get(row, 'ppg'),
        wms_case_id:     get(row, 'wms_case_id'),
        case_name:       get(row, 'case_name'),
        cid:             get(row, 'cid'),
        stage_id:        get(row, 'stage_id'),
        stage_type:      get(row, 'stage_type'),
        stage_start:     get(row, 'stage_start'),
        agency:          get(row, 'agency'),
        worker_name:     get(row, 'worker_name'),
        worker_role:     get(row, 'role'),
        site_unit:       get(row, 'site_unit'),
        program_id:      get(row, 'site_unit'),
        added_date:      today,
      });
    }
  }

  const uploadedCaseIds = Object.keys(caseMap);
  let stats = { cases_added: 0, cases_updated: 0, cases_ended: 0, children_added: 0, children_updated: 0, children_ended: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. End-date active cases NOT in this upload
    const activeResult = await client.query(
      "SELECT case_id FROM roster WHERE active=true AND last_seen_upload IS NOT NULL"
    );
    for (const { case_id } of activeResult.rows) {
      if (!uploadedCaseIds.includes(case_id)) {
        await client.query(
          'UPDATE roster SET active=false, end_date=$1 WHERE case_id=$2',
          [today, case_id]
        );
        await client.query(
          'UPDATE children SET active=false, end_date=$1 WHERE case_id=$2',
          [today, case_id]
        );
        stats.cases_ended++;
      }
    }

    // 2. Upsert each case and its children
    for (const c of Object.values(caseMap)) {
      const existing = await client.query('SELECT case_id FROM roster WHERE case_id=$1', [c.case_id]);
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO roster (case_id,program_id,planner_name,wms_case_id,case_name,agency,open_date,active,last_seen_upload,children_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
          [c.case_id, c.program_id, c.planner_name, c.wms_case_id, c.case_name, c.agency, c.open_date, today, c.children.length]
        );
        stats.cases_added++;
      } else {
        await client.query(
          `UPDATE roster SET program_id=$1, planner_name=$2, wms_case_id=$3, case_name=$4,
           agency=$5, active=true, end_date=NULL, last_seen_upload=$6, children_count=$7 WHERE case_id=$8`,
          [c.program_id, c.planner_name, c.wms_case_id, c.case_name, c.agency, today, c.children.length, c.case_id]
        );
        stats.cases_updated++;
      }

      // Upsert children
      const uploadedCINs = c.children.map(ch => ch.cin).filter(Boolean);

      // End-date children not in this upload
      if (uploadedCINs.length > 0) {
        await client.query(
          `UPDATE children SET active=false, end_date=$1
           WHERE case_id=$2 AND active=true AND cin NOT IN (${uploadedCINs.map((_,i)=>'$'+(i+3)).join(',')})`,
          [today, c.case_id, ...uploadedCINs]
        );
      }

      for (const ch of c.children) {
        const existingChild = await client.query(
          'SELECT id FROM children WHERE case_id=$1 AND cin=$2',
          [c.case_id, ch.cin]
        );
        if (existingChild.rows.length === 0) {
          await client.query(
            `INSERT INTO children (case_id,program_id,child_name,child_pid,cin,gender,dob,racial_identity,ethnicity,ppg,wms_case_id,case_name,cid,stage_id,stage_type,stage_start,agency,worker_name,worker_role,site_unit,active,added_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21)`,
            [ch.case_id, ch.program_id, ch.child_name, ch.child_pid, ch.cin, ch.gender, ch.dob,
             ch.racial_identity, ch.ethnicity, ch.ppg, ch.wms_case_id, ch.case_name, ch.cid,
             ch.stage_id, ch.stage_type, ch.stage_start, ch.agency, ch.worker_name, ch.worker_role,
             ch.site_unit, today]
          );
          stats.children_added++;
        } else {
          await client.query(
            `UPDATE children SET child_name=$1, gender=$2, dob=$3, worker_name=$4,
             worker_role=$5, program_id=$6, active=true, end_date=NULL WHERE case_id=$7 AND cin=$8`,
            [ch.child_name, ch.gender, ch.dob, ch.worker_name, ch.worker_role, ch.program_id, ch.case_id, ch.cin]
          );
          stats.children_updated++;
        }
      }
    }

    await client.query('COMMIT');
    return stats;
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {

  // ── AUTH ──────────────────────────────────────────────────
  async getUserByEmail(email) {
    return queryOne('SELECT * FROM users WHERE email=$1 AND active=true', [email]);
  },
  async updateLastLogin(userId) {
    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [userId]);
  },

  // ── USER MANAGEMENT ───────────────────────────────────────
  async getAllUsers() {
    return query('SELECT id,email,name,initials,role,program_id,active,created_at,last_login FROM users ORDER BY role,name');
  },
  async createUser(data) {
    const hash = bcrypt.hashSync(data.password, 10);
    const initials = (data.initials || data.name.split(' ').map(p=>p[0]).join('').slice(0,2)).toUpperCase();
    return queryOne(
      'INSERT INTO users (email,password,name,initials,role,program_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [data.email.toLowerCase().trim(), hash, data.name, initials, data.role, data.program_id || null]
    );
  },
  async updateUser(id, data) {
    await query('UPDATE users SET name=$1,role=$2,program_id=$3,active=$4 WHERE id=$5',
      [data.name, data.role, data.program_id || null, data.active !== false, id]);
  },
  async resetPassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, 10);
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, id]);
  },
  async deactivateUser(id) {
    await query('UPDATE users SET active=false WHERE id=$1', [id]);
  },

  // ── PROGRAMS ──────────────────────────────────────────────
  async getAllPrograms() {
    return query('SELECT * FROM programs WHERE active=true ORDER BY name');
  },
  async createProgram(data) {
    await query(
      `INSERT INTO programs (id,name,modality,borough,site_code) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=$2,modality=$3,borough=$4,site_code=$5`,
      [data.id, data.name, data.modality||null, data.borough||null, data.site_code||null]
    );
  },
  async getProgramScores() {
    const programs = await this.getAllPrograms();
    return Promise.all(programs.map(async p => {
      const scores = await queryOne(
        `SELECT ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
                ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls
         FROM entries WHERE program_id=$1`, [p.id]) || {};
      const cases   = parseInt((await queryOne('SELECT COUNT(*) as c FROM roster WHERE program_id=$1 AND active=true', [p.id]))?.c || 0);
      const flags   = parseInt((await queryOne("SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE program_id=$1 AND safety_flag='Yes'", [p.id]))?.c || 0);
      const fasp    = parseInt((await queryOne("SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE program_id=$1 AND fasp_status='Overdue'", [p.id]))?.c || 0);
      const children= parseInt((await queryOne('SELECT COUNT(*) as c FROM children WHERE program_id=$1 AND active=true', [p.id]))?.c || 0);
      return { ...p, cases, ...scores, flags, fasp, children };
    }));
  },
  async getWeeklyTrend(programId) {
    const rows = programId
      ? await query(`SELECT week_ending, ROUND(AVG(weekly_score))::int as score FROM entries WHERE weekly_score IS NOT NULL AND program_id=$1 GROUP BY week_ending ORDER BY week_ending DESC LIMIT 12`, [programId])
      : await query(`SELECT week_ending, ROUND(AVG(weekly_score))::int as score FROM entries WHERE weekly_score IS NOT NULL GROUP BY week_ending ORDER BY week_ending DESC LIMIT 12`);
    return rows.reverse();
  },

  // ── ROSTER ────────────────────────────────────────────────
  async getRoster(programId, activeOnly = true) {
    let sql = 'SELECT * FROM roster WHERE 1=1';
    const params = [];
    if (programId)  { sql += ` AND program_id=$${params.push(programId)}`; }
    if (activeOnly) { sql += ' AND active=true'; }
    sql += ' ORDER BY case_id';
    return query(sql, params);
  },
  async addCase(data) {
    await query(
      `INSERT INTO roster (case_id,household_id,program_id,planner_name,supervisor_name,open_date,children_count,modality,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (case_id) DO NOTHING`,
      [data.case_id, data.household_id, data.program_id, data.planner_name,
       data.supervisor_name, data.open_date, data.children_count||1, data.modality, data.notes||'']
    );
  },
  async updateCase(caseId, data) {
    await query(
      'UPDATE roster SET planner_name=$1,supervisor_name=$2,children_count=$3,active=$4,notes=$5 WHERE case_id=$6',
      [data.planner_name, data.supervisor_name, data.children_count, data.active!==false, data.notes||'', caseId]
    );
  },

  // ── CHILDREN ──────────────────────────────────────────────
  async getChildrenForCase(caseId) {
    return query(
      'SELECT * FROM children WHERE case_id=$1 AND active=true ORDER BY child_name',
      [caseId]
    );
  },
  async getChildrenForProgram(programId) {
    return query(
      'SELECT c.*, r.planner_name FROM children c JOIN roster r ON c.case_id=r.case_id WHERE c.program_id=$1 AND c.active=true ORDER BY c.case_id, c.child_name',
      [programId]
    );
  },
  async getAllActiveChildren(programId) {
    let sql = 'SELECT c.*, r.planner_name, r.case_name FROM children c JOIN roster r ON c.case_id=r.case_id WHERE c.active=true AND r.active=true';
    const params = [];
    if (programId) { sql += ` AND c.program_id=$${params.push(programId)}`; }
    sql += ' ORDER BY c.program_id, c.case_id, c.child_name';
    return query(sql, params);
  },
  importRosterCSV,

  // ── CHILDREN SEEN COMPLIANCE ──────────────────────────────
  async getChildrenSeenCompliance(programId, month, year) {
    // For each active child, count how many times seen in the given month
    const monthStr = `${year}-${String(month).padStart(2,'0')}`;
    let sql = `
      SELECT
        c.cin, c.child_name, c.dob, c.case_id, c.program_id,
        r.planner_name, r.case_name,
        COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END)::int as times_seen,
        MAX(CASE WHEN cs->>'seen' = 'Yes' THEN e.week_ending END) as last_seen,
        CASE WHEN COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END) >= 2
             THEN 'Compliant' ELSE 'Non-compliant' END as compliance_status
      FROM children c
      JOIN roster r ON c.case_id = r.case_id
      LEFT JOIN entries e ON e.case_id = c.case_id
        AND e.week_ending LIKE $1
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.children_seen,'[]')) cs ON cs->>'cin' = c.cin
      WHERE c.active = true AND r.active = true`;
    const params = [monthStr + '%'];
    if (programId) {
      sql += ` AND c.program_id=$${params.push(programId)}`;
    }
    sql += ' GROUP BY c.cin, c.child_name, c.dob, c.case_id, c.program_id, r.planner_name, r.case_name ORDER BY compliance_status, c.program_id, c.case_id, c.child_name';
    return query(sql, params);
  },

  async getChildrenNotSeenThisWeek(programId, weekEnding) {
    let sql = `
      SELECT
        c.cin, c.child_name, c.dob, c.case_id, c.program_id,
        r.planner_name, r.case_name,
        COALESCE(cs->>'seen', 'Not submitted') as seen_status,
        COALESCE(cs->>'reason_not_seen', '') as reason_not_seen
      FROM children c
      JOIN roster r ON c.case_id = r.case_id
      LEFT JOIN entries e ON e.case_id = c.case_id AND e.week_ending = $1
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.children_seen,'[]')) cs ON cs->>'cin' = c.cin
      WHERE c.active = true AND r.active = true
        AND (cs->>'seen' IS NULL OR cs->>'seen' != 'Yes')`;
    const params = [weekEnding];
    if (programId) {
      sql += ` AND c.program_id=$${params.push(programId)}`;
    }
    sql += ' ORDER BY c.program_id, c.case_id, c.child_name';
    return query(sql, params);
  },

  // ── ENTRIES ───────────────────────────────────────────────
  async saveEntry(entry, userId, userName, userRole) {
    const responses    = entry.responses || [];
    const childrenSeen = entry.children_seen || [];
    const { ws, ms, qs, ls, sf, fasp } = calcAllScores(responses);
    const recordId = 'LOG-' + uuidv4().slice(0,8).toUpperCase();
    await query(
      `INSERT INTO entries
       (record_id,case_id,program_id,week_ending,submitted_by,submitted_name,submitted_role,
        case_planner,household_id,children_count,submission_notes,responses,children_seen,
        weekly_score,monthly_score,quarterly_score,lifetime_score,safety_flag,fasp_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [recordId, entry.case_id, entry.program_id, entry.week_ending,
       userId, userName, userRole, entry.case_planner, entry.household_id,
       entry.children_count, entry.submission_notes,
       JSON.stringify(responses), JSON.stringify(childrenSeen),
       ws, ms, qs, ls, sf, fasp]
    );
  },
  async updateEntry(id, entry, userId) {
    const responses    = entry.responses || [];
    const childrenSeen = entry.children_seen || [];
    const { ws, ms, qs, ls, sf, fasp } = calcAllScores(responses);
    await query(
      `UPDATE entries SET responses=$1,children_seen=$2,weekly_score=$3,monthly_score=$4,
       quarterly_score=$5,lifetime_score=$6,safety_flag=$7,fasp_status=$8,case_planner=$9,
       children_count=$10,submission_notes=$11,last_edited_by=$12,last_edited_at=NOW()
       WHERE id=$13 AND reviewed=false`,
      [JSON.stringify(responses), JSON.stringify(childrenSeen), ws, ms, qs, ls, sf, fasp,
       entry.case_planner, entry.children_count, entry.submission_notes, userId, id]
    );
  },
  async reviewEntry(id, reviewerId) {
    await query('UPDATE entries SET reviewed=true,reviewed_by=$1,reviewed_at=NOW() WHERE id=$2', [reviewerId, id]);
  },
  async getEntries({ caseId, programId, weekEnding, planner, dateFrom, dateTo, limit=500 }) {
    let sql = 'SELECT * FROM entries WHERE 1=1';
    const params = [];
    if (caseId)     { sql += ` AND case_id=$${params.push(caseId)}`; }
    if (programId)  { sql += ` AND program_id=$${params.push(programId)}`; }
    if (weekEnding) { sql += ` AND week_ending=$${params.push(weekEnding)}`; }
    if (planner)    { sql += ` AND case_planner=$${params.push(planner)}`; }
    if (dateFrom)   { sql += ` AND week_ending>=$${params.push(dateFrom)}`; }
    if (dateTo)     { sql += ` AND week_ending<=$${params.push(dateTo)}`; }
    sql += ` ORDER BY created_at DESC LIMIT $${params.push(limit)}`;
    const rows = await query(sql, params);
    return rows.map(e => ({
      ...e,
      responses:     Array.isArray(e.responses)     ? e.responses     : JSON.parse(e.responses     || '[]'),
      children_seen: Array.isArray(e.children_seen) ? e.children_seen : JSON.parse(e.children_seen || '[]'),
    }));
  },
  async getLatestPerCase(programId) {
    const sql = `
      SELECT e.* FROM entries e
      JOIN (SELECT case_id, MAX(id) as mid FROM entries ${programId?'WHERE program_id=$1':''} GROUP BY case_id) m
      ON e.id=m.mid ORDER BY e.case_id`;
    const rows = await query(sql, programId ? [programId] : []);
    return rows.map(e => ({
      ...e,
      responses:     Array.isArray(e.responses)     ? e.responses     : JSON.parse(e.responses     || '[]'),
      children_seen: Array.isArray(e.children_seen) ? e.children_seen : JSON.parse(e.children_seen || '[]'),
    }));
  },

  // ── DASHBOARD ─────────────────────────────────────────────
  async getDashboard(programId, weekEnding) {
    const we = weekEnding || new Date().toISOString().slice(0,10);
    const pf = programId ? ` AND program_id='${programId}'` : '';

    const totalCases  = parseInt((await queryOne(`SELECT COUNT(*) as c FROM roster WHERE active=true${programId?` AND program_id=$1`:''}`, programId?[programId]:[]))?.c || 0);
    const safetyFlags = parseInt((await queryOne(`SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE safety_flag='Yes'${pf}`, programId?[programId]:[]))?.c || 0);
    const faspOver    = parseInt((await queryOne(`SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE fasp_status='Overdue'${pf}`, programId?[programId]:[]))?.c || 0);
    const totalChildren = parseInt((await queryOne(`SELECT COUNT(*) as c FROM children WHERE active=true${programId?` AND program_id=$1`:''}`, programId?[programId]:[]))?.c || 0);

    const scoresQ = programId
      ? `SELECT ROUND(AVG(CASE WHEN week_ending=$1 THEN weekly_score END))::int as weekly, ROUND(AVG(monthly_score))::int as monthly, ROUND(AVG(quarterly_score))::int as quarterly, ROUND(AVG(lifetime_score))::int as lifetime FROM entries WHERE program_id=$2`
      : `SELECT ROUND(AVG(CASE WHEN week_ending=$1 THEN weekly_score END))::int as weekly, ROUND(AVG(monthly_score))::int as monthly, ROUND(AVG(quarterly_score))::int as quarterly, ROUND(AVG(lifetime_score))::int as lifetime FROM entries`;
    const scores = await queryOne(scoresQ, programId ? [we, programId] : [we]) || {};

    const byPlannerQ = programId
      ? `SELECT case_planner, ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms, ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls, COUNT(*) as entries FROM entries WHERE case_planner IS NOT NULL AND program_id=$1 GROUP BY case_planner ORDER BY case_planner`
      : `SELECT case_planner, ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms, ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls, COUNT(*) as entries FROM entries WHERE case_planner IS NOT NULL GROUP BY case_planner ORDER BY case_planner`;
    const byPlanner = await query(byPlannerQ, programId ? [programId] : []);

    const caseScores = await this.getLatestPerCase(programId);
    const trend      = await this.getWeeklyTrend(programId);
    const programs   = programId ? null : await this.getProgramScores();

    // Children not seen this week
    const notSeenThisWeek = await this.getChildrenNotSeenThisWeek(programId, we);
    const notSeenCount    = notSeenThisWeek.length;

    // Monthly compliance — current month
    const now = new Date();
    const monthlyCompliance = await this.getChildrenSeenCompliance(programId, now.getMonth()+1, now.getFullYear());
    const nonCompliantMonthly = monthlyCompliance.filter(c => c.compliance_status === 'Non-compliant').length;

    return {
      totalCases, safetyFlags, faspOver, totalChildren,
      notSeenCount, nonCompliantMonthly,
      scores, byPlanner, caseScores, trend, programs,
      notSeenThisWeek: notSeenThisWeek.slice(0, 20), // preview for dashboard
    };
  },

  // ── SUPERVISION LOG ───────────────────────────────────────
  async getSupervisionLog(filters = {}) {
    let sql = 'SELECT * FROM supervision_log WHERE 1=1';
    const params = [];
    if (filters.programId) { sql += ` AND program_id=$${params.push(filters.programId)}`; }
    if (filters.staffName) { sql += ` AND staff_name=$${params.push(filters.staffName)}`; }
    if (filters.caseId)    { sql += ` AND case_id=$${params.push(filters.caseId)}`; }
    sql += ' ORDER BY staff_name, created_at DESC';
    return query(sql, params);
  },
  async addSupervisionNote(data, authorId, authorName, authorRole) {
    await query(
      `INSERT INTO supervision_log (program_id,case_id,staff_name,author_id,author_name,author_role,domain,content,action_item,due_date,status,entry_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [data.program_id, data.case_id, data.staff_name, authorId, authorName, authorRole,
       data.domain, data.content, data.action_item||null, data.due_date||null,
       data.status||'Open', data.entry_type||'note']
    );
  },
  async resolveSupervisionNote(id) {
    await query("UPDATE supervision_log SET resolved=true,status='Resolved',resolved_at=NOW() WHERE id=$1", [id]);
  },

  // ── STAFF ─────────────────────────────────────────────────
  async getStaff(programId) {
    const users = await query("SELECT id,name,initials,email,role FROM users WHERE program_id=$1 AND role='staff' AND active=true", [programId]);
    return Promise.all(users.map(async u => {
      const scores = await queryOne(`SELECT ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms, ROUND(AVG(quarterly_score))::int as qs, COUNT(*) as entries FROM entries WHERE case_planner=$1 AND program_id=$2`, [u.name, programId]) || {};
      const cases  = parseInt((await queryOne('SELECT COUNT(*) as c FROM roster WHERE planner_name=$1 AND program_id=$2 AND active=true', [u.name, programId]))?.c || 0);
      return { ...u, ...scores, cases };
    }));
  },

  // ── AUDIT LOG ─────────────────────────────────────────────
  async logAction(userId, userName, action, entityType, entityId, detail) {
    await query('INSERT INTO audit_log (user_id,user_name,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, userName, action, entityType, entityId, detail]);
  },

  // ── CSV EXPORT ────────────────────────────────────────────
  async entriesToCSV(entries, mode = 'full') {
    const esc = v => { const s=String(v??''); return s.includes(',')||s.includes('"')||s.includes('\n')?'"'+s.replace(/"/g,'""')+'"':s; };
    if (mode === 'summary') {
      const cols = ['case_id','program_id','week_ending','case_planner','submitted_name','weekly_score','monthly_score','quarterly_score','lifetime_score','safety_flag','fasp_status','reviewed','created_at'];
      return [cols.join(','), ...entries.map(e=>cols.map(c=>esc(e[c])).join(','))].join('\r\n');
    }
    const IDS = ['W1','W2','W3','W4','W5','W6','W9','W10','W11','W12','M1','M2','M3','M4','M5','M6','Q1','Q2','Q3','Q4','Q5','Q6','Q7','Q8','Q9','Q10','Q11','Q12','Q13','Q14','Q16','Q17'];
    const base = ['record_id','program_id','case_id','week_ending','case_planner','submitted_name','submitted_role','children_count'];
    const header = [...base,...IDS.flatMap(id=>[`${id}_Response`,`${id}_Notes`]),'Weekly_Score','Monthly_Score','Quarterly_Score','Lifetime_Score','Safety_Flag','FASP_Status','Reviewed'].join(',');
    const rows = entries.map(e => {
      const rmap={};(e.responses||[]).forEach(r=>{rmap[r.id+'_r']=r.response||'';rmap[r.id+'_n']=r.notes||'';});
      return [...base.map(c=>esc(e[c])),...IDS.flatMap(id=>[esc(rmap[id+'_r']),esc(rmap[id+'_n'])]),esc(e.weekly_score!=null?e.weekly_score+'%':''),esc(e.monthly_score!=null?e.monthly_score+'%':''),esc(e.quarterly_score!=null?e.quarterly_score+'%':''),esc(e.lifetime_score!=null?e.lifetime_score+'%':''),esc(e.safety_flag),esc(e.fasp_status),esc(e.reviewed?'Yes':'No')].join(',');
    });
    return [header,...rows].join('\r\n');
  },

  async childrenToCSV(data) {
    const esc = v => { const s=String(v??''); return s.includes(',')||s.includes('"')||s.includes('\n')?'"'+s.replace(/"/g,'""')+'"':s; };
    const cols = ['program_id','case_id','case_name','planner_name','child_name','cin','dob','times_seen','last_seen','compliance_status'];
    return [cols.join(','), ...data.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\r\n');
  },
};
