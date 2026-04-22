const AdminViews = {

  async render() {
    UI.setTitle('Admin Panel');
    UI.setTopbar(`<span class="wpill">System Administration</span>`);

    const [users, programs] = await Promise.all([
      API.get('/api/admin/users') || [],
      API.get('/api/admin/programs') || [],
    ]);

    UI.setContent(`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">

        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div class="section-head" style="margin:0">Users</div>
            <button class="btn btn-p btn-sm" onclick="AdminViews.addUser()">+ Add user</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Program</th><th>Status</th><th></th></tr></thead>
              <tbody>
                ${(users||[]).map(u=>`<tr>
                  <td style="font-weight:600">${u.name}</td>
                  <td style="font-size:12px;color:#888">${u.email}</td>
                  <td><span class="badge ${u.role==='executive'?'badge-purple':u.role==='program_director'?'badge-navy':u.role==='supervisor'?'badge-amber':u.role==='admin'?'badge-red':'badge-gray'}">${u.role}</span></td>
                  <td style="font-size:12px;color:#888">${u.program_id||'All'}</td>
                  <td>${u.active?'<span class="badge badge-green">Active</span>':'<span class="badge badge-gray">Inactive</span>'}</td>
                  <td><div style="display:flex;gap:4px">
                    <button class="btn btn-xs" onclick="AdminViews.editUser(${u.id},'${u.name}','${u.role}','${u.program_id||''}')">Edit</button>
                    <button class="btn btn-xs" onclick="AdminViews.resetPassword(${u.id},'${u.name}')">Reset pw</button>
                  </div></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <div class="section-head" style="margin:0">Programs</div>
              <button class="btn btn-p btn-sm" onclick="AdminViews.addProgram()">+ Add program</button>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>ID</th><th>Name</th><th>Modality</th><th>Borough</th></tr></thead>
                <tbody>
                  ${(programs||[]).map(p=>`<tr>
                    <td class="mono bold" style="color:#1B3A5C">${p.id}</td>
                    <td>${p.name}</td>
                    <td><span class="badge badge-purple">${p.modality||'—'}</span></td>
                    <td style="font-size:12px;color:#888">${p.borough||'—'}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div class="section-head" style="margin-bottom:12px">Weekly roster CSV import</div>
            <div class="form-card" style="margin-bottom:0">
              <div style="font-size:13px;color:#555;margin-bottom:12px;line-height:1.6">
                Upload your weekly ACS roster CSV. The system will:
                <ul style="margin:8px 0 0 16px;font-size:13px;color:#555">
                  <li>Add new cases with today as the start date</li>
                  <li>Update existing cases and children</li>
                  <li>End-date cases and children not in this upload</li>
                </ul>
              </div>
              <div style="font-size:11px;color:#888;margin-bottom:12px">
                Required columns: <span class="mono">CONN Case ID, Child Name, CIN, DOB, Worker Name, Site-Unit</span>
              </div>
              <div style="border:2px dashed #DDE2E8;border-radius:8px;padding:24px;text-align:center;cursor:pointer;background:#F8F9FB"
                   onclick="document.getElementById('csv-upload').click()"
                   ondragover="event.preventDefault();this.style.borderColor='#1D9E75'"
                   ondragleave="this.style.borderColor='#DDE2E8'"
                   ondrop="event.preventDefault();this.style.borderColor='#DDE2E8';AdminViews.handleCSVDrop(event)">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="1.5" style="margin-bottom:8px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div style="font-size:13px;color:#666;margin-bottom:4px">Drop CSV file here or click to browse</div>
                <div style="font-size:11px;color:#aaa">Accepts .csv files up to 10MB</div>
                <input type="file" id="csv-upload" accept=".csv,.txt" style="display:none" onchange="AdminViews.handleCSVFile(this)">
              </div>
              <div id="csv-result" style="margin-top:12px"></div>
            </div>
          </div>
        </div>
      </div>
    `);
  },

  async handleCSVFile(input) {
    const file = input.files[0];
    if (!file) return;
    await AdminViews.uploadCSV(file);
  },

  async handleCSVDrop(event) {
    const file = event.dataTransfer.files[0];
    if (!file) return;
    await AdminViews.uploadCSV(file);
  },

  async uploadCSV(file) {
    const resultEl = document.getElementById('csv-result');
    resultEl.innerHTML = `<div style="padding:12px;background:#F0F2F5;border-radius:7px;font-size:13px;color:#666">
      Uploading and processing <strong>${file.name}</strong>...
    </div>`;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const r = await fetch('/api/import/roster', {
        method: 'POST',
        body: formData,
      });

      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await r.json();
      const s    = data.stats;

      resultEl.innerHTML = `
        <div style="padding:14px;background:#EAF3DE;border-radius:7px;border-left:3px solid #1D9E75">
          <div style="font-size:13px;font-weight:600;color:#27500A;margin-bottom:8px">Import complete</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;color:#27500A">
            <div>Cases added: <strong>${s.cases_added}</strong></div>
            <div>Cases updated: <strong>${s.cases_updated}</strong></div>
            <div>Cases end-dated: <strong>${s.cases_ended}</strong></div>
            <div style="padding-top:6px;border-top:1px solid #9FE1CB;grid-column:span 2"></div>
            <div>Children added: <strong>${s.children_added}</strong></div>
            <div>Children updated: <strong>${s.children_updated}</strong></div>
            <div>Children end-dated: <strong>${s.children_ended}</strong></div>
          </div>
        </div>`;
      UI.toast('Roster imported successfully', 'success');
    } catch(e) {
      resultEl.innerHTML = `
        <div style="padding:12px;background:#FCEBEB;border-radius:7px;border-left:3px solid #E24B4A">
          <div style="font-size:13px;font-weight:600;color:#791F1F">Import failed</div>
          <div style="font-size:12px;color:#A32D2D;margin-top:4px">${e.message}</div>
        </div>`;
      UI.toast('Import failed: ' + e.message, 'error');
    }
  },

  async addUser() {
    const allUsers = await API.get('/api/admin/users') || [];
    const supervisors = allUsers.filter(u => u.role === 'supervisor' && u.active);
    const directors   = allUsers.filter(u => u.role === 'program_director' && u.active);

    UI.modal(`
      <div class="modal-title">Add new user</div>
      <div class="grid-2" style="margin-bottom:10px">
        <div class="field"><label>Full name *</label><input type="text" id="au-name" placeholder="First Last"></div>
        <div class="field"><label>Email address *</label><input type="email" id="au-email" placeholder="name@agency.org"></div>
      </div>
      <div class="grid-2" style="margin-bottom:10px">
        <div class="field"><label>Temporary password *</label><input type="text" id="au-pw" placeholder="They can change this later"></div>
        <div class="field"><label>Job title</label><input type="text" id="au-title" placeholder="e.g. Case Planner, LMSW"></div>
      </div>
      <div class="grid-2" style="margin-bottom:10px">
        <div class="field"><label>Role *</label>
          <select id="au-role" onchange="AdminViews.toggleUserFields()">
            <option value="staff">Staff (Case Planner)</option>
            <option value="supervisor">Supervisor</option>
            <option value="program_director">Program Director</option>
            <option value="office_manager">Office Manager</option>
            <option value="executive">Executive</option>
            <option value="admin">System Admin</option>
          </select>
        </div>
        <div class="field"><label>Program ID (comma-separated for multiple)</label><input type="text" id="au-prog" placeholder="e.g. B0G - TST, B0G - TT1"></div>
      </div>
      <div id="au-supervisor-field" style="margin-bottom:10px">
        <div class="field"><label>Reports to supervisor</label>
          <select id="au-supervisor">
            <option value="">— None —</option>
            ${supervisors.map(s=>`<option value="${s.id}">${s.name} (${s.program_id||'—'})</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="au-director-field" style="margin-bottom:10px;display:none">
        <div class="field"><label>Reports to director</label>
          <select id="au-director">
            <option value="">— None —</option>
            ${directors.map(d=>`<option value="${d.id}">${d.name} (${d.program_id||'—'})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Create user</button>
      </div>`,
      async () => {
        const name  = document.getElementById('au-name')?.value?.trim();
        const email = document.getElementById('au-email')?.value?.trim();
        const pw    = document.getElementById('au-pw')?.value?.trim();
        const role  = document.getElementById('au-role')?.value;
        const prog  = document.getElementById('au-prog')?.value?.trim();
        const title = document.getElementById('au-title')?.value?.trim();
        const supId = document.getElementById('au-supervisor')?.value || null;
        const dirId = document.getElementById('au-director')?.value   || null;
        if (!name || !email || !pw) { UI.toast('Name, email and password required', 'error'); return; }
        try {
          await API.post('/api/admin/users', {
            name, email, password: pw, role,
            program_id:   prog || null,
            title:        title || null,
            supervisor_id: supId ? parseInt(supId) : null,
            director_id:   dirId ? parseInt(dirId) : null,
          });
          UI.toast(`User ${name} created`, 'success');
          await AdminViews.render();
        } catch(e) { UI.toast('Failed: '+e.message, 'error'); }
      }
    );
  },

  toggleUserFields() {
    const role = document.getElementById('au-role')?.value || document.getElementById('eu-role')?.value;
    const supField = document.getElementById('au-supervisor-field') || document.getElementById('eu-supervisor-field');
    const dirField = document.getElementById('au-director-field')   || document.getElementById('eu-director-field');
    if (supField) supField.style.display = (role === 'staff') ? '' : 'none';
    if (dirField) dirField.style.display = (role === 'supervisor') ? '' : 'none';
  },

  async editUser(id, name, role, programId) {
    const allUsers    = await API.get('/api/admin/users') || [];
    const thisUser    = allUsers.find(u => u.id === id) || {};
    const supervisors = allUsers.filter(u => u.role === 'supervisor' && u.active && u.id !== id);
    const directors   = allUsers.filter(u => u.role === 'program_director' && u.active && u.id !== id);

    UI.modal(`
      <div class="modal-title">Edit user — ${name}</div>
      <div class="grid-2" style="margin-bottom:10px">
        <div class="field"><label>Full name</label><input type="text" id="eu-name" value="${name}"></div>
        <div class="field"><label>Job title</label><input type="text" id="eu-title" value="${thisUser.title||''}"></div>
      </div>
      <div class="grid-2" style="margin-bottom:10px">
        <div class="field"><label>Role</label>
          <select id="eu-role" onchange="AdminViews.toggleUserFields()">
            <option value="staff" ${role==='staff'?'selected':''}>Staff (Case Planner)</option>
            <option value="supervisor" ${role==='supervisor'?'selected':''}>Supervisor</option>
            <option value="program_director" ${role==='program_director'?'selected':''}>Program Director</option>
            <option value="office_manager" ${role==='office_manager'?'selected':''}>Office Manager</option>
            <option value="executive" ${role==='executive'?'selected':''}>Executive</option>
            <option value="admin" ${role==='admin'?'selected':''}>System Admin</option>
          </select>
        </div>
        <div class="field"><label>Program ID (comma-separated)</label><input type="text" id="eu-prog" value="${programId||''}"></div>
      </div>
      <div id="eu-supervisor-field" style="margin-bottom:10px;${role!=='staff'?'display:none':''}">
        <div class="field"><label>Reports to supervisor</label>
          <select id="eu-supervisor">
            <option value="">— None —</option>
            ${supervisors.map(s=>`<option value="${s.id}" ${thisUser.supervisor_id===s.id?'selected':''}>${s.name} (${s.program_id||'—'})</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="eu-director-field" style="margin-bottom:10px;${role!=='supervisor'?'display:none':''}">
        <div class="field"><label>Reports to director</label>
          <select id="eu-director">
            <option value="">— None —</option>
            ${directors.map(d=>`<option value="${d.id}" ${thisUser.director_id===d.id?'selected':''}>${d.name} (${d.program_id||'—'})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-bottom:10px"><label>Status</label>
        <select id="eu-active"><option value="true">Active</option><option value="false">Inactive</option></select>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Save changes</button>
      </div>`,
      async () => {
        try {
          const supId = document.getElementById('eu-supervisor')?.value || null;
          const dirId = document.getElementById('eu-director')?.value   || null;
          await API.put(`/api/admin/users/${id}`, {
            name:          document.getElementById('eu-name')?.value,
            role:          document.getElementById('eu-role')?.value,
            program_id:    document.getElementById('eu-prog')?.value || null,
            title:         document.getElementById('eu-title')?.value || null,
            active:        document.getElementById('eu-active')?.value === 'true',
            supervisor_id: supId ? parseInt(supId) : null,
            director_id:   dirId ? parseInt(dirId) : null,
          });
          UI.toast('User updated', 'success');
          await AdminViews.render();
        } catch(e) { UI.toast('Failed: '+e.message, 'error'); }
      }
    );
  },

  resetPassword(id, name) {
    UI.modal(`
      <div class="modal-title">Reset password — ${name}</div>
      <div class="field" style="margin-bottom:8px"><label>New password</label>
        <input type="text" id="rp-pw" placeholder="Enter a temporary password"></div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-r" data-confirm>Reset password</button>
      </div>`,
      async () => {
        const pw = document.getElementById('rp-pw')?.value?.trim();
        if (!pw||pw.length<6) { UI.toast('Password must be at least 6 characters','error'); return; }
        try { await API.post(`/api/admin/users/${id}/reset-password`,{password:pw}); UI.toast('Password reset for '+name,'success'); }
        catch(e) { UI.toast('Failed: '+e.message,'error'); }
      }
    );
  },

  addProgram() {
    UI.modal(`
      <div class="modal-title">Add program</div>
      <div class="grid-2">
        <div class="field"><label>Program ID (must match Site-Unit in CSV)</label><input type="text" id="ap-id" placeholder="e.g. 5530-Queens-BSFT"></div>
        <div class="field"><label>Site code</label><input type="text" id="ap-site" placeholder="e.g. 5530"></div>
      </div>
      <div class="field" style="margin-bottom:10px"><label>Program name</label><input type="text" id="ap-name" placeholder="e.g. 5530 Queens BSFT"></div>
      <div class="grid-2">
        <div class="field"><label>Modality</label>
          <select id="ap-mod"><option>BSFT</option><option>CPP</option><option>FS-MM</option><option>TST</option></select></div>
        <div class="field"><label>Borough</label>
          <select id="ap-borough"><option>Bronx</option><option>Brooklyn</option><option>Manhattan</option><option>Queens</option><option>Staten Island</option></select></div>
      </div>
      <div style="font-size:11px;padding:8px;background:#FAEEDA;border-radius:6px;color:#633806;margin-top:4px">
        The Program ID must exactly match the value in the Site-Unit column of your CSV file.
      </div>
      <div class="modal-footer">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-p" data-confirm>Add program</button>
      </div>`,
      async () => {
        const id   = document.getElementById('ap-id')?.value?.trim();
        const name = document.getElementById('ap-name')?.value?.trim();
        if (!id||!name) { UI.toast('Program ID and name required','error'); return; }
        try {
          await API.post('/api/admin/programs', { id, name, site_code:document.getElementById('ap-site')?.value, modality:document.getElementById('ap-mod')?.value, borough:document.getElementById('ap-borough')?.value });
          UI.toast('Program added','success');
          await AdminViews.render();
        } catch(e) { UI.toast('Failed: '+e.message,'error'); }
      }
    );
  },
};