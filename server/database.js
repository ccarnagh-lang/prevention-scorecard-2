/**
 * server/database.js — PostgreSQL data layer
 * Supports multi-program users and manual case reassignment
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

// Build program filter SQL for multi-program support
function programFilter(programId, programIds, alias = '') {
  const col = alias ? `${alias}.program_id` : 'program_id';
  if (programIds && programIds.length > 0) {
    return { sql: ` AND ${col} = ANY($__PID__)`, params: [programIds] };
  }
  if (programId) {
    return { sql: ` AND ${col} = $__PID__`, params: [programId] };
  }
  return { sql: '', params: [] };
}

// Add program filter to a query with existing params
function addProgramFilter(baseSql, baseParams, programId, programIds, alias = '') {
  const col = alias ? `${alias}.program_id` : 'program_id';
  const params = [...baseParams];
  let sql = baseSql;
  if (programIds && programIds.length > 0) {
    sql += ` AND ${col} = ANY($${params.push(programIds)})`;
  } else if (programId) {
    sql += ` AND ${col} = $${params.push(programId)}`;
  }
  return { sql, params };
}

function calcAllScores(responses, childrenSeenThisMonth = null, childrenSeenAllMonths = null) {
  // childrenSeenThisMonth: bool — were all active children seen >= 1x this month?
  // childrenSeenAllMonths: bool — have all children been seen every month for life of case?

  const score = cadence => {
    const items = responses.filter(r =>
      !r.unscored &&
      (cadence === 'all' || r.cadence === cadence) &&
      r.response && !['Not applicable','N/A',''].includes(r.response)
    );
    if (!items.length) return null;
    return Math.round(items.filter(r => r.response === 'Yes').length / items.length * 100);
  };

  const ws = score('weekly');
  const ms = score('monthly');

  // Quarterly: standard score, BUT cap at 99 if children not seen all 3 months
  const qsRaw = score('quarterly');
  let qs = qsRaw;
  if (qsRaw === 100 && childrenSeenAllMonths === false) {
    qs = 99; // Not truly 100 — children compliance failed
  }

  // Lifetime: average of weekly/monthly/quarterly, further penalized if
  // children have not been seen every month since case opened
  const valid = [ws, ms, qs].filter(s => s != null);
  let ls = valid.length ? Math.round(valid.reduce((a,b) => a+b, 0) / valid.length) : null;
  if (ls !== null && childrenSeenAllMonths === false) {
    // Cap lifetime at 95 if children compliance has ever failed
    ls = Math.min(ls, 95);
  }

  const w9  = responses.find(r => r.id === 'W9');
  const w10 = responses.find(r => r.id === 'W10');
  const sf  = w9?.response === 'Yes' && (w10?.response === 'No' || w10?.response === 'Some but not all') ? 'Yes' : 'No';
  const q1  = responses.find(r => r.id === 'Q1');
  const fasp = q1?.response === 'Yes' ? 'Current' : q1?.response === 'No' ? 'Overdue' : 'Pending';
  return { ws, ms, qs, ls, sf, fasp };
}

// Check if all children in a case have been seen >= 1x per month
// for every month from case open date through current month
async function checkChildrenLifetimeCompliance(caseId, weekEnding) {
  try {
    // Get case open date
    const roster = await queryOne('SELECT open_date, added_date FROM roster WHERE case_id=$1', [caseId]);
    const startDate = roster?.open_date || roster?.added_date;
    if (!startDate) return null; // Unknown — don't penalize

    const start   = new Date(startDate);
    const current = weekEnding ? new Date(weekEnding) : new Date();

    // Build list of months from start to current
    const months = [];
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(current.getFullYear(), current.getMonth(), 1);
    while (d <= endMonth) {
      months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
      d.setMonth(d.getMonth() + 1);
    }

    if (months.length === 0) return null;

    // For each month, check if ALL active children were seen >= 1x
    for (const month of months) {
      const result = await queryOne(`
        SELECT COUNT(*) as total,
               COUNT(CASE WHEN seen_count >= 1 THEN 1 END) as compliant
        FROM (
          SELECT c.cin,
                 COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END) as seen_count
          FROM children c
          LEFT JOIN entries e ON e.case_id = $1 AND e.week_ending LIKE $2
          LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.children_seen,'[]')) cs
            ON cs->>'cin' = c.cin
          WHERE c.case_id = $1 AND c.active = true
          GROUP BY c.cin
        ) sub`,
        [caseId, month + '%']
      );
      const total     = parseInt(result?.total || 0);
      const compliant = parseInt(result?.compliant || 0);
      if (total > 0 && compliant < total) return false; // At least one month failed
    }
    return true; // All months compliant
  } catch(e) {
    console.warn('[compliance check]', e.message);
    return null;
  }
}

// Check if children were seen >= 1x this month
async function checkChildrenMonthlyCompliance(caseId, weekEnding) {
  try {
    const month = weekEnding ? weekEnding.slice(0,7) : new Date().toISOString().slice(0,7);
    const result = await queryOne(`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN seen_count >= 1 THEN 1 END) as compliant
      FROM (
        SELECT c.cin,
               COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END) as seen_count
        FROM children c
        LEFT JOIN entries e ON e.case_id = $1 AND e.week_ending LIKE $2
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.children_seen,'[]')) cs
          ON cs->>'cin' = c.cin
        WHERE c.case_id = $1 AND c.active = true
        GROUP BY c.cin
      ) sub`,
      [caseId, month + '%']
    );
    const total     = parseInt(result?.total || 0);
    const compliant = parseInt(result?.compliant || 0);
    if (total === 0) return null; // No children — don't penalize
    return compliant >= total;
  } catch(e) {
    return null;
  }
}

// Get all case planner names visible to a director via reporting chain
// director -> their supervisors -> staff under those supervisors -> planner names on cases
async function getPlannerNamesForDirector(directorId) {
  // Get supervisors who report to this director
  const supervisors = await query(
    `SELECT id, name FROM users WHERE director_id=$1 AND active=true AND role='supervisor'`,
    [directorId]
  );
  if (!supervisors.length) return { plannerNames: [], supervisorNames: [] };

  const supervisorNames = supervisors.map(s => s.name);
  const supervisorIds   = supervisors.map(s => s.id);

  // Get staff who report to any of those supervisors
  const staff = await query(
    `SELECT name FROM users WHERE supervisor_id = ANY($1) AND active=true`,
    [supervisorIds]
  );
  const staffNames = staff.map(s => s.name);

  // Director can see cases where planner is a supervisor or staff under them
  const plannerNames = [...supervisorNames, ...staffNames];
  return { plannerNames, supervisorNames, staffNames };
}

async function importRosterCSV(csvText, uploadedBy) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) throw new Error('CSV file appears empty');

  const firstLine = lines[0];
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const headers = firstLine.split(delim).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().trim());

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
      'conn_case_id':    ['conn case id', 'cnnx case id', 'conn_case_id'],
      'wms_case_id':     ['wms case id', 'wms_case_id'],
      'case_name':       ['case name'],
      'cid':             ['cid'],
      'stage_id':        ['stage id'],
      'stage_type':      ['stage type'],
      'stage_start':     ['stage start'],
      'agency':          ['agency'],
      'worker_name':     ['worker name'],
      'role':            ['role'],
      'site_unit':       ['site-unit', 'site unit', 'site_unit'],
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
    if (idx === -1 || idx >= row.length) return '';
    return (row[idx] || '').trim().replace(/^"|"$/g, '').trim();
  };

  const rows = lines.slice(1).map(line => line.split(delim)).filter(r => r.length > 3);

  const caseMap = {};
  for (const row of rows) {
    const caseId = get(row, 'conn_case_id');
    if (!caseId || caseId === '') continue;
    const siteUnit = get(row, 'site_unit');
    if (!caseMap[caseId]) {
      caseMap[caseId] = {
        case_id: caseId, program_id: siteUnit,
        wms_case_id: get(row, 'wms_case_id'), case_name: get(row, 'case_name'),
        planner_name: get(row, 'worker_name'), agency: get(row, 'agency'),
        open_date: get(row, 'stage_start'), children: [],
      };
    }
    const cin = get(row, 'cin');
    if (cin && cin !== '') {
      caseMap[caseId].children.push({
        case_id: caseId, child_name: get(row, 'child_name'), child_pid: get(row, 'child_pid'),
        cin, gender: get(row, 'gender'), dob: get(row, 'dob'),
        racial_identity: get(row, 'racial_identity'), ethnicity: get(row, 'ethnicity'),
        ppg: get(row, 'ppg'), wms_case_id: get(row, 'wms_case_id'),
        case_name: get(row, 'case_name'), cid: get(row, 'cid'),
        stage_id: get(row, 'stage_id'), stage_type: get(row, 'stage_type'),
        stage_start: get(row, 'stage_start'), agency: get(row, 'agency'),
        worker_name: get(row, 'worker_name'), worker_role: get(row, 'role'),
        site_unit: siteUnit, program_id: siteUnit, added_date: today,
      });
    }
  }

  const uploadedCaseIds = Object.keys(caseMap);
  if (uploadedCaseIds.length === 0) {
    throw new Error(`No valid cases found. Make sure file is CSV not Excel. Headers: ${headers.slice(0,5).join(', ')}`);
  }

  let stats = { cases_added:0, cases_updated:0, cases_ended:0, children_added:0, children_updated:0, children_ended:0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // End-date active cases NOT in this upload (skip manually assigned)
    const activeResult = await client.query(
      "SELECT case_id FROM roster WHERE active=true AND last_seen_upload IS NOT NULL AND manually_assigned=false"
    );
    for (const { case_id } of activeResult.rows) {
      if (!uploadedCaseIds.includes(case_id)) {
        await client.query('UPDATE roster SET active=false, end_date=$1 WHERE case_id=$2', [today, case_id]);
        await client.query('UPDATE children SET active=false, end_date=$1 WHERE case_id=$2', [today, case_id]);
        stats.cases_ended++;
      }
    }

    for (const c of Object.values(caseMap)) {
      if (!c.case_id) continue;
      const existing = await client.query('SELECT case_id, manually_assigned FROM roster WHERE case_id=$1', [c.case_id]);
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO roster (case_id,program_id,planner_name,wms_case_id,case_name,agency,open_date,active,last_seen_upload,children_count,manually_assigned)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,false)`,
          [c.case_id, c.program_id||'', c.planner_name||'', c.wms_case_id||'', c.case_name||'', c.agency||'', c.open_date||'', today, c.children.length]
        );
        stats.cases_added++;
      } else {
        const isManual = existing.rows[0].manually_assigned;
        if (isManual) {
          // Only update status and timestamps — preserve manual assignment
          await client.query(
            'UPDATE roster SET active=true, end_date=NULL, last_seen_upload=$1, children_count=$2 WHERE case_id=$3',
            [today, c.children.length, c.case_id]
          );
        } else {
          await client.query(
            `UPDATE roster SET program_id=$1, planner_name=$2, wms_case_id=$3, case_name=$4,
             agency=$5, active=true, end_date=NULL, last_seen_upload=$6, children_count=$7 WHERE case_id=$8`,
            [c.program_id||'', c.planner_name||'', c.wms_case_id||'', c.case_name||'', c.agency||'', today, c.children.length, c.case_id]
          );
        }
        stats.cases_updated++;
      }

      const uploadedCINs = c.children.map(ch => ch.cin).filter(Boolean);
      if (uploadedCINs.length > 0) {
        await client.query(
          `UPDATE children SET active=false, end_date=$1
           WHERE case_id=$2 AND active=true AND cin NOT IN (${uploadedCINs.map((_,i)=>'$'+(i+3)).join(',')})`,
          [today, c.case_id, ...uploadedCINs]
        );
      }

      for (const ch of c.children) {
        if (!ch.cin || !ch.case_id) continue;
        const existingChild = await client.query('SELECT id FROM children WHERE case_id=$1 AND cin=$2', [ch.case_id, ch.cin]);
        if (existingChild.rows.length === 0) {
          await client.query(
            `INSERT INTO children (case_id,program_id,child_name,child_pid,cin,gender,dob,racial_identity,ethnicity,ppg,wms_case_id,case_name,cid,stage_id,stage_type,stage_start,agency,worker_name,worker_role,site_unit,active,added_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,true,$21)`,
            [ch.case_id, ch.program_id||'', ch.child_name||'', ch.child_pid||'', ch.cin,
             ch.gender||'', ch.dob||'', ch.racial_identity||'', ch.ethnicity||'', ch.ppg||'',
             ch.wms_case_id||'', ch.case_name||'', ch.cid||'', ch.stage_id||'', ch.stage_type||'',
             ch.stage_start||'', ch.agency||'', ch.worker_name||'', ch.worker_role||'', ch.site_unit||'', today]
          );
          stats.children_added++;
        } else {
          await client.query(
            `UPDATE children SET child_name=$1, gender=$2, dob=$3, worker_name=$4,
             worker_role=$5, program_id=$6, active=true, end_date=NULL WHERE case_id=$7 AND cin=$8`,
            [ch.child_name||'', ch.gender||'', ch.dob||'', ch.worker_name||'', ch.worker_role||'', ch.program_id||'', ch.case_id, ch.cin]
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

  async getUserByEmail(email) {
    return queryOne('SELECT * FROM users WHERE email=$1 AND active=true', [email]);
  },
  async updateLastLogin(userId) {
    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [userId]);
  },

  async getAllUsers() {
    return query('SELECT id,email,name,initials,role,program_id,supervisor_id,director_id,title,active,created_at,last_login FROM users ORDER BY role,name');
  },
  async createUser(data) {
    const hash = bcrypt.hashSync(data.password, 10);
    const initials = (data.initials || data.name.split(' ').map(p=>p[0]).join('').slice(0,2)).toUpperCase();
    return queryOne(
      'INSERT INTO users (email,password,name,initials,role,program_id,supervisor_id,director_id,title) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [data.email.toLowerCase().trim(), hash, data.name, initials, data.role,
       data.program_id || null, data.supervisor_id || null, data.director_id || null, data.title || null]
    );
  },
  async updateUser(id, data) {
    await query('UPDATE users SET name=$1,role=$2,program_id=$3,active=$4,supervisor_id=$5,director_id=$6,title=$7 WHERE id=$8',
      [data.name, data.role, data.program_id || null, data.active !== false,
       data.supervisor_id || null, data.director_id || null, data.title || null, id]);
  },
  async resetPassword(id, newPassword) {
    const hash = bcrypt.hashSync(newPassword, 10);
    await query('UPDATE users SET password=$1 WHERE id=$2', [hash, id]);
  },
  async deactivateUser(id) {
    await query('UPDATE users SET active=false WHERE id=$1', [id]);
  },

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
      const scores   = await queryOne(`SELECT ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms, ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls FROM entries WHERE program_id=$1`, [p.id]) || {};
      const cases    = parseInt((await queryOne('SELECT COUNT(*) as c FROM roster WHERE program_id=$1 AND active=true', [p.id]))?.c || 0);
      const flags    = parseInt((await queryOne("SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE program_id=$1 AND safety_flag='Yes'", [p.id]))?.c || 0);
      const fasp     = parseInt((await queryOne("SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE program_id=$1 AND fasp_status='Overdue'", [p.id]))?.c || 0);
      const children = parseInt((await queryOne('SELECT COUNT(*) as c FROM children WHERE program_id=$1 AND active=true', [p.id]))?.c || 0);
      return { ...p, cases, ...scores, flags, fasp, children };
    }));
  },
  async getWeeklyTrend(programId, programIds, dateFrom, dateTo, plannerNames = null) {
    let sql = 'SELECT week_ending, ROUND(AVG(weekly_score))::int as score FROM entries WHERE weekly_score IS NOT NULL';
    const params = [];
    if (plannerNames && plannerNames.length > 0) { sql += ` AND case_planner = ANY($${params.push(plannerNames)})`; }
    else if (programIds && programIds.length > 0) { sql += ` AND program_id = ANY($${params.push(programIds)})`; }
    else if (programId) { sql += ` AND program_id = $${params.push(programId)}`; }
    if (dateFrom) { sql += ` AND week_ending >= $${params.push(dateFrom)}`; }
    if (dateTo)   { sql += ` AND week_ending <= $${params.push(dateTo)}`; }
    sql += ' GROUP BY week_ending ORDER BY week_ending DESC LIMIT 52';
    const rows = await query(sql, params);
    return rows.reverse();
  },

  async getRoster(programId, programIds, activeOnly = true, plannerNames = null) {
    let sql = 'SELECT * FROM roster WHERE 1=1';
    const params = [];
    if (plannerNames && plannerNames.length > 0) {
      // Director scope: show cases where planner is in their reporting chain
      sql += ` AND planner_name = ANY($${params.push(plannerNames)})`;
    } else if (programIds && programIds.length > 0) {
      sql += ` AND program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      sql += ` AND program_id = $${params.push(programId)}`;
    }
    if (activeOnly) sql += ' AND active=true';
    sql += ' ORDER BY case_id';
    return query(sql, params);
  },
  async addCase(data) {
    await query(
      `INSERT INTO roster (case_id,household_id,program_id,planner_name,supervisor_name,open_date,children_count,modality,notes,manually_assigned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) ON CONFLICT (case_id) DO NOTHING`,
      [data.case_id, data.household_id||'', data.program_id, data.planner_name||'',
       data.supervisor_name||'', data.open_date||'', data.children_count||1, data.modality||'', data.notes||'']
    );
  },
  async updateCase(caseId, data) {
    await query(
      'UPDATE roster SET planner_name=$1,supervisor_name=$2,children_count=$3,active=$4,notes=$5 WHERE case_id=$6',
      [data.planner_name, data.supervisor_name, data.children_count, data.active!==false, data.notes||'', caseId]
    );
  },
  async reassignCase(caseId, data, user) {
    await query(
      `UPDATE roster SET planner_name=$1, program_id=$2, supervisor_name=$3,
       manually_assigned=true, notes=COALESCE(notes,'')||$4 WHERE case_id=$5`,
      [data.planner_name, data.program_id, data.supervisor_name||'',
       ` [Manually reassigned by ${user.name} on ${new Date().toISOString().slice(0,10)}]`,
       caseId]
    );
    // Also update children to new program
    await query('UPDATE children SET program_id=$1 WHERE case_id=$2', [data.program_id, caseId]);
  },

  async getChildrenForCase(caseId) {
    return query('SELECT * FROM children WHERE case_id=$1 AND active=true ORDER BY child_name', [caseId]);
  },
  async getAllActiveChildren(programId, programIds) {
    let sql = 'SELECT c.*, r.planner_name, r.case_name FROM children c JOIN roster r ON c.case_id=r.case_id WHERE c.active=true AND r.active=true';
    const params = [];
    if (programIds && programIds.length > 0) {
      sql += ` AND c.program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      sql += ` AND c.program_id = $${params.push(programId)}`;
    }
    sql += ' ORDER BY c.program_id, c.case_id, c.child_name';
    return query(sql, params);
  },
  importRosterCSV,

  async getChildrenSeenCompliance(programId, programIds, month, year) {
    const monthStr = `${year}-${String(month).padStart(2,'0')}`;
    let sql = `
      SELECT c.cin, c.child_name, c.dob, c.case_id, c.program_id,
        r.planner_name, r.case_name,
        COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END)::int as times_seen,
        MAX(CASE WHEN cs->>'seen' = 'Yes' THEN e.week_ending END) as last_seen,
        CASE WHEN COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END) >= 1 THEN 'Compliant' ELSE 'Non-compliant' END as compliance_status
      FROM children c
      JOIN roster r ON c.case_id = r.case_id
      LEFT JOIN entries e ON e.case_id = c.case_id AND e.week_ending LIKE $1
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.children_seen,'[]')) cs ON cs->>'cin' = c.cin
      WHERE c.active = true AND r.active = true`;
    const params = [monthStr + '%'];
    if (programIds && programIds.length > 0) {
      sql += ` AND c.program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      sql += ` AND c.program_id = $${params.push(programId)}`;
    }
    sql += ' GROUP BY c.cin, c.child_name, c.dob, c.case_id, c.program_id, r.planner_name, r.case_name ORDER BY compliance_status, c.program_id, c.case_id, c.child_name';
    return query(sql, params);
  },

  async getChildrenNotSeenThisWeek(programId, programIds, weekEnding) {
    // Delegates to monthly — "not seen this month" is the compliance standard
    const d = weekEnding ? new Date(weekEnding) : new Date();
    return this.getChildrenNotSeenThisMonth(programId, programIds, d.getMonth()+1, d.getFullYear());
  },

  async getChildrenNotSeenThisMonth(programId, programIds, month, year) {
    const monthStr = `${year}-${String(month).padStart(2,'0')}`;
    let sql = `
      SELECT c.cin, c.child_name, c.dob, c.case_id, c.program_id,
        r.planner_name, r.case_name,
        COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END)::int as times_seen,
        MAX(CASE WHEN cs->>'seen' = 'Yes' THEN e.week_ending END) as last_seen,
        COALESCE(string_agg(DISTINCT CASE WHEN cs->>'seen' != 'Yes' AND cs->>'reason_not_seen' IS NOT NULL THEN cs->>'reason_not_seen' END, '; '),'') as reason_not_seen
      FROM children c
      JOIN roster r ON c.case_id = r.case_id
      LEFT JOIN entries e ON e.case_id = c.case_id AND e.week_ending LIKE $1
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.children_seen,'[]')) cs ON cs->>'cin' = c.cin
      WHERE c.active = true AND r.active = true`;
    const params = [monthStr + '%'];
    if (programIds && programIds.length > 0) {
      sql += ` AND c.program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      sql += ` AND c.program_id = $${params.push(programId)}`;
    }
    sql += `
      GROUP BY c.cin, c.child_name, c.dob, c.case_id, c.program_id, r.planner_name, r.case_name
      HAVING COUNT(CASE WHEN cs->>'seen' = 'Yes' THEN 1 END) = 0
      ORDER BY c.program_id, c.case_id, c.child_name`;
    return query(sql, params);
  },

  async saveEntry(entry, userId, userName, userRole) {
    const responses    = entry.responses    || [];
    const childrenSeen = entry.children_seen || [];
    // Check children compliance for scoring
    const [seenThisMonth, seenAllMonths] = await Promise.all([
      checkChildrenMonthlyCompliance(entry.case_id, entry.week_ending),
      checkChildrenLifetimeCompliance(entry.case_id, entry.week_ending),
    ]);
    const { ws, ms, qs, ls, sf, fasp } = calcAllScores(responses, seenThisMonth, seenAllMonths);
    const recordId = 'LOG-' + uuidv4().slice(0,8).toUpperCase();
    await query(
      `INSERT INTO entries (record_id,case_id,program_id,week_ending,submitted_by,submitted_name,submitted_role,case_planner,household_id,children_count,submission_notes,responses,children_seen,weekly_score,monthly_score,quarterly_score,lifetime_score,safety_flag,fasp_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [recordId, entry.case_id, entry.program_id, entry.week_ending, userId, userName, userRole,
       entry.case_planner, entry.household_id||'', entry.children_count||0, entry.submission_notes||'',
       JSON.stringify(responses), JSON.stringify(childrenSeen), ws, ms, qs, ls, sf, fasp]
    );
  },
  async updateEntry(id, entry, userId) {
    const responses    = entry.responses    || [];
    const childrenSeen = entry.children_seen || [];
    const [seenThisMonth, seenAllMonths] = await Promise.all([
      checkChildrenMonthlyCompliance(entry.case_id, entry.week_ending),
      checkChildrenLifetimeCompliance(entry.case_id, entry.week_ending),
    ]);
    const { ws, ms, qs, ls, sf, fasp } = calcAllScores(responses, seenThisMonth, seenAllMonths);
    await query(
      `UPDATE entries SET responses=$1,children_seen=$2,weekly_score=$3,monthly_score=$4,quarterly_score=$5,lifetime_score=$6,safety_flag=$7,fasp_status=$8,case_planner=$9,children_count=$10,submission_notes=$11,last_edited_by=$12,last_edited_at=NOW() WHERE id=$13 AND reviewed=false`,
      [JSON.stringify(responses), JSON.stringify(childrenSeen), ws, ms, qs, ls, sf, fasp,
       entry.case_planner, entry.children_count||0, entry.submission_notes||'', userId, id]
    );
  },
  async reviewEntry(id, reviewerId) {
    await query('UPDATE entries SET reviewed=true,reviewed_by=$1,reviewed_at=NOW() WHERE id=$2', [reviewerId, id]);
  },
  async getEntries({ caseId, programId, programIds, weekEnding, planner, dateFrom, dateTo, limit=500 }) {
    let sql = 'SELECT * FROM entries WHERE 1=1';
    const params = [];
    if (caseId)     { sql += ` AND case_id=$${params.push(caseId)}`; }
    if (programIds && programIds.length > 0) { sql += ` AND program_id = ANY($${params.push(programIds)})`; }
    else if (programId) { sql += ` AND program_id=$${params.push(programId)}`; }
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
  async getLatestPerCase(programId, programIds, dateFrom, dateTo, plannerNames = null) {
    const params = [];
    let innerWhere = ' WHERE 1=1';
    if (plannerNames && plannerNames.length > 0) {
      innerWhere += ` AND case_planner = ANY($${params.push(plannerNames)})`;
    } else if (programIds && programIds.length > 0) {
      innerWhere += ` AND program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      innerWhere += ` AND program_id = $${params.push(programId)}`;
    }
    if (dateFrom) { innerWhere += ` AND week_ending >= $${params.push(dateFrom)}`; }
    if (dateTo)   { innerWhere += ` AND week_ending <= $${params.push(dateTo)}`; }
    const outerParams = [...params];
    let outerWhere = '';
    if (plannerNames && plannerNames.length > 0) {
      outerWhere = ` AND e.case_planner = ANY($${outerParams.push(plannerNames)})`;
    } else if (programIds && programIds.length > 0) {
      outerWhere = ` AND e.program_id = ANY($${outerParams.push(programIds)})`;
    } else if (programId) {
      outerWhere = ` AND e.program_id = $${outerParams.push(programId)}`;
    }
    const sql = `SELECT e.* FROM entries e JOIN (SELECT case_id, MAX(id) as mid FROM entries${innerWhere} GROUP BY case_id) m ON e.id=m.mid${outerWhere} ORDER BY e.case_id`;
    const rows = await query(sql, outerParams);
    return rows.map(e => ({
      ...e,
      responses:     Array.isArray(e.responses)     ? e.responses     : JSON.parse(e.responses     || '[]'),
      children_seen: Array.isArray(e.children_seen) ? e.children_seen : JSON.parse(e.children_seen || '[]'),
    }));
  },

  async getDashboard(programId, programIds, weekEnding, dateFrom, dateTo, plannerNames = null) {
    const we   = weekEnding || new Date().toISOString().slice(0,10);
    const pids = programIds && programIds.length > 0 ? programIds : (programId ? [programId] : null);
    const usePlanners = plannerNames && plannerNames.length > 0;

    // Build date range filter for entries
    const dateFilter = (paramOffset) => {
      let sql = ''; const p = [];
      if (dateFrom) sql += ` AND week_ending >= $${paramOffset + p.push(dateFrom)}`;
      if (dateTo)   sql += ` AND week_ending <= $${paramOffset + p.push(dateTo)}`;
      return { sql, params: p };
    };

    const countQ = (table, extra='') => {
      if (pids) return queryOne(`SELECT COUNT(*) as c FROM ${table} WHERE active=true AND program_id = ANY($1)${extra}`, [pids]);
      return queryOne(`SELECT COUNT(*) as c FROM ${table} WHERE active=true${extra}`);
    };

    const totalCases    = parseInt((await countQ('roster'))?.c || 0);
    const totalChildren = parseInt((await countQ('children'))?.c || 0);

    // Safety flags and FASP filtered by date range
    const buildEntryFilter = (field, pids, dateFrom, dateTo) => {
      const params = [];
      let sql = `SELECT COUNT(DISTINCT case_id) as c FROM entries WHERE ${field}`;
      if (pids)     sql += ` AND program_id = ANY($${params.push(pids)})`;
      if (dateFrom) sql += ` AND week_ending >= $${params.push(dateFrom)}`;
      if (dateTo)   sql += ` AND week_ending <= $${params.push(dateTo)}`;
      return queryOne(sql, params);
    };
    const safetyFlags = parseInt((await buildEntryFilter("safety_flag='Yes'", pids, dateFrom, dateTo))?.c || 0);
    const faspOver    = parseInt((await buildEntryFilter("fasp_status='Overdue'", pids, dateFrom, dateTo))?.c || 0);

    // Scores filtered by date range
    const buildScoreQuery = (pids, we, dateFrom, dateTo) => {
      const params = [we];
      let sql = `SELECT
        ROUND(AVG(CASE WHEN week_ending=$1 THEN weekly_score END))::int as weekly,
        ROUND(AVG(weekly_score))::int as weekly_avg,
        ROUND(AVG(monthly_score))::int as monthly,
        ROUND(AVG(quarterly_score))::int as quarterly,
        ROUND(AVG(lifetime_score))::int as lifetime
        FROM entries WHERE 1=1`;
      if (pids)     sql += ` AND program_id = ANY($${params.push(pids)})`;
      if (dateFrom) sql += ` AND week_ending >= $${params.push(dateFrom)}`;
      if (dateTo)   sql += ` AND week_ending <= $${params.push(dateTo)}`;
      return queryOne(sql, params);
    };
    const scoresRow = await buildScoreQuery(pids, we, dateFrom, dateTo) || {};

    // By planner filtered by date range
    const buildPlannerQuery = (pids, dateFrom, dateTo) => {
      const params = [];
      let sql = `SELECT case_planner,
        ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
        ROUND(AVG(quarterly_score))::int as qs, ROUND(AVG(lifetime_score))::int as ls,
        COUNT(*) as entries
        FROM entries WHERE case_planner IS NOT NULL`;
      if (pids)     sql += ` AND program_id = ANY($${params.push(pids)})`;
      if (dateFrom) sql += ` AND week_ending >= $${params.push(dateFrom)}`;
      if (dateTo)   sql += ` AND week_ending <= $${params.push(dateTo)}`;
      sql += ' GROUP BY case_planner ORDER BY case_planner';
      return query(sql, params);
    };
    const byPlanner = await buildPlannerQuery(pids, dateFrom, dateTo);

    // Case scores — latest entry per case filtered by date range
    const caseScores  = await this.getLatestPerCase(programId, programIds, dateFrom, dateTo);
    const trend       = await this.getWeeklyTrend(programId, programIds, dateFrom, dateTo);
    const programs    = (!programId && !programIds) ? await this.getProgramScores() : null;
    const notSeenThisWeek    = await this.getChildrenNotSeenThisWeek(programId, programIds, we);
    const now                = new Date();
    const monthlyCompliance  = await this.getChildrenSeenCompliance(programId, programIds, now.getMonth()+1, now.getFullYear());
    const nonCompliantMonthly= monthlyCompliance.filter(c => c.compliance_status === 'Non-compliant').length;

    // Date range metadata to send back to frontend
    const dateRange = await queryOne(
      `SELECT MIN(week_ending) as earliest, MAX(week_ending) as latest FROM entries${pids ? ' WHERE program_id = ANY($1)' : ''}`,
      pids ? [pids] : []
    ) || {};

    return {
      totalCases, safetyFlags, faspOver, totalChildren,
      notSeenCount: notSeenThisWeek.length, nonCompliantMonthly,
      scores: scoresRow || {}, byPlanner, caseScores, trend, programs,
      notSeenThisWeek: notSeenThisWeek.slice(0, 20),
      dateRange, dateFrom, dateTo,
    };
  },

  async getSupervisionLog(filters = {}) {
    let sql = 'SELECT * FROM supervision_log WHERE 1=1';
    const params = [];
    if (filters.plannerNames && filters.plannerNames.length > 0) {
      // Director scope: show logs for their supervisors and staff
      sql += ` AND staff_name = ANY($${params.push(filters.plannerNames)})`;
    } else if (filters.programIds && filters.programIds.length > 0) {
      sql += ` AND program_id = ANY($${params.push(filters.programIds)})`;
    } else if (filters.programId) {
      sql += ` AND program_id=$${params.push(filters.programId)}`;
    }
    if (filters.staffName) { sql += ` AND staff_name=$${params.push(filters.staffName)}`; }
    if (filters.caseId)    { sql += ` AND case_id=$${params.push(filters.caseId)}`; }
    sql += ' ORDER BY staff_name, created_at DESC';
    return query(sql, params);
  },
  async addSupervisionNote(data, authorId, authorName, authorRole) {
    await query(
      `INSERT INTO supervision_log (program_id,case_id,staff_name,author_id,author_name,author_role,domain,content,action_item,due_date,status,entry_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [data.program_id, data.case_id||null, data.staff_name, authorId, authorName, authorRole,
       data.domain||'', data.content, data.action_item||null, data.due_date||null, data.status||'Open', data.entry_type||'note']
    );
  },
  async resolveSupervisionNote(id) {
    await query("UPDATE supervision_log SET resolved=true,status='Resolved',resolved_at=NOW() WHERE id=$1", [id]);
  },

  async getStaff(programId, programIds, callerRole, callerId) {
    // Scope direct reports by role:
    // supervisor   → staff where supervisor_id = caller id
    // director     → supervisors where director_id = caller id
    //                + all staff under those supervisors
    // admin/exec   → everyone in program
    const params = [];
    let sql;

    if (callerRole === 'supervisor') {
      // Direct reports: staff assigned to this supervisor
      sql = `SELECT id,name,initials,email,role,program_id,supervisor_id,director_id FROM users
             WHERE role = 'staff' AND active=true AND supervisor_id = $${params.push(callerId)}`;
    } else if (callerRole === 'program_director') {
      // Direct reports: supervisors assigned to this director
      // Plus: can cover for any staff in their program
      sql = `SELECT id,name,initials,email,role,program_id,supervisor_id,director_id FROM users
             WHERE active=true AND (
               (role = 'supervisor' AND director_id = $${params.push(callerId)})
               OR (role = 'staff' AND program_id = ANY(
                 SELECT program_id FROM users WHERE id = $1
               ))
             )`;
    } else {
      // Admin/executive: all non-admin staff in program
      sql = `SELECT id,name,initials,email,role,program_id,supervisor_id,director_id FROM users
             WHERE role IN ('staff','supervisor') AND active=true`;
      if (programIds && programIds.length > 0) {
        sql += ` AND program_id = ANY($${params.push(programIds)})`;
      } else if (programId) {
        sql += ` AND program_id = $${params.push(programId)}`;
      }
    }

    sql += ' ORDER BY role DESC, name';
    const users = await query(sql, params);

    return Promise.all(users.map(async u => {
      const scores = await queryOne(
        `SELECT ROUND(AVG(weekly_score))::int as ws, ROUND(AVG(monthly_score))::int as ms,
                ROUND(AVG(quarterly_score))::int as qs, COUNT(*) as entries
         FROM entries WHERE case_planner=$1 AND program_id=$2`,
        [u.name, u.program_id]
      ) || {};
      const cases = parseInt((await queryOne(
        'SELECT COUNT(*) as c FROM roster WHERE planner_name=$1 AND program_id=$2 AND active=true',
        [u.name, u.program_id]
      ))?.c || 0);
      // Get their supervisor name if they are staff
      let supervisorName = null;
      if (u.supervisor_id) {
        const sup = await queryOne('SELECT name FROM users WHERE id=$1', [u.supervisor_id]);
        supervisorName = sup?.name || null;
      }
      let directorName = null;
      if (u.director_id) {
        const dir = await queryOne('SELECT name FROM users WHERE id=$1', [u.director_id]);
        directorName = dir?.name || null;
      }
      return { ...u, ...scores, cases, supervisorName, directorName };
    }));
  },

  async getPlannerNamesForDirector(directorId) {
    return getPlannerNamesForDirector(directorId);
  },

  async logAction(userId, userName, action, entityType, entityId, detail) {
    await query('INSERT INTO audit_log (user_id,user_name,action,entity_type,entity_id,detail) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, userName, action, entityType, entityId||'', detail||'']);
  },

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

  async getSubmissionStats(programId, programIds, dateFrom, dateTo) {
    // Returns weekly submission counts grouped by week_ending
    // and per-case entry counts
    const params = [];
    let baseFilter = ' WHERE 1=1';
    if (programIds && programIds.length > 0) {
      baseFilter += ` AND program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      baseFilter += ` AND program_id = $${params.push(programId)}`;
    }
    if (dateFrom) { baseFilter += ` AND week_ending >= $${params.push(dateFrom)}`; }
    if (dateTo)   { baseFilter += ` AND week_ending <= $${params.push(dateTo)}`; }

    // Weekly submission counts
    const weeklySubmissions = await query(
      `SELECT week_ending, COUNT(*) as submissions, COUNT(DISTINCT case_id) as unique_cases
       FROM entries${baseFilter}
       GROUP BY week_ending ORDER BY week_ending DESC LIMIT 52`,
      params
    );

    // Per-case entry counts (for case list column)
    const caseEntryCounts = await query(
      `SELECT case_id, COUNT(*) as entry_count,
              MIN(week_ending) as first_entry, MAX(week_ending) as last_entry
       FROM entries${baseFilter}
       GROUP BY case_id`,
      params
    );

    // Total stats
    const totals = await queryOne(
      `SELECT COUNT(*) as total_entries,
              COUNT(DISTINCT case_id) as cases_with_entries,
              COUNT(DISTINCT week_ending) as weeks_covered
       FROM entries${baseFilter}`,
      params
    ) || {};

    return { weeklySubmissions, caseEntryCounts, totals };
  },

  // Check for staff with no supervision log in past 2 weeks
  async getSupervisionComplianceAlerts(programId, programIds) {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const cutoff = twoWeeksAgo.toISOString().slice(0,10);

    let sql = `SELECT id,name,role,program_id,supervisor_id FROM users
               WHERE role IN ('staff','supervisor') AND active=true`;
    const params = [];
    if (programIds && programIds.length > 0) {
      sql += ` AND program_id = ANY($${params.push(programIds)})`;
    } else if (programId) {
      sql += ` AND program_id = $${params.push(programId)}`;
    }
    const staff = await query(sql, params);

    const alerts = [];
    for (const s of staff) {
      // Get their latest supervision log entry
      const latest = await queryOne(
        `SELECT created_at FROM supervision_log
         WHERE staff_name=$1 AND created_at::date >= $2
         ORDER BY created_at DESC LIMIT 1`,
        [s.name, cutoff]
      );
      if (!latest) {
        // No log in past 2 weeks
        const lastEver = await queryOne(
          `SELECT created_at FROM supervision_log WHERE staff_name=$1 ORDER BY created_at DESC LIMIT 1`,
          [s.name]
        );
        alerts.push({
          staff_name:   s.name,
          staff_id:     s.id,
          program_id:   s.program_id,
          last_log:     lastEver?.created_at?.slice(0,10) || null,
          days_overdue: Math.floor((new Date() - new Date(lastEver?.created_at || new Date(0))) / (1000*60*60*24)),
        });
      }
    }
    return alerts;
  },

  async childrenToCSV(data) {
    const esc = v => { const s=String(v??''); return s.includes(',')||s.includes('"')||s.includes('\n')?'"'+s.replace(/"/g,'""')+'"':s; };
    const cols = ['program_id','case_id','case_name','planner_name','child_name','cin','dob','times_seen','last_seen','compliance_status'];
    return [cols.join(','), ...data.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\r\n');
  },
};