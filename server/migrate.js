/**
 * server/migrate.js
 * Creates all tables. Safe to run multiple times.
 * Called automatically on server start.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[db] Running migrations...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        email      TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        name       TEXT NOT NULL,
        initials   TEXT,
        role       TEXT NOT NULL,
        program_id TEXT,
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS programs (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        modality   TEXT,
        borough    TEXT,
        site_code  TEXT,
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS roster (
        case_id          TEXT PRIMARY KEY,
        household_id     TEXT,
        program_id       TEXT NOT NULL,
        planner_name     TEXT,
        supervisor_name  TEXT,
        open_date        TEXT,
        end_date         TEXT,
        children_count   INTEGER DEFAULT 0,
        modality         TEXT,
        active           BOOLEAN DEFAULT true,
        notes            TEXT,
        wms_case_id      TEXT,
        case_name        TEXT,
        agency           TEXT,
        last_seen_upload TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS children (
        id              SERIAL PRIMARY KEY,
        case_id         TEXT NOT NULL,
        program_id      TEXT,
        child_name      TEXT,
        child_pid       TEXT,
        cin             TEXT,
        gender          TEXT,
        dob             TEXT,
        racial_identity TEXT,
        ethnicity       TEXT,
        ppg             TEXT,
        wms_case_id     TEXT,
        case_name       TEXT,
        cid             TEXT,
        stage_id        TEXT,
        stage_type      TEXT,
        stage_start     TEXT,
        agency          TEXT,
        worker_name     TEXT,
        worker_role     TEXT,
        site_unit       TEXT,
        active          BOOLEAN DEFAULT true,
        added_date      TEXT,
        end_date        TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(case_id, cin)
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS children_case_id_idx ON children(case_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS children_program_idx ON children(program_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS children_cin_idx ON children(cin)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id               SERIAL PRIMARY KEY,
        record_id        TEXT UNIQUE NOT NULL,
        case_id          TEXT NOT NULL,
        program_id       TEXT NOT NULL,
        week_ending      TEXT NOT NULL,
        submitted_by     INTEGER,
        submitted_name   TEXT,
        submitted_role   TEXT,
        case_planner     TEXT,
        household_id     TEXT,
        children_count   INTEGER,
        submission_notes TEXT,
        responses        JSONB DEFAULT '[]',
        children_seen    JSONB DEFAULT '[]',
        weekly_score     REAL,
        monthly_score    REAL,
        quarterly_score  REAL,
        lifetime_score   REAL,
        safety_flag      TEXT DEFAULT 'No',
        fasp_status      TEXT DEFAULT 'Pending',
        reviewed         BOOLEAN DEFAULT false,
        reviewed_by      INTEGER,
        reviewed_at      TIMESTAMPTZ,
        last_edited_by   INTEGER,
        last_edited_at   TIMESTAMPTZ,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS supervision_log (
        id          SERIAL PRIMARY KEY,
        program_id  TEXT,
        case_id     TEXT,
        staff_name  TEXT,
        author_id   INTEGER,
        author_name TEXT,
        author_role TEXT,
        domain      TEXT,
        content     TEXT NOT NULL,
        action_item TEXT,
        due_date    TEXT,
        status      TEXT DEFAULT 'Open',
        resolved    BOOLEAN DEFAULT false,
        resolved_at TIMESTAMPTZ,
        entry_type  TEXT DEFAULT 'note',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER,
        user_name   TEXT,
        action      TEXT,
        entity_type TEXT,
        entity_id   TEXT,
        detail      TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    TEXT PRIMARY KEY,
        sess   JSONB NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions(expire)`);

    // Safe column additions for existing deployments
    const addCol = async (table, col, type) => {
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(()=>{});
    };
    await addCol('roster',  'end_date',         'TEXT');
    await addCol('roster',  'wms_case_id',       'TEXT');
    await addCol('roster',  'case_name',         'TEXT');
    await addCol('roster',  'agency',            'TEXT');
    await addCol('roster',  'last_seen_upload',  'TEXT');
    await addCol('entries', 'children_seen',     "JSONB DEFAULT '[]'");
    await addCol('roster',  'manually_assigned', 'BOOLEAN DEFAULT false');
    await addCol('users',  'supervisor_id',    'INTEGER');
    await addCol('users',  'director_id',      'INTEGER');
    await addCol('users',  'title',            'TEXT');

    // Create first admin account if no users exist
    const existing = await client.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(existing.rows[0].c) === 0) {
      const bcrypt   = require('bcryptjs');
      const email    = process.env.ADMIN_EMAIL    || 'admin@agency.org';
      const password = process.env.ADMIN_PASSWORD || 'ChangeMe2025!';
      const name     = process.env.ADMIN_NAME     || 'System Administrator';
      const hash     = bcrypt.hashSync(password, 10);
      await client.query(
        `INSERT INTO users (email,password,name,initials,role) VALUES ($1,$2,$3,'SA','admin') ON CONFLICT (email) DO NOTHING`,
        [email, hash, name]
      );
      console.log(`[db] Admin account created: ${email}`);
    }

    console.log('[db] Migrations complete.');
  } finally {
    client.release();
  }
}

module.exports = { migrate, pool };