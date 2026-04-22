const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const multer   = require('multer');
const { migrate, pool } = require('./migrate');
const db       = require('./database');
const docxGen  = require('./docxGenerator');

const app    = express();
const PORT   = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', secure: false },
}));

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!['admin','executive'].includes(req.session.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Parse comma-separated program IDs into array
function parsePrograms(programId) {
  if (!programId) return [];
  return programId.split(',').map(p => p.trim()).filter(Boolean);
}

function scopeProgram(req, res, next) {
  const u = req.session.user;
  if (u.role === 'executive' || u.role === 'admin') {
    req.programScope  = req.query.program_id || null;
    req.programScopes = null;
  } else {
    const programs    = parsePrograms(u.program_id);
    req.programScope  = programs[0] || null;
    req.programScopes = programs.length > 0 ? programs : null;
  }
  next();
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await db.getUserByEmail(email.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    await db.updateLastLogin(user.id);
    req.session.user = { id:user.id, email:user.email, name:user.name, initials:user.initials, role:user.role, program_id:user.program_id };
    await db.logAction(user.id, user.name, 'login', 'session', null, `Role: ${user.role}`);
    res.json({ user: req.session.user });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ success: true })); });
app.get('/api/auth/me', (req, res) => res.json({ user: req.session?.user || null }));

