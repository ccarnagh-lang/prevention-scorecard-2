/* api.js — HTTP helpers and Auth */

const API = {
  async get(url) {
    const r = await fetch(url);
    if (r.status === 401) { Auth.showLogin(); return null; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (r.status === 401) { Auth.showLogin(); return null; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async put(url, body) {
    const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async download(url, body, filename) {
    const r = await fetch(url, { method: body ? 'POST' : 'GET',
      headers: body ? {'Content-Type':'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

const Auth = {
  user: null,

  async init() {
    const data = await API.get('/api/auth/me');
    if (data?.user) {
      this.user = data.user;
      App.showApp();
    } else {
      this.showLogin();
    }
  },

  async login() {
    const email = document.getElementById('l-email').value.trim();
    const pw    = document.getElementById('l-pw').value;
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      const data = await API.post('/api/auth/login', { email, password: pw });
      if (data?.user) {
        this.user = data.user;
        App.showApp();
      }
    } catch(e) {
      errEl.textContent = 'Invalid email or password. Please try again.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  },

  async quickLogin(email) {
    document.getElementById('l-email').value = email;
    document.getElementById('l-pw').value = 'password123';
    await this.login();
  },

  async logout() {
    await API.post('/api/auth/logout', {});
    this.user = null;
    this.showLogin();
  },

  showLogin() {
    document.getElementById('app-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('l-email').value = '';
    document.getElementById('l-pw').value = '';
  },
};

// Wire Enter key on login
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('l-pw')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') Auth.login();
  });
});

/* ── REQUIREMENT DEFINITIONS ───────────────────────────────── */
const REQS = {
  weekly: [
    {id:'W1',name:'Notes documented in Connections (EHR)',sec:'Administration',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'W2',name:'PROMIS contacts documented',sec:'Administration',cadence:'weekly',opts:['Yes','No','Some but not all']},
    {id:'W3',name:'Progress note written using program template',sec:'Administration',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'W4',name:'Casework contact standards met',sec:'Assessment',cadence:'weekly',opts:['Yes','No']},
    {id:'W5',name:'Diligent efforts when standards not met',sec:'Assessment',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'W6',name:'Head of household seen / assessed',sec:'Assessment',cadence:'weekly',opts:['Yes','No','Some but not all']},
    {id:'W9',name:'Safety concerns raised',sec:'Safety/Risk',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'W10',name:'Safety plan documented when concerns raised',sec:'Safety/Risk',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'W11',name:'Child welfare risk raised',sec:'Safety/Risk',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'W12',name:'Controlling factors implemented',sec:'Safety/Risk',cadence:'weekly',opts:['Yes','No','Some but not all','Not applicable']},
  ],
  monthly: [
    {id:'M1',name:'Child under 2 years old in the home',sec:'Assessment',cadence:'monthly',opts:['Yes','No']},
    {id:'M2',name:'Safe sleep discussed when applicable',sec:'Assessment',cadence:'monthly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'M4',name:'ACS collaboration held when applicable',sec:'Engagement',cadence:'monthly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'M5',name:'Family supports and resources explored',sec:'Engagement',cadence:'monthly',opts:['Yes','No','Some but not all','Not applicable']},
    {id:'M6',name:'Home assessment completed',sec:'Assessment',cadence:'monthly',opts:['Yes','No','Not applicable']},
  ],
  quarterly: {
    fasp: [
      {id:'Q1',name:'FASP completed before deadline',sec:'Admissions',cadence:'quarterly',opts:['Yes','No','Not applicable']},
      {id:'Q2',name:'FASP approved by ACS prior to due date',sec:'Admissions',cadence:'quarterly',opts:['Yes','No','Not applicable']},
      {id:'Q2A',name:'FASP signatures obtained',sec:'Admissions',cadence:'quarterly',opts:['Yes','No','Not applicable'],unscored:true},
    ],
    assessment: [
      {id:'M3',name:'Parent/Caretaker-child interaction assessed',sec:'Assessment',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q3',name:'Cultural assessment documented',sec:'Assessment',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q5',name:'Other household members identified',sec:'Assessment',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q9',name:'Financial resources in home assessment',sec:'Assessment',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
    ],
    engagement: [
      {id:'Q4',name:'Collateral contacts completed',sec:'Engagement',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q6',name:'Household members engaged when applicable',sec:'Engagement',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q7',name:'Both parents included in service planning',sec:'Engagement',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q10',name:'Parent living outside the home engaged',sec:'Engagement',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q10A',name:'Barriers to engaging outside parent documented',sec:'Engagement',cadence:'quarterly',opts:['Yes','No','Not applicable'],unscored:true},
    ],
    ftc: [
      {id:'Q11',name:'FTC held',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q12',name:'Family invited to FTC',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q12A',name:'ACS invited to FTC (if applicable)',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Not applicable'],unscored:true},
      {id:'Q13',name:'FTC follow-up tasks completed',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q14',name:'Children 10+ invited to FTC',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q15',name:'Separate conferences held when IPV/DV indicated',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q16',name:'Service plan aligns with FTC goals',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
      {id:'Q17',name:'FTC action plan followed within timeframe',sec:'FTC',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
    ],
    safety: [
      {id:'Q8',name:'Home assessment conducted with safety review',sec:'Safety/Risk',cadence:'quarterly',opts:['Yes','No','Some but not all','Not applicable']},
    ],
  },

  allFlat() {
    return [...this.weekly, ...this.monthly, ...Object.values(this.quarterly).flat()];
  },

  nameMap() {
    const m = {};
    this.allFlat().forEach(r => { m[r.id] = r.name; });
    return m;
  },
};
