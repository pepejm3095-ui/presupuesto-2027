// Presupuesto de gastos de operación 2027 · captura por área (Supabase)
{
const EJ = 2027;
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const $ = s => document.getElementById(s);
const fmt = new Intl.NumberFormat('es-MX', {maximumFractionDigits: 0});
const fmt2 = new Intl.NumberFormat('es-MX', {maximumFractionDigits: 2});
const money = v => '$' + fmt.format(Math.round(v));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sum = a => (a || []).reduce((s, x) => s + (+x || 0), 0);
const ESTX = {ini:'Sin iniciar', cap:'En captura', par:'Envío parcial', env:'Enviado'};

const sb = window.supabase.createClient(window.CONFIG.url, window.CONFIG.key);
let me = null, accesos = [], admin = false;
let AREAS = [], DEP = {}, LINEAS = [], byId = {};
let montos = {};    // linea_id -> {m:[12], nota}
let capt = {};      // `${area}|${ceco}` -> estado
let dirty = new Set();
let cur = null, ceco = '', view = 'cap', rowsOrder = [];

// ---------- utilidades de permisos (la base de datos los vuelve a validar) ----------
const misAcc = () => accesos.filter(a => a.email === me);
const puedeEditar = l => admin || misAcc().some(a => a.rol === 'captura' && a.area === l.area && (!a.ceco || a.ceco === l.ceco));
const cerrado = l => capt[l.area + '|' + l.ceco] === 'enviado';
const editable = l => admin || (puedeEditar(l) && !cerrado(l));
const val = id => montos[id] || {m: Array(12).fill(0), nota: ''};

function say(t, err, el = 'msg') { const n = $(el); if (!n) return; n.textContent = t; n.classList.toggle('err', !!err); }
function show(id) { for (const v of ['vLogin', 'vApp']) $(v).classList.toggle('hidden', v !== id); }

// ---------- sesión ----------
$('tabEntrar').onclick = () => { $('fEntrar').classList.remove('hidden'); $('fActivar').classList.add('hidden'); $('tabEntrar').setAttribute('aria-selected', 'true'); $('tabActivar').setAttribute('aria-selected', 'false'); };
$('tabActivar').onclick = () => { $('fActivar').classList.remove('hidden'); $('fEntrar').classList.add('hidden'); $('tabActivar').setAttribute('aria-selected', 'true'); $('tabEntrar').setAttribute('aria-selected', 'false'); };
$('fEntrar').onsubmit = async e => {
  e.preventDefault(); say('Entrando…', false, 'msgLogin');
  const { error } = await sb.auth.signInWithPassword({ email: $('lEmail').value.trim().toLowerCase(), password: $('lPass').value });
  if (error) say('Correo o contraseña incorrectos.', true, 'msgLogin');
};
$('fActivar').onsubmit = async e => {
  e.preventDefault();
  const email = $('aEmail').value.trim().toLowerCase(), p1 = $('aPass').value, p2 = $('aPass2').value;
  if (p1 !== p2) return say('Las contraseñas no coinciden.', true, 'msgLogin');
  if (p1.length < 10) return say('La contraseña debe tener al menos 10 caracteres.', true, 'msgLogin');
  say('Activando…', false, 'msgLogin');
  const { data, error } = await sb.functions.invoke('cuentas', { body: { accion: 'activar', email, codigo: $('aCod').value, password: p1 } });
  let msg = data?.error;
  if (error) { try { msg = (await error.context.json()).error; } catch { msg = 'No se pudo activar la cuenta.'; } }
  if (msg) return say(msg, true, 'msgLogin');
  await sb.auth.signInWithPassword({ email, password: p1 });
};
$('bSalir').onclick = async () => { if (dirty.size && !await confirma('bSalir', 'Hay cambios sin guardar. ¿Salir?')) return; dirty.clear(); await sb.auth.signOut(); };
$('bPass').onclick = () => $('dlgPass').classList.toggle('hidden');
$('fPass').onsubmit = async e => {
  e.preventDefault();
  if ($('nPass').value !== $('nPass2').value) return say('No coinciden.', true, 'msgPass');
  if ($('nPass').value.length < 10) return say('Mínimo 10 caracteres.', true, 'msgPass');
  const { error } = await sb.auth.updateUser({ password: $('nPass').value });
  say(error ? 'No se pudo cambiar: ' + error.message : 'Contraseña actualizada.', !!error, 'msgPass');
  if (!error) { $('fPass').reset(); setTimeout(() => $('dlgPass').classList.add('hidden'), 1500); }
};
// confirmación en el mismo botón (las ventanas emergentes pueden estar bloqueadas)
function confirma(id, texto) {
  const b = $(id);
  if (b.dataset.c === '1') { b.dataset.c = ''; b.textContent = b.dataset.t; return Promise.resolve(true); }
  b.dataset.t = b.textContent; b.dataset.c = '1'; b.textContent = texto;
  setTimeout(() => { if (b.dataset.c === '1') { b.dataset.c = ''; b.textContent = b.dataset.t; } }, 5000);
  return Promise.resolve(false);
}

sb.auth.onAuthStateChange((_e, s) => {
  const em = s?.user?.email?.toLowerCase() || null;
  if (em === me) return;
  me = em;
  if (me) cargar(); else { show('vLogin'); $('fEntrar').reset(); }
});

// ---------- carga ----------
async function todo(q) { // pagina más allá de 1000 filas
  let out = [], from = 0;
  for (;;) { const { data, error } = await q().range(from, from + 999); if (error) throw error; out = out.concat(data); if (data.length < 1000) return out; from += 1000; }
}
async function cargar() {
  show('vApp'); $('who').textContent = me; say('Cargando…');
  try {
    const [acc, ar, dp, li, mo, ca] = await Promise.all([
      todo(() => sb.from('accesos').select('*').order('email')),
      todo(() => sb.from('areas').select('*').order('orden')),
      todo(() => sb.from('departamentos').select('*').order('ceco')),
      todo(() => sb.from('lineas').select('*').order('id')),
      todo(() => sb.from('montos').select('linea_id,m,nota,actualizado,actualizado_por').eq('ejercicio', EJ)),
      todo(() => sb.from('capturas').select('area,ceco,estado').eq('ejercicio', EJ)),
    ]);
    accesos = acc; admin = acc.some(a => a.email === me && a.rol === 'admin');
    DEP = Object.fromEntries(dp.map(d => [d.ceco, d.nombre]));
    LINEAS = li; byId = Object.fromEntries(li.map(l => [l.id, l]));
    const visibles = new Set(li.map(l => l.area));
    AREAS = ar.filter(a => visibles.has(a.k));
    montos = {}; for (const r of mo) montos[r.linea_id] = { m: r.m.map(Number), nota: r.nota || '', ts: r.actualizado, por: r.actualizado_por };
    capt = {}; for (const c of ca) capt[c.area + '|' + c.ceco] = c.estado;
    dirty.clear();
  } catch (e) { say('No se pudo cargar la información: ' + e.message, true); return; }
  if (!LINEAS.length) {
    $('sinAcceso').classList.remove('hidden'); $('main').classList.add('hidden'); $('strip').innerHTML = ''; return;
  }
  $('sinAcceso').classList.add('hidden'); $('main').classList.remove('hidden');
  if (!AREAS.some(a => a.k === cur)) cur = AREAS[0].k;
  route();
}

// ---------- estado y totales ----------
function lineasArea(k) { return LINEAS.filter(l => l.area === k); }
function estado(k) {
  const cecos = [...new Set(lineasArea(k).map(l => l.ceco))];
  const env = cecos.filter(c => capt[k + '|' + c] === 'enviado').length;
  if (env && env === cecos.length) return 'env';
  if (env) return 'par';
  return lineasArea(k).some(l => montos[l.id]) ? 'cap' : 'ini';
}
const mesesDe = ls => { const m = Array(12).fill(0); for (const l of ls) { const v = montos[l.id]; if (v) v.m.forEach((x, i) => m[i] += +x || 0); } return m; };

function strip() {
  const dots = { ini: '', cap: 'cap', par: 'cap', env: 'env' };
  let h = AREAS.map(a => {
    const e = estado(a.k), t = sum(mesesDe(lineasArea(a.k)));
    const d = lineasArea(a.k).some(l => dirty.has(l.id));
    return `<button class="chip" type="button" data-k="${a.k}" aria-current="${view === 'cap' && cur === a.k}"><b>${esc(a.nombre)}${d ? ' •' : ''}</b><span class="amt">${money(t)}</span><span class="st"><i class="dot ${dots[e]}"></i>${ESTX[e]}</span></button>`;
  }).join('');
  if (AREAS.length > 1 || admin) h += `<button class="chip all" type="button" data-k="consolidado" aria-current="${view === 'cons'}"><b>Consolidado</b><span class="amt">${money(sum(mesesDe(LINEAS)))}</span><span class="st">${AREAS.filter(a => estado(a.k) === 'env').length} de ${AREAS.length} áreas enviadas</span></button>`;
  if (admin) h += `<button class="chip all" type="button" data-k="accesos" aria-current="${view === 'acc'}"><b>Accesos</b><span class="amt">${new Set(accesos.map(a => a.email)).size}</span><span class="st">usuarios con acceso</span></button>`;
  $('strip').innerHTML = h;
}

// ---------- captura ----------
function lineasVista() { return lineasArea(cur).filter(l => !ceco || l.ceco === ceco); }
function buildGrid() {
  const lines = lineasVista();
  let h = `<table id="tb"><thead><tr><th>Concepto</th><th style="text-align:left">CECO</th>${MES.map(m => `<th>${m}</th>`).join('')}<th>Total anual</th><th style="text-align:left">Nota</th></tr></thead><tbody>`;
  let sec = null; rowsOrder = [];
  const groups = {}; lines.forEach(l => { const g = l.rubro + '|' + l.concepto; (groups[g] = groups[g] || []).push(l); });
  const seen = new Set();
  for (const l of lines) {
    if (l.rubro !== sec) { sec = l.rubro; h += `<tr class="sec" data-sec="${esc(sec)}"><td class="c">${esc(sec)}</td><td></td>${MES.map((_, i) => `<td data-ss="${i}"></td>`).join('')}<td data-ss="12"></td><td></td></tr>`; }
    const g = l.rubro + '|' + l.concepto, gl = groups[g];
    if (gl.length > 1) {
      if (seen.has(g)) continue; seen.add(g);
      const gid = 'g' + gl[0].id;
      h += `<tr class="grp" data-g="${gid}"><td class="c">${esc(l.concepto)}<small>${esc(l.cuenta || '')} · ${gl.length} centros de costo</small></td><td></td>${MES.map((_, i) => `<td data-gs="${i}"></td>`).join('')}<td data-gs="12"></td><td></td></tr>`;
      gl.forEach(x => h += row(x, gid));
    } else h += row(l, '');
  }
  h += `</tbody><tfoot><tr><td class="c">Total ${esc(AREAS.find(a => a.k === cur)?.nombre)}${ceco ? ' · ' + esc(DEP[ceco]) : ''}</td><td></td>${MES.map((_, i) => `<td data-ft="${i}"></td>`).join('')}<td data-ft="12"></td><td></td></tr></tfoot></table>`;
  $('grid').innerHTML = h;
  filter(); totals();
}
function row(l, gid) {
  rowsOrder.push(l.id);
  const v = val(l.id), tot = sum(v.m), dep = DEP[l.ceco] || '', ro = editable(l) ? '' : 'disabled';
  const tag = l.llenado_por === 'OPERACIONES/VENTAS' ? ' · Operaciones/Ventas' : '';
  const q = (l.concepto + ' ' + (l.descripcion || '') + ' ' + (l.cuenta || '') + ' ' + l.ceco + ' ' + dep + ' ' + l.rubro).toLowerCase();
  return `<tr data-id="${l.id}" data-q="${esc(q)}" class="${gid ? 'kid hide' : ''}" ${gid ? `data-p="${gid}"` : ''}><td class="c">${esc(gid ? dep || l.ceco : l.concepto)}<small>${esc(gid ? l.descripcion : [l.cuenta, l.descripcion].filter(Boolean).join(' · ') || 'Sin cuenta asignada')}${tag}${cerrado(l) ? ' · enviado' : ''}</small></td><td class="ceco">${esc(l.ceco)}</td>` +
    MES.map((_, i) => `<td class="n"><input inputmode="decimal" data-id="${l.id}" data-m="${i}" value="${v.m[i] ? fmt2.format(v.m[i]) : ''}" class="${v.m[i] ? 'has' : ''}" aria-label="${esc(l.concepto)} ${esc(l.ceco)} ${MES[i]}" ${ro}></td>`).join('') +
    `<td class="n t"><input inputmode="decimal" data-id="${l.id}" data-m="12" value="${tot ? fmt.format(tot) : ''}" aria-label="Total anual ${esc(l.concepto)} ${esc(l.ceco)}" ${ro}></td>` +
    `<td class="nt"><input data-id="${l.id}" data-m="nota" value="${esc(v.nota)}" aria-label="Nota ${esc(l.concepto)} ${esc(l.ceco)}" placeholder="${ro ? '' : 'Supuesto o comentario'}" ${ro}></td></tr>`;
}
function parseNum(s) {
  s = String(s).trim().replace(/[$\s]/g, ''); if (!s) return 0;
  if (/^-?[\d.]*,\d{1,2}$/.test(s) && !/,\d{3}/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = parseFloat(s); return isFinite(n) ? n : NaN;
}
function setCell(id, m, n) {
  const v = montos[id] || (montos[id] = { m: Array(12).fill(0), nota: '' });
  if (m === 'nota') v.nota = n;
  else if (m === 12) { const base = Math.floor(n / 12 * 100) / 100; for (let i = 0; i < 12; i++) v.m[i] = base; v.m[11] = Math.round((n - base * 11) * 100) / 100; }
  else v.m[m] = n;
  dirty.add(+id);
}
function refreshRow(id) {
  const v = val(id);
  document.querySelectorAll(`input[data-id="${id}"]`).forEach(inp => {
    if (inp === document.activeElement || inp.dataset.m === 'nota') return;
    const m = +inp.dataset.m, x = m === 12 ? sum(v.m) : v.m[m];
    inp.value = x ? (m === 12 ? fmt.format(x) : fmt2.format(x)) : ''; inp.classList.toggle('has', !!x);
  });
}
function totals() {
  const tb = $('tb'); if (!tb) return;
  const ss = {}, gs = {}, ft = Array(13).fill(0), gidOf = {};
  tb.querySelectorAll('tr[data-p]').forEach(r => gidOf[r.dataset.id] = r.dataset.p);
  for (const l of lineasVista()) {
    const v = montos[l.id]; if (!v) continue; const t = sum(v.m);
    const s = ss[l.rubro] || (ss[l.rubro] = Array(13).fill(0));
    const g = gidOf[l.id] ? (gs[gidOf[l.id]] || (gs[gidOf[l.id]] = Array(13).fill(0))) : null;
    v.m.forEach((x, i) => { s[i] += +x || 0; ft[i] += +x || 0; if (g) g[i] += +x || 0; }); s[12] += t; ft[12] += t; if (g) g[12] += t;
  }
  tb.querySelectorAll('tr.sec').forEach(r => { const a = ss[r.dataset.sec] || []; r.querySelectorAll('[data-ss]').forEach(c => c.textContent = a[c.dataset.ss] ? fmt.format(a[c.dataset.ss]) : ''); });
  tb.querySelectorAll('tr.grp').forEach(r => { const a = gs[r.dataset.g] || []; r.querySelectorAll('[data-gs]').forEach(c => c.textContent = a[c.dataset.gs] ? fmt.format(a[c.dataset.gs]) : ''); });
  tb.querySelectorAll('[data-ft]').forEach(c => c.textContent = money(ft[c.dataset.ft]));
  $('bSave').disabled = !dirty.size; strip();
}
function filter() {
  const q = $('q').value.trim().toLowerCase(), tb = $('tb'); if (!tb) return;
  const open = new Set([...tb.querySelectorAll('tr.grp.open')].map(r => r.dataset.g)), vis = {};
  tb.querySelectorAll('tr[data-id]').forEach(r => { const hit = !q || r.dataset.q.includes(q), p = r.dataset.p; if (hit && p) vis[p] = true; r.classList.toggle('hide', !hit || !!(p && !q && !open.has(p))); r.dataset.hit = hit ? 1 : 0; });
  let any = false, secRow = null;
  [...tb.tBodies[0].rows].forEach(r => {
    if (r.classList.contains('sec')) { if (secRow) secRow.classList.toggle('hide', !any); secRow = r; any = false; return; }
    if (r.classList.contains('grp')) { const ok = !q || vis[r.dataset.g]; r.classList.toggle('hide', !ok); if (q && ok) r.classList.add('open'); if (ok) any = true; return; }
    if (r.dataset.hit === '1') any = true;
  });
  if (secRow) secRow.classList.toggle('hide', !any);
}
function statusCap() {
  if (view !== 'cap') return;
  const ls = lineasVista(), area = AREAS.find(a => a.k === cur);
  const puede = ls.some(puedeEditar), e = estado(cur);
  let ult = null; for (const l of ls) { const v = montos[l.id]; if (v?.ts && (!ult || v.ts > ult.ts)) ult = v; }
  say(dirty.size ? `Hay ${dirty.size} partida(s) con cambios sin guardar.` :
    (ult ? `Última modificación ${new Date(ult.ts).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })} por ${ult.por}.` : 'Aún no hay montos capturados.') +
    (!puede ? ' Acceso de solo consulta.' : ''));
  $('bSend').classList.toggle('hidden', !puede || e === 'env');
  $('bReopen').classList.toggle('hidden', !admin || (e !== 'env' && e !== 'par'));
  $('bSave').classList.toggle('hidden', !ls.some(editable));
  $('tArea').textContent = area?.nombre || '';
  $('estadoArea').textContent = ESTX[e];
}
async function guardar() {
  if (!dirty.size) return true;
  const up = [], del = [];
  for (const id of dirty) {
    const v = montos[id]; if (!v) continue;
    if (v.m.some(x => x) || v.nota.trim()) up.push({ ejercicio: EJ, linea_id: id, m: v.m.map(x => +x || 0), nota: v.nota.trim() });
    else del.push(id);
  }
  $('bSave').disabled = true; say('Guardando…');
  try {
    if (up.length) { const { error } = await sb.from('montos').upsert(up, { onConflict: 'ejercicio,linea_id' }); if (error) throw error; }
    if (del.length) { const { error } = await sb.from('montos').delete().eq('ejercicio', EJ).in('linea_id', del); if (error) throw error; }
    dirty.clear();
    for (const id of del) delete montos[id];
    const ahora = new Date().toISOString(); for (const r of up) Object.assign(montos[r.linea_id], { ts: ahora, por: me });
    statusCap(); strip(); return true;
  } catch (e) {
    say('No se guardó: ' + (e.message?.includes('row-level') ? 'alguna partida ya fue enviada o no tienes permiso sobre ella. Recarga la página.' : e.message) + ' Tus cambios siguen en pantalla.', true);
    $('bSave').disabled = false; return false;
  }
}

// ---------- consolidado ----------
function tabla(id, primera, filas) {
  const tot = Array(12).fill(0); filas.forEach(f => f.m.forEach((x, i) => tot[i] += x)); const G = sum(tot) || 1;
  $(id).innerHTML = `<thead><tr><th>${primera}</th>${MES.map(m => `<th>${m}</th>`).join('')}<th>Total</th><th>%</th>${filas[0]?.e !== undefined ? '<th style="text-align:left">Estado</th>' : ''}</tr></thead><tbody>` +
    filas.map(f => `<tr><td>${esc(f.n)}<div class="bar"><i style="width:${(sum(f.m) / G * 100).toFixed(1)}%"></i></div></td>${f.m.map(x => `<td>${x ? fmt.format(x) : '—'}</td>`).join('')}<td><b>${fmt.format(sum(f.m))}</b></td><td>${(sum(f.m) / G * 100).toFixed(1)}%</td>${f.e !== undefined ? `<td style="text-align:left">${ESTX[f.e]}</td>` : ''}</tr>`).join('') +
    `<tr class="tot"><td>Total</td>${tot.map(x => `<td>${fmt.format(x)}</td>`).join('')}<td>${fmt.format(sum(tot))}</td><td></td>${filas[0]?.e !== undefined ? '<td></td>' : ''}</tr></tbody>`;
}
function cons() {
  tabla('tCA', 'Área', AREAS.map(a => ({ n: a.nombre, m: mesesDe(lineasArea(a.k)), e: estado(a.k) })));
  const cecos = [...new Set(LINEAS.map(l => l.ceco))].sort();
  tabla('tCD', 'Departamento', cecos.map(c => ({ n: c + ' · ' + (DEP[c] || ''), m: mesesDe(LINEAS.filter(l => l.ceco === c)) })));
  const rub = [...new Set(LINEAS.map(l => l.rubro))];
  tabla('tCR', 'Rubro', rub.map(r => ({ n: r, m: mesesDe(LINEAS.filter(l => l.rubro === r)) })));
  const pend = AREAS.filter(a => estado(a.k) !== 'env').map(a => a.nombre);
  say(pend.length ? 'Pendientes de enviar: ' + pend.join(', ') + '.' : 'Todas las áreas enviaron su presupuesto.', false, 'msg2');
}

// ---------- accesos (administrador) ----------
function accRender() {
  const areaOpt = '<option value="">—</option>' + AREAS.map(a => `<option value="${a.k}">${esc(a.nombre)}</option>`).join('');
  $('acArea').innerHTML = areaOpt;
  $('acCeco').innerHTML = '<option value="">Todos los departamentos</option>' + Object.entries(DEP).map(([k, v]) => `<option value="${k}">${k} · ${esc(v)}</option>`).join('');
  const an = Object.fromEntries(AREAS.map(a => [a.k, a.nombre]));
  const rolx = { admin: 'Administrador (todo)', captura: 'Captura', consulta: 'Consulta (solo lectura)' };
  $('tAcc').innerHTML = `<thead><tr><th>Correo</th><th>Rol</th><th>Área</th><th>Departamento</th><th></th></tr></thead><tbody>` +
    (accesos.map(a => `<tr><td>${esc(a.email)}</td><td>${rolx[a.rol]}</td><td>${a.area ? esc(an[a.area] || a.area) : a.rol === 'admin' ? 'Todas' : 'Todas'}</td><td>${a.ceco ? esc(a.ceco + ' · ' + (DEP[a.ceco] || '')) : 'Todos'}</td>
      <td class="acts"><button class="btn sm" type="button" data-cod="${esc(a.email)}">Generar código</button> ${a.email === me && a.rol === 'admin' ? '' : `<button class="btn sm warn" type="button" data-del="${a.id}">Quitar</button>`}</td></tr>`).join('') || '<tr><td colspan="5">Sin accesos.</td></tr>') + '</tbody>';
}
$('acRol').onchange = () => { const r = $('acRol').value; $('acArea').disabled = r === 'admin'; $('acCeco').disabled = r === 'admin'; $('acCeco').options[0].text = r === 'consulta' ? 'Elige un departamento' : 'Todos los departamentos'; };
$('fAcc').onsubmit = async e => {
  e.preventDefault();
  const rol = $('acRol').value, row = { email: $('acEmail').value.trim().toLowerCase(), rol, area: rol === 'admin' ? null : $('acArea').value || null, ceco: rol === 'admin' ? null : $('acCeco').value || null };
  if (rol === 'captura' && !row.area) return say('Para captura elige el área (columna "Llenado por").', true, 'msg3');
  if (rol === 'consulta' && !row.ceco) return say('Para consulta elige el departamento.', true, 'msg3');
  const { data, error } = await sb.from('accesos').insert(row).select();
  if (error) return say(error.code === '23505' ? 'Ese acceso ya existe.' : 'No se pudo dar de alta: ' + error.message, true, 'msg3');
  accesos.push(data[0]); accesos.sort((a, b) => a.email.localeCompare(b.email)); $('acEmail').value = '';
  say(`Acceso agregado para ${row.email}. Si aún no tiene cuenta, genera su código de activación.`, false, 'msg3'); accRender(); strip();
};
$('tAcc').onclick = async e => {
  const d = e.target.closest('[data-del]'), c = e.target.closest('[data-cod]');
  if (d) {
    if (d.dataset.c !== '1') { d.dataset.c = '1'; d.textContent = '¿Quitar?'; setTimeout(() => { d.dataset.c = ''; d.textContent = 'Quitar'; }, 4000); return; }
    const { error } = await sb.from('accesos').delete().eq('id', d.dataset.del);
    if (error) return say('No se pudo quitar: ' + error.message, true, 'msg3');
    accesos = accesos.filter(a => String(a.id) !== d.dataset.del); accRender(); strip(); say('Acceso quitado.', false, 'msg3');
  }
  if (c) {
    say('Generando código…', false, 'msg3');
    const { data, error } = await sb.functions.invoke('cuentas', { body: { accion: 'codigo', email: c.dataset.cod } });
    let msg = data?.error; if (error) { try { msg = (await error.context.json()).error; } catch { msg = error.message; } }
    if (msg) return say(msg, true, 'msg3');
    $('codBox').classList.remove('hidden');
    $('codTxt').textContent = data.codigo; $('codMail').textContent = c.dataset.cod;
    $('codExp').textContent = new Date(data.expira).toLocaleDateString('es-MX', { dateStyle: 'long' });
    say('', false, 'msg3');
  }
};
$('bCopy').onclick = async () => {
  const t = `Para capturar el presupuesto 2027 entra a ${location.origin}, elige "Activar cuenta" y usa:\nCorreo: ${$('codMail').textContent}\nCódigo: ${$('codTxt').textContent}\nEl código vence el ${$('codExp').textContent}.`;
  try { await navigator.clipboard.writeText(t); $('bCopy').textContent = 'Copiado'; } catch { $('bCopy').textContent = 'Copia el texto manualmente'; }
  setTimeout(() => $('bCopy').textContent = 'Copiar instrucciones', 2000);
};

// ---------- exportar ----------
function exportX(ls, name, conResumen) {
  const head = ['Rubro', 'Concepto', 'Cuenta', 'Descripción cuenta contable', 'CECO', 'Departamento', 'Llenado por', ...MES.map(m => m + ' ' + EJ), 'Total ' + EJ, 'Nota'];
  const rows = ls.map(l => { const v = val(l.id); return [l.rubro, l.concepto, l.cuenta || '', l.descripcion || '', l.ceco, DEP[l.ceco] || '', l.llenado_por, ...v.m.map(x => +x || 0), sum(v.m), v.nota]; });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[window.CONFIG.empresa], ['PRESUPUESTO GASTOS DE OPERACIÓN · EJERCICIO ' + EJ], [], head, ...rows]);
  ws['!cols'] = [{ wch: 26 }, { wch: 34 }, { wch: 16 }, { wch: 34 }, { wch: 7 }, { wch: 22 }, { wch: 16 }, ...Array(13).fill({ wch: 13 }), { wch: 40 }];
  for (let R = 4; R < rows.length + 4; R++) for (let C = 7; C <= 19; C++) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c) c.z = '#,##0.00'; }
  XLSX.utils.book_append_sheet(wb, ws, 'G&A');
  if (conResumen) {
    const s = [['Área', ...MES, 'Total', 'Estado']]; AREAS.forEach(a => { const m = mesesDe(lineasArea(a.k)); s.push([a.nombre, ...m, sum(m), ESTX[estado(a.k)]]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s), 'Resumen por área');
    const d = [['CECO', 'Departamento', ...MES, 'Total']]; [...new Set(LINEAS.map(l => l.ceco))].sort().forEach(c => { const m = mesesDe(LINEAS.filter(l => l.ceco === c)); d.push([c, DEP[c] || '', ...m, sum(m)]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d), 'Resumen por departamento');
  }
  XLSX.writeFile(wb, name);
}

// ---------- navegación ----------
function route() {
  if (!me || !LINEAS.length) return;
  const h = location.hash.slice(1);
  if (h === 'consolidado') view = 'cons';
  else if (h === 'accesos' && admin) view = 'acc';
  else { view = 'cap'; if (AREAS.some(a => a.k === h) && h !== cur) { cur = h; ceco = ''; $('q').value = ''; } }
  for (const [v, id] of [['cap', 'vCap'], ['cons', 'vCons'], ['acc', 'vAcc']]) $(id).classList.toggle('hidden', v !== view);
  if (view === 'cap') {
    const cecos = [...new Set(lineasArea(cur).map(l => l.ceco))].sort();
    $('fCeco').innerHTML = (cecos.length > 1 ? '<option value="">Todos los departamentos</option>' : '') + cecos.map(c => `<option value="${c}">${c} · ${esc(DEP[c] || '')}${capt[cur + '|' + c] === 'enviado' ? ' (enviado)' : ''}</option>`).join('');
    if (cecos.length === 1) ceco = cecos[0];
    $('fCeco').value = ceco; $('fCeco').classList.toggle('hidden', cecos.length < 2);
    buildGrid(); statusCap();
  } else if (view === 'cons') cons(); else accRender();
  strip();
}
$('strip').onclick = e => { const b = e.target.closest('.chip'); if (b) location.hash = b.dataset.k; };
window.addEventListener('hashchange', route);
$('fCeco').onchange = () => { ceco = $('fCeco').value; buildGrid(); statusCap(); };
$('q').oninput = filter;
$('grid').addEventListener('input', e => {
  const t = e.target; if (!t.dataset.id) return;
  if (t.dataset.m === 'nota') { setCell(t.dataset.id, 'nota', t.value); totals(); statusCap(); return; }
  const n = parseNum(t.value); if (isNaN(n)) return;
  setCell(t.dataset.id, +t.dataset.m, n); refreshRow(t.dataset.id); totals(); statusCap();
});
$('grid').addEventListener('focusout', e => {
  const t = e.target; if (!t.dataset.id || t.dataset.m === 'nota') return;
  if (isNaN(parseNum(t.value))) say('Ese valor no es un número; se dejó como estaba.', true);
  const id = t.dataset.id; setTimeout(() => refreshRow(id));
});
$('grid').addEventListener('click', e => { const g = e.target.closest('tr.grp td.c'); if (!g) return; g.parentElement.classList.toggle('open'); filter(); });
$('grid').addEventListener('paste', e => {
  const t = e.target; if (!t.dataset.id || t.disabled || t.dataset.m === 'nota') return;
  const txt = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(txt.trim())) return; e.preventDefault();
  const rows = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(r => r.split('\t'));
  const vis = rowsOrder.filter(id => !document.querySelector(`tr[data-id="${id}"]`).classList.contains('hide'));
  const ri = vis.indexOf(+t.dataset.id); let m0 = +t.dataset.m, n = 0; if (m0 === 12) m0 = 0;
  rows.forEach((r, i) => { const id = vis[ri + i]; if (id == null || !editable(byId[id])) return; r.forEach((c, j) => { const m = m0 + j; if (m > 11) return; const x = parseNum(c); if (!isNaN(x)) { setCell(id, m, x); n++; } }); refreshRow(id); });
  totals(); statusCap(); say(`Se pegaron ${n} celdas. Falta guardar.`);
});
$('grid').addEventListener('keydown', e => {
  const t = e.target; if (!t.dataset.id) return;
  if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const ins = [...document.querySelectorAll(`#tb input[data-m="${t.dataset.m}"]`)].filter(i => i.offsetParent && !i.disabled);
    const k = ins.indexOf(t) + (e.key === 'ArrowUp' ? -1 : 1); if (ins[k]) { ins[k].focus(); ins[k].select(); }
  }
});
$('bOpen').onclick = () => { const g = [...document.querySelectorAll('tr.grp')], open = g.some(r => !r.classList.contains('open')); g.forEach(r => r.classList.toggle('open', open)); $('bOpen').textContent = open ? 'Cerrar todo' : 'Abrir todo'; filter(); };
$('bSave').onclick = guardar;
$('bSend').onclick = async () => {
  if (!await confirma('bSend', '¿Confirmar envío?')) return;
  if (!await guardar()) return;
  const { error } = await sb.rpc('enviar', { p_area: cur, p_ejercicio: EJ });
  if (error) return say('No se pudo enviar: ' + error.message, true);
  await cargar(); say('Presupuesto enviado. La captura queda cerrada.');
};
$('bReopen').onclick = async () => {
  if (!await confirma('bReopen', ceco ? '¿Reabrir este departamento?' : '¿Reabrir toda el área?')) return;
  const { error } = await sb.rpc('reabrir', { p_area: cur, p_ceco: ceco || null, p_ejercicio: EJ });
  if (error) return say('No se pudo reabrir: ' + error.message, true);
  await cargar(); say('Captura reabierta.');
};
$('bReload').onclick = async () => { if (dirty.size && !await confirma('bReload', 'Perderás cambios. ¿Recargar?')) return; await cargar(); };
$('bXA').onclick = () => exportX(lineasVista(), `Presupuesto_${EJ}_${(AREAS.find(a => a.k === cur)?.nombre || cur).replace(/\W+/g, '_')}${ceco ? '_' + ceco : ''}.xlsx`, false);
$('bXT').onclick = () => exportX(LINEAS, `Presupuesto_${EJ}_Consolidado.xlsx`, true);
window.addEventListener('beforeunload', e => { if (dirty.size) { e.preventDefault(); e.returnValue = ''; } });
}