app.get('/api/programs', requireAuth, async (req, res) => {
  try {
    let programs = await db.getAllPrograms();
    const u = req.session.user;
    if (u.role !== 'executive' && u.role !== 'admin') {
      const userPrograms = parsePrograms(u.program_id);
      programs = programs.filter(p => userPrograms.includes(p.id));
    }
    const scores = await db.getProgramScores();
    const scoreMap = {}; scores.forEach(s => { scoreMap[s.id] = s; });
    res.json(programs.map(p => ({ ...p, ...(scoreMap[p.id]||{}) })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard', requireAuth, scopeProgram, async (req, res) => {
  try {
    res.json(await db.getDashboard(
      req.programScope, req.programScopes,
      req.query.week_ending,
      req.query.date_from || null,
      req.query.date_to   || null
    ));
  }
  catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/roster', requireAuth, scopeProgram, async (req, res) => {
  try {
    const u = req.session.user;
    const isAdminOrExec = u.role === 'admin' || u.role === 'executive';
    const progId  = isAdminOrExec ? (req.query.program_id || null) : req.programScope;
    const progIds = isAdminOrExec ? null : req.programScopes;
    res.json(await db.getRoster(progId, progIds, req.query.active !== 'false'));
  }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/roster', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try {
    const data = req.body;
    const u = req.session.user;
    if (u.role !== 'executive' && u.role !== 'admin') {
      const programs = parsePrograms(u.program_id);
      if (!data.program_id) data.program_id = programs[0];
    }
    await db.addCase(data);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/roster/:caseId', requireAuth, async (req, res) => {
  try {
    await db.updateCase(req.params.caseId, req.body);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Manual reassignment endpoint
app.post('/api/roster/:caseId/reassign', requireAuth, async (req, res) => {
  try {
    await db.reassignCase(req.params.caseId, req.body, req.session.user);
    await db.logAction(req.session.user.id, req.session.user.name, 'reassign_case', 'roster', req.params.caseId,
      `Reassigned to worker: ${req.body.planner_name}, program: ${req.body.program_id}`);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/children/:caseId', requireAuth, async (req, res) => {
  try { res.json(await db.getChildrenForCase(req.params.caseId)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/children', requireAuth, scopeProgram, async (req, res) => {
  try { res.json(await db.getAllActiveChildren(req.programScope, req.programScopes)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/children-compliance', requireAuth, scopeProgram, async (req, res) => {
  try {
    const now   = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year  = parseInt(req.query.year)  || now.getFullYear();
    res.json(await db.getChildrenSeenCompliance(req.programScope, req.programScopes, month, year));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/children-not-seen', requireAuth, scopeProgram, async (req, res) => {
  try {
    const weekEnding = req.query.week_ending || new Date().toISOString().slice(0,10);
    res.json(await db.getChildrenNotSeenThisWeek(req.programScope, req.programScopes, weekEnding));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/import/roster', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const csvText = req.file.buffer.toString('utf-8');
    const stats   = await db.importRosterCSV(csvText, req.session.user.name);
    await db.logAction(req.session.user.id, req.session.user.name, 'csv_import', 'roster', null,
      `Cases: +${stats.cases_added} updated:${stats.cases_updated} ended:${stats.cases_ended} | Children: +${stats.children_added} updated:${stats.children_updated} ended:${stats.children_ended}`);
    res.json({ success: true, stats });
  } catch(e) { console.error(e); res.status(400).json({ error: e.message }); }
});

app.get('/api/entries', requireAuth, scopeProgram, async (req, res) => {
  try {
    res.json(await db.getEntries({
      programId: req.programScope, programIds: req.programScopes,
      caseId: req.query.case_id, weekEnding: req.query.week_ending,
      planner: req.query.planner, dateFrom: req.query.date_from,
      dateTo: req.query.date_to,
      limit: req.query.limit ? parseInt(req.query.limit) : 1000,
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/entries', requireAuth, async (req, res) => {
  try {
    const u = req.session.user;
    const entry = req.body;
    if (!entry.program_id || entry.program_id === '') {
      const programs = parsePrograms(u.program_id);
      entry.program_id = programs[0] || u.program_id;
    }
    if (!entry.program_id) {
      return res.status(400).json({ error: 'No program assigned to your account. Ask your admin to assign you to a program.' });
    }
    await db.saveEntry(entry, u.id, u.name, u.role);
    res.json({ success: true });
  } catch(e) { console.error(e); res.status(400).json({ error: e.message }); }
});
app.put('/api/entries/:id', requireAuth, async (req, res) => {
  try { await db.updateEntry(req.params.id, req.body, req.session.user.id); res.json({ success: true }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/entries/:id/review', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try { await db.reviewEntry(req.params.id, req.session.user.id); res.json({ success: true }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/entries/latest', requireAuth, scopeProgram, async (req, res) => {
  try {
    const u = req.session.user;
    const isAdminOrExec = u.role === 'admin' || u.role === 'executive';
    const progId  = isAdminOrExec ? (req.query.program_id || null) : req.programScope;
    const progIds = isAdminOrExec ? null : req.programScopes;
    res.json(await db.getLatestPerCase(
      progId, progIds,
      req.query.date_from || null,
      req.query.date_to   || null
    ));
  }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/staff', requireAuth, scopeProgram, async (req, res) => {
  try {
    const pid = req.programScope || req.session.user.program_id;
    if (!pid) return res.json([]);
    res.json(await db.getStaff(pid, req.programScopes));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/supervision-log', requireAuth, scopeProgram, async (req, res) => {
  try {
    res.json(await db.getSupervisionLog({
      programId: req.programScope, programIds: req.programScopes,
      staffName: req.query.staff_name, caseId: req.query.case_id,
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/supervision-log', requireAuth, requireRole('executive','admin','program_director','supervisor'), async (req, res) => {
  try {
    const u = req.session.user;
    const data = req.body;
    if (u.role !== 'executive' && u.role !== 'admin') {
      const programs = parsePrograms(u.program_id);
      if (!data.program_id) data.program_id = programs[0];
    }
    await db.addSupervisionNote(data, u.id, u.name, u.role);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/supervision-log/:id/resolve', requireAuth, async (req, res) => {
  try { await db.resolveSupervisionNote(req.params.id); res.json({ success: true }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/export/csv', requireAuth, scopeProgram, async (req, res) => {
  try {
    const entries  = await db.getEntries({ programId:req.programScope, programIds:req.programScopes, dateFrom:req.query.date_from, dateTo:req.query.date_to, limit:10000 });
    const csv      = await db.entriesToCSV(entries, req.query.mode || 'full');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="scorecard_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/export/children-compliance', requireAuth, scopeProgram, async (req, res) => {
  try {
    const now   = new Date();
    const month = parseInt(req.query.month) || now.getMonth() + 1;
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const data  = await db.getChildrenSeenCompliance(req.programScope, req.programScopes, month, year);
    const csv   = await db.childrenToCSV(data);
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="children_compliance_${year}_${month}.csv"`);
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/export/supervisory-note', requireAuth, async (req, res) => {
  try {
    const { caseId, ...opts } = req.body;
    const entries   = await db.getEntries({ caseId, limit:100 });
    const rosterAll = await db.getRoster(null, null, false);
    const roster    = rosterAll.find(r => r.case_id === caseId);
    const supNotes  = await db.getSupervisionLog({ caseId });
    const buf = await docxGen.generateSupNote({ caseId, ...opts, roster, latest:entries[0]||null, supNotes });
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition',`attachment; filename="Supervisory_Note_${caseId}.docx"`);
    res.send(buf);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users',    requireAdmin, async (req, res) => { try { res.json(await db.getAllUsers()); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/admin/users',   requireAdmin, async (req, res) => {
  try { await db.createUser(req.body); await db.logAction(req.session.user.id,req.session.user.name,'create_user','user',req.body.email,`Role: ${req.body.role}`); res.json({ success:true }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/admin/users/:id',  requireAdmin, async (req, res) => { try { await db.updateUser(req.params.id,req.body); res.json({success:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => { try { await db.resetPassword(req.params.id,req.body.password); res.json({success:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => { try { await db.deactivateUser(req.params.id); res.json({success:true}); } catch(e) { res.status(400).json({error:e.message}); } });
app.get('/api/admin/programs',  requireAdmin, async (req, res) => { try { res.json(await db.getAllPrograms()); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/admin/programs', requireAdmin, async (req, res) => { try { await db.createProgram(req.body); res.json({success:true}); } catch(e) { res.status(400).json({error:e.message}); } });

app.get('/api/reset-admin', async (req, res) => {
  try {
    const hash  = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin2025', 10);
    const email = process.env.ADMIN_EMAIL || 'admin@agency.org';
    const name  = process.env.ADMIN_NAME  || 'Administrator';
    await pool.query(
      `INSERT INTO users (email,password,name,initials,role,active) VALUES ($1,$2,$3,'SA','admin',true)
       ON CONFLICT (email) DO UPDATE SET password=$2, role='admin', active=true`,
      [email, hash, name]
    );
    res.json({ success:true, email, message:'Password reset. You can now log in.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/first-setup', async (req, res) => {
  try {
    const existing = await pool.query('SELECT COUNT(*) as c FROM users');
    if (parseInt(existing.rows[0].c) > 0)
      return res.json({ message:'Setup already done — users exist.' });
    const hash  = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin2025', 10);
    const email = process.env.ADMIN_EMAIL || 'admin@agency.org';
    await pool.query(
      `INSERT INTO users (email,password,name,initials,role,active) VALUES ($1,$2,'Administrator','SA','admin',true)`,
      [email, hash]
    );
    res.json({ success:true, message:`Admin created. Login: ${email}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function start() {
  if (process.env.DATABASE_URL) {
    await migrate();
  } else {
    console.warn('[server] No DATABASE_URL — database features unavailable');
  }
  app.listen(PORT, () => {
    console.log(`\nPrevention Scorecard running on port ${PORT}`);
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });