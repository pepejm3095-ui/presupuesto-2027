// Presupuesto de gastos de operación 2027 · captura por área (Supabase)
{
const EJ = 2027;
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const $ = s => document.getElementById(s);
const fmt = new Intl.NumberFormat('es-MX', {maximumFractionDigits: 0});
const fmt2 = new Intl.NumberFormat('es-MX', {maximumFractionDigits: 2});
const money = v => (Math.round(v) < 0 ? '−$' : '$') + fmt.format(Math.abs(Math.round(v)));
const slug = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sum = a => (a || []).reduce((s, x) => s + (+x || 0), 0);
const ESTX = {ini:'Sin iniciar', cap:'En captura', par:'Envío parcial', env:'Enviado'};

const sb = window.supabase.createClient(window.CONFIG.url, window.CONFIG.key);
let me = null, accesos = [], admin = false;
let AREAS = [], DEP = {}, LINEAS = [], byId = {};
// Dos juegos de datos: presupuesto y gasto real. `montos` y `dirty` apuntan al de la pestaña activa.
const store = { ppto: { data: {}, dirty: new Set() }, real: { data: {}, dirty: new Set() } };
let montos = store.ppto.data;   // linea_id -> {m:[12], nota}
let dirty = store.ppto.dirty;
let modo = 'ppto';              // ppto | real | comp
let cierre = 0, corte = 0;      // último mes cerrado con real; mes elegido en el comparativo
try { const m = localStorage.getItem('modo'); if (['ppto', 'real', 'comp'].includes(m)) modo = m; } catch {}
function usarStore() { const x = store[modo === 'real' ? 'real' : 'ppto']; montos = x.data; dirty = x.dirty; }
let capt = {};      // `${area}|${ceco}` -> estado
let cur = null, ceco = '', view = 'cap', rowsOrder = [];

// ---------- utilidades de permisos (la base de datos los vuelve a validar) ----------
const misAcc = () => accesos.filter(a => a.email === me);
const puedeEditar = l => admin || misAcc().some(a => a.rol === 'captura' && a.area === l.area && (!a.ceco || a.ceco === l.ceco));
const cerrado = l => capt[l.area + '|' + l.ceco] === 'enviado';
const editablePpto = l => admin || (puedeEditar(l) && !cerrado(l));
const editable = l => modo === 'real' ? admin : editablePpto(l);
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
    const [acc, ar, dp, li, mo, ca, re, ej] = await Promise.all([
      todo(() => sb.from('accesos').select('*').order('email')),
      todo(() => sb.from('areas').select('*').order('orden')),
      todo(() => sb.from('departamentos').select('*').order('ceco')),
      todo(() => sb.from('lineas').select('*').order('id')),
      todo(() => sb.from('montos').select('linea_id,m,nota,actualizado,actualizado_por').eq('ejercicio', EJ)),
      todo(() => sb.from('capturas').select('area,ceco,estado').eq('ejercicio', EJ)),
      todo(() => sb.from('reales').select('linea_id,m,nota,actualizado,actualizado_por').eq('ejercicio', EJ)),
      todo(() => sb.from('ejercicios').select('mes_cierre').eq('ejercicio', EJ)),
    ]);
    accesos = acc; admin = acc.some(a => a.email === me && a.rol === 'admin');
    DEP = Object.fromEntries(dp.map(d => [d.ceco, d.nombre]));
    LINEAS = li; ordenar();
    const visibles = new Set(li.map(l => l.area));
    AREAS = ar.filter(a => visibles.has(a.k));
    const aMapa = rows => { const o = {}; for (const r of rows) o[r.linea_id] = { m: r.m.map(Number), nota: r.nota || '', ts: r.actualizado, por: r.actualizado_por }; return o; };
    store.ppto.data = aMapa(mo); store.real.data = aMapa(re);
    store.ppto.dirty.clear(); store.real.dirty.clear();
    cierre = ej[0]?.mes_cierre || 0;
    if (modo === 'real' && !admin) modo = 'comp';
    usarStore();
    capt = {}; for (const c of ca) capt[c.area + '|' + c.ceco] = c.estado;
  } catch (e) { say('No se pudo cargar la información: ' + e.message, true); return; }
  if (!LINEAS.length) {
    $('sinAcceso').classList.remove('hidden'); $('main').classList.add('hidden'); $('strip').innerHTML = ''; return;
  }
  $('sinAcceso').classList.add('hidden'); $('main').classList.remove('hidden');
  if (!AREAS.some(a => a.k === cur) && !(cur === TODAS && verTodas())) cur = admin ? TODAS : AREAS[0].k;
  route();
}

function ordenar() {
  const max = {};
  for (const l of LINEAS) if (l.origen !== 'usuario') max[l.rubro] = Math.max(max[l.rubro] || 0, l.id);
  const key = l => l.origen === 'usuario' ? (max[l.rubro] ?? 1e9) + l.id / 1e7 : l.id;
  LINEAS.sort((a, b) => key(a) - key(b));
  byId = Object.fromEntries(LINEAS.map(l => [l.id, l]));
}
const borrable = l => l.origen === 'usuario' && editablePpto(l);

// ---------- estado y totales ----------
function lineasArea(k) { return k === TODAS ? LINEAS : LINEAS.filter(l => l.area === k); }
const TODAS = 'todas';
const nombreArea = k => k === TODAS ? 'Todas las áreas' : (AREAS.find(a => a.k === k)?.nombre || k);
const verTodas = () => admin || AREAS.length > 1;
function estado(k) {
  if (k === TODAS) { const es = AREAS.map(a => estado(a.k)); if (es.every(e => e === 'env')) return 'env'; if (es.some(e => e === 'env' || e === 'par')) return 'par'; return es.some(e => e === 'cap') ? 'cap' : 'ini'; }
  const cecos = [...new Set(lineasArea(k).map(l => l.ceco))];
  const env = cecos.filter(c => capt[k + '|' + c] === 'enviado').length;
  if (env && env === cecos.length) return 'env';
  if (env) return 'par';
  return lineasArea(k).some(l => store.ppto.data[l.id]) ? 'cap' : 'ini';
}
const mesesDe = ls => { const m = Array(12).fill(0); for (const l of ls) { const v = montos[l.id]; if (v) v.m.forEach((x, i) => m[i] += +x || 0); } return m; };

function strip() {
  const dots = { ini: '', cap: 'cap', par: 'cap', env: 'env' };
  const chips = verTodas() ? [{ k: TODAS, nombre: 'Todas las áreas' }, ...AREAS] : AREAS;
  let h = chips.map(a => {
    const e = estado(a.k), t = sum(mesesDe(lineasArea(a.k)));
    const d = lineasArea(a.k).some(l => dirty.has(l.id));
    return `<button class="chip" type="button" data-k="${a.k}" aria-current="${view === 'cap' && cur === a.k}"><b>${esc(a.nombre)}${d ? ' •' : ''}</b><span class="amt">${money(t)}</span><span class="st"><i class="dot ${dots[e]}"></i>${ESTX[e]}</span></button>`;
  }).join('');
  if (verTodas()) h += `<button class="chip all" type="button" data-k="consolidado" aria-current="${view === 'cons'}"><b>Consolidado</b><span class="amt">${money(sum(mesesDe(LINEAS)))}</span><span class="st">${AREAS.filter(a => estado(a.k) === 'env').length} de ${AREAS.length} áreas enviadas</span></button>`;
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
  h += `</tbody><tfoot><tr><td class="c">Total ${esc(nombreArea(cur))}${ceco ? ' · ' + esc(DEP[ceco]) : ''}</td><td></td>${MES.map((_, i) => `<td data-ft="${i}"></td>`).join('')}<td data-ft="12"></td><td></td></tr></tfoot></table>`;
  $('grid').innerHTML = h;
  filter(); totals();
}
function row(l, gid) {
  rowsOrder.push(l.id);
  const v = val(l.id), tot = sum(v.m), dep = DEP[l.ceco] || '', ro = editable(l) ? '' : 'disabled';
  const tag = l.llenado_por === 'OPERACIONES/VENTAS' ? ' · Operaciones/Ventas' : '';
  const q = (l.concepto + ' ' + (l.descripcion || '') + ' ' + (l.cuenta || '') + ' ' + l.ceco + ' ' + dep + ' ' + l.rubro).toLowerCase();
  return `<tr data-id="${l.id}" data-q="${esc(q)}" class="${gid ? 'kid hide' : ''}" ${gid ? `data-p="${gid}"` : ''}><td class="c">${esc(gid ? dep || l.ceco : l.concepto)}<small>${esc(gid ? l.descripcion : [l.cuenta, l.descripcion].filter(Boolean).join(' · ') || 'Sin cuenta asignada')}${tag}${cur === TODAS ? ' · ' + esc(nombreArea(l.area)) : ''}${cerrado(l) ? ' · enviado' : ''}${l.origen === 'usuario' ? ' · línea agregada por ' + esc(l.creada_por || '') : ''}</small>${borrable(l) ? `<button class="btn sm warn quitar" type="button" data-quitar="${l.id}">Quitar línea</button>` : ''}</td><td class="ceco">${esc(l.ceco)}</td>` +
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
  const ls = lineasVista();
  const puede = ls.some(puedeEditar), e = estado(cur);
  let ult = null; for (const l of ls) { const v = montos[l.id]; if (v?.ts && (!ult || v.ts > ult.ts)) ult = v; }
  say(dirty.size ? `Hay ${dirty.size} partida(s) con cambios sin guardar.` :
    (ult ? `Última modificación ${new Date(ult.ts).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })} por ${ult.por}.` : 'Aún no hay montos capturados.') +
    (!puede && modo !== 'real' ? ' Acceso de solo consulta.' : ''));
  const real = modo === 'real';
  $('bSend').classList.toggle('hidden', real || cur === TODAS || !puede || e === 'env');
  $('bReopen').classList.toggle('hidden', real || cur === TODAS || !admin || (e !== 'env' && e !== 'par'));
  $('lCierre').classList.toggle('hidden', !real || !admin);
  $('fCierre').value = String(cierre);
  $('bSave').classList.toggle('hidden', !ls.some(editable));
  $('bNueva').classList.toggle('hidden', !areasAlta().length);
  $('tArea').textContent = (real ? 'Real · ' : '') + nombreArea(cur);
  $('estadoArea').textContent = real ? (cierre ? 'Cerrado a ' + MES[cierre - 1] : 'Sin mes cerrado') : ESTX[e];
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
    const tabla = modo === 'real' ? 'reales' : 'montos';
    if (up.length) { const { error } = await sb.from(tabla).upsert(up, { onConflict: 'ejercicio,linea_id' }); if (error) throw error; }
    if (del.length) { const { error } = await sb.from(tabla).delete().eq('ejercicio', EJ).in('linea_id', del); if (error) throw error; }
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
// Columnas de la plantilla: A=ID (fila del formato oficial), B..H descriptivas, I..T meses, U total, V nota
const COL_MES = 8;
function exportX(ls, name, conResumen) {
  const head = ['ID', 'Rubro', 'Concepto', 'Cuenta', 'Descripción cuenta contable', 'CECO', 'Departamento', 'Llenado por', ...MES.map(m => m + ' ' + EJ), 'Total ' + EJ, 'Nota'];
  const rows = ls.map(l => { const v = val(l.id); return [l.id, l.rubro, l.concepto, l.cuenta || '', l.descripcion || '', l.ceco, DEP[l.ceco] || '', l.llenado_por, ...v.m.map(x => +x || 0), 0, v.nota]; });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[window.CONFIG.empresa], [(modo === 'real' ? 'GASTO REAL DE OPERACIÓN' : 'PRESUPUESTO GASTOS DE OPERACIÓN') + ' · EJERCICIO ' + EJ],
    ['Captura los importes en pesos sin IVA en las columnas de los meses y vuelve a subir este archivo con "Cargar Excel". No cambies la columna ID.'], head, ...rows]);
  const H = 4; // filas antes de los datos
  rows.forEach((_, i) => {
    const R = H + i, a = XLSX.utils.encode_cell({ r: R, c: COL_MES }), b = XLSX.utils.encode_cell({ r: R, c: COL_MES + 11 });
    ws[XLSX.utils.encode_cell({ r: R, c: COL_MES + 12 })] = { t: 'n', f: `SUM(${a}:${b})`, v: sum(val(ls[i].id).m) };
    for (let C = COL_MES; C <= COL_MES + 12; C++) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c) c.z = '#,##0.00'; }
  });
  ws['!cols'] = [{ wch: 6, hidden: false }, { wch: 24 }, { wch: 32 }, { wch: 16 }, { wch: 30 }, { wch: 7 }, { wch: 20 }, { wch: 15 }, ...Array(13).fill({ wch: 13 }), { wch: 40 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: H + rows.length - 1, c: COL_MES + 13 } }) };
  ws['!freeze'] = { xSplit: 3, ySplit: 4 };
  XLSX.utils.book_append_sheet(wb, ws, 'Captura');
  if (conResumen) {
    const s = [['Área', ...MES, 'Total', 'Estado']]; AREAS.forEach(a => { const m = mesesDe(lineasArea(a.k)); s.push([a.nombre, ...m, sum(m), ESTX[estado(a.k)]]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s), 'Resumen por área');
    const d = [['CECO', 'Departamento', ...MES, 'Total']]; [...new Set(LINEAS.map(l => l.ceco))].sort().forEach(c => { const m = mesesDe(LINEAS.filter(l => l.ceco === c)); d.push([c, DEP[c] || '', ...m, sum(m)]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d), 'Resumen por departamento');
  }
  XLSX.writeFile(wb, name);
}

// ---------- cargar desde Excel ----------
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
function celdaNum(c) {
  if (c == null || c.v == null || c.v === '') return { n: 0 };
  if (typeof c.v === 'number') return { n: Math.round(c.v * 100) / 100 };
  const n = parseNum(c.v); return isNaN(n) ? { err: String(c.v) } : { n: Math.round(n * 100) / 100 };
}
// Devuelve [{id, m:[12], nota?, fila}] y errores, a partir de la plantilla o del formato oficial
function leerLibro(wb, conFormato) {
  const errores = [], filas = [];
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre]; if (!ws['!ref']) continue;
    const rg = XLSX.utils.decode_range(ws['!ref']);
    const cel = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
    // 1) Plantilla: encabezado con "ID" en la columna A y meses a partir de la I
    let hdr = -1;
    for (let r = 0; r <= Math.min(rg.e.r, 15); r++) if (norm(cel(r, 0)?.v) === 'ID' && norm(cel(r, COL_MES)?.v).startsWith('ENE')) { hdr = r; break; }
    if (hdr >= 0) {
      const notaCol = [...Array(rg.e.c + 1).keys()].find(c => norm(cel(hdr, c)?.v) === 'NOTA');
      for (let r = hdr + 1; r <= rg.e.r; r++) {
        const id = +cel(r, 0)?.v; if (!id || !byId[id]) continue;
        const m = []; let ok = true;
        for (let i = 0; i < 12; i++) { const x = celdaNum(cel(r, COL_MES + i)); if (x.err) { errores.push(`Fila ${r + 1}, ${MES[i]}: "${x.err}" no es número`); ok = false; } m.push(x.n || 0); }
        if (ok) filas.push({ id, m, nota: notaCol != null ? String(cel(r, notaCol)?.v ?? '').trim() : undefined, fila: r + 1 });
      }
      return { formato: 'Plantilla de la página', hoja: nombre, filas, errores };
    }
    // 2) Formato oficial: meses ENERO..DICIEMBRE en J..U (fila 6); el número de fila es el ID
    let fm = -1;
    for (let r = 0; r <= Math.min(rg.e.r, 15); r++) if (norm(cel(r, 9)?.v) === 'ENERO' && norm(cel(r, 20)?.v) === 'DICIEMBRE') { fm = r; break; }
    if (fm >= 0 && conFormato) {
      for (let r = fm + 1; r <= rg.e.r; r++) {
        const id = r + 1, l = byId[id]; if (!l) continue;
        const concepto = norm(cel(r, 2)?.v);
        if (concepto && concepto !== norm(l.concepto)) { errores.push(`Fila ${id}: el concepto "${cel(r, 2).v}" no coincide con "${l.concepto}"; se ignoró (¿se insertaron filas en el formato?)`); continue; }
        const ceco = norm(cel(r, 5)?.v);
        if (ceco && ceco !== l.ceco) { errores.push(`Fila ${id}: CECO ${ceco} no coincide con ${l.ceco}; se ignoró`); continue; }
        const m = []; let ok = true;
        for (let i = 0; i < 12; i++) { const x = celdaNum(cel(r, 9 + i)); if (x.err) { errores.push(`Fila ${id}, ${MES[i]}: "${x.err}" no es número`); ok = false; } m.push(x.n || 0); }
        if (ok) filas.push({ id, m, fila: id });
      }
      return { formato: 'Formato oficial 2027', hoja: nombre, filas, errores };
    }
  }
  return null;
}
let pendiente = null;
async function cargarArchivo(f) {
  say('Leyendo ' + f.name + '…');
  let wb; try { wb = XLSX.read(await f.arrayBuffer(), { cellFormula: false }); } catch { return say('No pude leer el archivo. ¿Es un Excel (.xlsx o .xls)?', true); }
  const r = leerLibro(wb, modo !== 'real');
  if (!r) return say(modo === 'real' ? 'No reconozco el archivo: para el real usa la plantilla que descargas con "Descargar plantilla" en la pestaña Real.' : 'No reconozco el archivo: usa la plantilla que descargas con "Descargar plantilla" o el formato oficial de presupuesto 2027 sin modificar columnas.', true);
  const visibles = new Set(lineasVista().map(l => l.id));
  const cambios = [], sinPermiso = [], fuera = [];
  for (const x of r.filas) {
    const l = byId[x.id];
    if (!visibles.has(x.id)) { if (x.m.some(n => n) || x.nota) fuera.push(x); continue; }
    const v = val(x.id), cambiaM = x.m.some((n, i) => Math.abs(n - (+v.m[i] || 0)) > 0.004), cambiaN = x.nota !== undefined && x.nota !== v.nota;
    if (!cambiaM && !cambiaN) continue;
    if (!editable(l)) { sinPermiso.push(x); continue; }
    cambios.push({ ...x, antes: sum(v.m), despues: sum(x.m) });
  }
  pendiente = cambios;
  const antes = sum(cambios.map(c => c.antes)), despues = sum(cambios.map(c => c.despues));
  const lista = cambios.slice(0, 200).map(c => { const l = byId[c.id]; return `<tr><td>${c.fila}</td><td>${esc(l.concepto)}<small> · ${esc(l.ceco)} ${esc(DEP[l.ceco] || '')}</small></td><td>${fmt.format(c.antes)}</td><td><b>${fmt.format(c.despues)}</b></td></tr>`; }).join('');
  $('impBox').classList.remove('hidden');
  $('impRes').innerHTML = `<p><b>${esc(f.name)}</b> · ${modo === 'real' ? '<b>Gasto real</b> · ' : ''}${r.formato} (hoja "${esc(r.hoja)}")</p>
    <p class="num-big" style="font-size:22px;margin:4px 0">${cambios.length} partida(s) con cambios · ${money(antes)} → ${money(despues)}</p>
    <ul class="help" style="margin:6px 0 10px">
      ${fuera.length ? `<li>${fuera.length} partida(s) con datos que no son de esta vista (${esc(nombreArea(cur))}${ceco ? ' · ' + esc(ceco) : ''}); no se tocan.</li>` : ''}
      ${sinPermiso.length ? `<li>${sinPermiso.length} partida(s) sin permiso o ya enviadas; no se tocan.</li>` : ''}
      ${r.errores.length ? `<li class="err">${r.errores.length} aviso(s): ${r.errores.slice(0, 5).map(esc).join(' · ')}${r.errores.length > 5 ? ' …' : ''}</li>` : ''}
    </ul>
    ${cambios.length ? `<div class="grid" style="max-height:260px"><table class="cons"><thead><tr><th>Fila</th><th>Partida</th><th>Antes</th><th>Después</th></tr></thead><tbody>${lista}</tbody></table></div>` : '<p>No hay nada que cambiar.</p>'}`;
  $('bImpOk').disabled = !cambios.length;
  say('Revisa los cambios del archivo antes de aplicarlos.');
  $('impBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('bImp').onclick = () => { $('fImp').value = ''; $('fImp').click(); };
$('fImp').onchange = () => { const f = $('fImp').files[0]; if (f) cargarArchivo(f); };
$('grid').addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); $('grid').classList.add('drop'); } });
$('grid').addEventListener('dragleave', () => $('grid').classList.remove('drop'));
$('grid').addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault(); $('grid').classList.remove('drop'); cargarArchivo(f); });
$('bImpNo').onclick = () => { pendiente = null; $('impBox').classList.add('hidden'); statusCap(); };
$('bImpOk').onclick = async () => {
  if (!pendiente?.length) return;
  for (const c of pendiente) {
    const v = montos[c.id] || (montos[c.id] = { m: Array(12).fill(0), nota: '' });
    v.m = c.m.slice(); if (c.nota !== undefined) v.nota = c.nota; dirty.add(c.id);
  }
  const n = pendiente.length; pendiente = null; $('impBox').classList.add('hidden');
  buildGrid();
  if (await guardar()) say(`Se cargaron y guardaron ${n} partida(s) desde Excel.`);
};


// ---------- agregar líneas ----------
// áreas y CECO donde el usuario puede dar de alta (los mismos donde puede capturar y que no estén enviados)
function areasAlta() {
  const ks = cur === TODAS ? AREAS.map(a => a.k) : [cur];
  return ks.filter(k => cecosAlta(k).length);
}
function cecosAlta(k) {
  return Object.keys(DEP).sort().filter(c => (ceco ? c === ceco : true) &&
    (admin || (misAcc().some(a => a.rol === 'captura' && a.area === k && (!a.ceco || a.ceco === c)) && capt[k + '|' + c] !== 'enviado')));
}
function nlCecos() {
  const k = $('nlArea').value;
  $('nlCeco').innerHTML = cecosAlta(k).map(c => `<option value="${c}">${c} · ${esc(DEP[c] || '')}</option>`).join('');
}
$('bNueva').onclick = () => {
  const ks = areasAlta();
  $('nlArea').innerHTML = ks.map(k => `<option value="${k}">${esc(nombreArea(k))}</option>`).join('');
  $('nlAreaL').classList.toggle('hidden', ks.length < 2);
  $('nlRubro').innerHTML = [...new Set(LINEAS.filter(l => l.origen !== 'usuario').map(l => l.rubro))].map(r => `<option>${esc(r)}</option>`).join('');
  const cuentas = {}; for (const l of LINEAS) if (l.cuenta && l.cuenta !== 'N/A') cuentas[l.cuenta] = l.descripcion || '';
  $('nlCuentas').innerHTML = Object.entries(cuentas).sort().map(([k, d]) => `<option value="${esc(k)}">${esc(d)}</option>`).join('');
  nlCecos(); $('fNueva').reset(); $('nlArea').value = ks[0]; nlCecos();
  $('nlBox').classList.remove('hidden'); $('nlConcepto').focus(); say('', false, 'msgNl');
};
$('nlArea').onchange = nlCecos;
$('nlCuenta').oninput = () => { const v = $('nlCuenta').value.trim(); const l = LINEAS.find(x => x.cuenta === v); if (l && !$('nlDesc').value) $('nlDesc').value = l.descripcion || ''; };
$('bNlNo').onclick = () => $('nlBox').classList.add('hidden');
$('fNueva').onsubmit = async e => {
  e.preventDefault();
  const row = { area: $('nlArea').value, rubro: $('nlRubro').value, concepto: $('nlConcepto').value.trim(), cuenta: $('nlCuenta').value.trim() || null,
    descripcion: $('nlDesc').value.trim() || null, ceco: $('nlCeco').value, llenado_por: '-' };
  if (!row.concepto) return say('Escribe el concepto.', true, 'msgNl');
  if (!row.ceco) return say('Elige el departamento.', true, 'msgNl');
  const dup = LINEAS.find(l => l.area === row.area && l.ceco === row.ceco && l.concepto === row.concepto.toUpperCase());
  if (dup) return say('Ya existe esa partida para ese departamento.', true, 'msgNl');
  say('Agregando…', false, 'msgNl');
  const { data, error } = await sb.from('lineas').insert(row).select().single();
  if (error) return say('No se pudo agregar: ' + (error.message.includes('row-level') ? 'no tienes permiso en esa área/departamento o ya fue enviada.' : error.message), true, 'msgNl');
  LINEAS.push(data); ordenar();
  if (!AREAS.some(a => a.k === data.area)) return cargar();
  $('nlBox').classList.add('hidden');
  buildGrid(); statusCap();
  say(`Línea agregada: ${data.concepto} (${data.ceco}). Captura sus importes y guarda.`);
  const inp = document.querySelector(`tr[data-id="${data.id}"] input[data-m="0"]`);
  if (inp) { inp.closest('tr').classList.remove('hide'); inp.scrollIntoView({ block: 'center' }); inp.focus(); }
};
$('grid').addEventListener('click', async e => {
  const b = e.target.closest('[data-quitar]'); if (!b) return;
  if (b.dataset.c !== '1') { b.dataset.c = '1'; b.textContent = '¿Quitar con sus importes?'; setTimeout(() => { b.dataset.c = ''; b.textContent = 'Quitar línea'; }, 4000); return; }
  const id = +b.dataset.quitar;
  const { error, count } = await sb.from('lineas').delete({ count: 'exact' }).eq('id', id);
  if (error || !count) return say('No se pudo quitar la línea' + (error ? ': ' + error.message : ' (sin permiso o ya enviada).'), true);
  LINEAS = LINEAS.filter(l => l.id !== id); for (const x of Object.values(store)) { delete x.data[id]; x.dirty.delete(id); } ordenar();
  buildGrid(); statusCap(); say('Línea quitada.');
});


// ---------- pestañas y comparativo ----------
function opcionesCeco(id) {
  const cecos = [...new Set(lineasArea(cur).map(l => l.ceco))].sort();
  if (ceco && !cecos.includes(ceco)) ceco = '';
  $(id).innerHTML = (cecos.length > 1 ? '<option value="">Todos los departamentos</option>' : '') + cecos.map(c => `<option value="${c}">${c} · ${esc(DEP[c] || '')}${id === 'fCeco' && modo === 'ppto' && capt[cur + '|' + c] === 'enviado' ? ' (enviado)' : ''}</option>`).join('');
  if (cecos.length === 1) ceco = cecos[0];
  $(id).value = ceco; $(id).classList.toggle('hidden', cecos.length < 2);
}
function modosRender() {
  const ms = [['ppto', 'Presupuesto'], ...(admin ? [['real', 'Real']] : []), ['comp', 'Comparativo']];
  $('modos').innerHTML = ms.map(([k, n]) => `<button type="button" role="tab" data-modo="${k}" aria-selected="${view === 'cap' && modo === k}">${n}</button>`).join('');
}
$('modos').onclick = e => {
  const b = e.target.closest('[data-modo]'); if (!b) return;
  modo = b.dataset.modo; try { localStorage.setItem('modo', modo); } catch {}
  usarStore(); $('impBox').classList.add('hidden'); $('nlBox').classList.add('hidden');
  if (view !== 'cap' || location.hash.slice(1) !== cur) location.hash = cur; else route();
};
$('fCierre').onchange = async () => {
  const v = +$('fCierre').value;
  const { error } = await sb.from('ejercicios').update({ mes_cierre: v, actualizado: new Date().toISOString(), actualizado_por: me }).eq('ejercicio', EJ);
  if (error) { $('fCierre').value = String(cierre); return say('No se pudo cambiar el mes de cierre: ' + error.message, true); }
  cierre = v; corte = 0; statusCap();
  say(v ? `Mes de cierre: ${MES[v - 1]}. Las áreas ya ven el comparativo hasta ese mes.` : 'Sin mes cerrado: las áreas no ven el comparativo todavía.');
};
const pctTxt = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : (a ? 'sin ppto' : '—');
const varTd = (v, base) => `<td class="${v > 0.5 ? 'over' : ''}">${v ? (v > 0 ? '+' : '') + fmt.format(v) : '—'}</td><td class="${v > 0.5 ? 'over' : ''}">${pctTxt(v, base)}</td>`;
function ultimoReal() { let u = 0; for (const v of Object.values(store.real.data)) v.m.forEach((x, i) => { if (x) u = Math.max(u, i + 1); }); return u; }
function compFilas(ls, c, acum) {
  const P = store.ppto.data, R = store.real.data, i0 = acum ? 0 : c - 1;
  return ls.map(l => {
    const p = P[l.id]?.m || [], r = R[l.id]?.m || []; let pp = 0, rr = 0;
    for (let i = i0; i < c; i++) { pp += +p[i] || 0; rr += +r[i] || 0; }
    let ra = 0; for (let i = 0; i < c; i++) ra += +r[i] || 0;
    return { l, p: pp, r: rr, anual: sum(p), ra, nota: R[l.id]?.nota || '' };
  });
}
function resumen(filas, clave, nombre) {
  const g = {}; for (const f of filas) { const k = clave(f.l); const x = g[k] || (g[k] = { n: nombre(k), p: 0, r: 0, anual: 0, ra: 0 }); x.p += f.p; x.r += f.r; x.anual += f.anual; x.ra += f.ra; }
  return Object.values(g);
}
function tablaComp(titulo, grupos) {
  const T = grupos.reduce((a, x) => ({ p: a.p + x.p, r: a.r + x.r, anual: a.anual + x.anual, ra: a.ra + x.ra }), { p: 0, r: 0, anual: 0, ra: 0 });
  const fila = (x, cls = '') => `<tr class="${cls}"><td>${esc(x.n)}</td><td>${fmt.format(x.p)}</td><td>${fmt.format(x.r)}</td>${varTd(x.r - x.p, x.p)}<td>${fmt.format(x.anual)}</td><td>${pctTxt(x.ra, x.anual)}</td></tr>`;
  return `<thead><tr><th>${titulo}</th><th>Presupuesto</th><th>Real</th><th>Variación</th><th>Var %</th><th>Ppto anual</th><th>Ejercido del anual</th></tr></thead><tbody>${grupos.map(x => fila(x)).join('')}${fila({ n: 'Total', ...T }, 'tot')}</tbody>`;
}
function comp() {
  const maxMes = admin ? 12 : cierre;
  $('compCtl').classList.toggle('hidden', !maxMes);
  if (!maxMes) { $('compBody').innerHTML = '<p class="help">Aún no hay meses cerrados con gasto real. Finanzas lo publicará al cerrar cada mes.</p>'; return; }
  if (!corte || corte > maxMes) corte = Math.min(maxMes, cierre || ultimoReal() || 1);
  $('cMes').innerHTML = MES.slice(0, maxMes).map((m, i) => `<option value="${i + 1}">${m} ${EJ}${i + 1 === cierre ? ' (cierre)' : ''}</option>`).join('');
  $('cMes').value = String(corte);
  const acum = $('cModo').value === 'acum', solo = $('cSolo').checked;
  const ls = lineasVista();
  const filas = compFilas(ls, corte, acum).filter(f => !solo || f.p || f.r || f.anual || f.ra);
  const P = sum(filas.map(f => f.p)), R = sum(filas.map(f => f.r)), A = sum(filas.map(f => f.anual)), RA = sum(filas.map(f => f.ra)), V = R - P;
  const per = acum ? `Ene–${MES[corte - 1]} ${EJ}` : `${MES[corte - 1]} ${EJ}`;
  // mensual
  const pm = Array(12).fill(0), rm = Array(12).fill(0);
  for (const l of ls) { const p = store.ppto.data[l.id]?.m, r = store.real.data[l.id]?.m; if (p) p.forEach((x, i) => pm[i] += +x || 0); if (r) r.forEach((x, i) => rm[i] += +x || 0); }
  const top = Math.max(1, ...pm, ...rm.slice(0, corte));
  const barras = MES.map((m, i) => {
    const conReal = i < corte, over = conReal && rm[i] > pm[i] + 0.5;
    return `<div class="mb" title="${m}: ppto ${fmt.format(pm[i])}${conReal ? ' · real ' + fmt.format(rm[i]) : ''}"><div class="mbp"><i class="bp" style="height:${pm[i] / top * 100}%"></i><i class="br ${over ? 'over' : ''}" style="height:${conReal ? rm[i] / top * 100 : 0}%"></i></div><span class="${i + 1 === corte ? 'sel' : ''}">${m}</span></div>`;
  }).join('');
  // detalle por rubro
  let det = '', sec = null, sp = 0, sr = 0;
  const cierraSec = () => sec !== null ? `<tr class="sec2"><td colspan="2">Total ${esc(sec)}</td><td>${fmt.format(sp)}</td><td>${fmt.format(sr)}</td>${varTd(sr - sp, sp)}<td colspan="3"></td></tr>` : '';
  for (const f of filas) {
    const l = f.l;
    if (l.rubro !== sec) { det += cierraSec(); sec = l.rubro; sp = 0; sr = 0; det += `<tr class="sec"><td colspan="10">${esc(sec)}</td></tr>`; }
    sp += f.p; sr += f.r;
    det += `<tr><td>${esc(l.concepto)}<small>${esc([l.cuenta, cur === TODAS ? nombreArea(l.area) : ''].filter(Boolean).join(' · '))}</small></td><td>${esc(l.ceco)}<small>${esc(DEP[l.ceco] || '')}</small></td><td>${fmt.format(f.p)}</td><td>${fmt.format(f.r)}</td>${varTd(f.r - f.p, f.p)}<td>${fmt.format(f.anual)}</td><td>${pctTxt(f.ra, f.anual)}</td><td class="tl">${esc(f.nota)}</td></tr>`;
  }
  det += cierraSec();
  const porArea = cur === TODAS ? `<h3>Por área · ${per}</h3><div class="grid" style="max-height:none"><table class="cons">${tablaComp('Área', resumen(filas, l => l.area, nombreArea))}</table></div>` : '';
  const porDep = `<h3>Por departamento · ${per}</h3><div class="grid" style="max-height:none"><table class="cons">${tablaComp('Departamento', resumen(filas, l => l.ceco, c => c + ' · ' + (DEP[c] || '')).sort((a, b) => a.n.localeCompare(b.n)))}</table></div>`;
  $('compBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>Presupuesto ${per}</span><b>${money(P)}</b></div>
      <div class="kpi"><span>Real ${per}</span><b>${money(R)}</b></div>
      <div class="kpi ${V > 0.5 ? 'over' : ''}"><span>Variación (real − ppto)</span><b>${V > 0.5 ? '+' : ''}${money(V)}</b><em>${pctTxt(V, P)} ${V > 0.5 ? 'arriba del presupuesto' : V < -0.5 ? 'abajo del presupuesto' : ''}</em></div>
      <div class="kpi"><span>Ejercido del presupuesto anual</span><b>${pctTxt(RA, A)}</b><em>${money(RA)} de ${money(A)}</em></div>
    </div>
    <div class="mbars" aria-label="Presupuesto contra real por mes">${barras}</div>
    <p class="leyenda"><i class="bp"></i> Presupuesto <i class="br"></i> Real <i class="br over"></i> Real arriba del presupuesto</p>
    ${porArea}
    <h3>Detalle por partida · ${per}</h3>
    <div class="grid"><table class="cons comp-det"><thead><tr><th>Partida</th><th>CECO</th><th>Presupuesto</th><th>Real</th><th>Variación</th><th>Var %</th><th>Ppto anual</th><th>Ejercido</th><th class="tl">Nota del real</th></tr></thead><tbody>${det || '<tr><td colspan="9">Sin partidas con importe.</td></tr>'}</tbody></table></div>
    ${porDep}`;
  window.__compFilas = { filas, per };
}
['cMes', 'cModo', 'cSolo'].forEach(id => $(id).onchange = () => { if (id === 'cMes') corte = +$('cMes').value; comp(); });
$('cCeco').onchange = () => { ceco = $('cCeco').value; comp(); };
$('bXC').onclick = () => {
  const { filas, per } = window.__compFilas || {}; if (!filas) return;
  const head = ['ID', 'Rubro', 'Concepto', 'Cuenta', 'CECO', 'Departamento', 'Área', 'Presupuesto', 'Real', 'Variación', 'Var %', 'Ppto anual', 'Ejercido %', 'Nota del real'];
  const rows = filas.map(f => [f.l.id, f.l.rubro, f.l.concepto, f.l.cuenta || '', f.l.ceco, DEP[f.l.ceco] || '', nombreArea(f.l.area), f.p, f.r, f.r - f.p, f.p ? (f.r - f.p) / f.p : null, f.anual, f.anual ? f.ra / f.anual : null, f.nota]);
  const ws = XLSX.utils.aoa_to_sheet([[window.CONFIG.empresa], ['COMPARATIVO PRESUPUESTO VS REAL · ' + per + ' · ' + nombreArea(cur) + (ceco ? ' · ' + ceco : '')], [], head, ...rows]);
  for (let R = 4; R < rows.length + 4; R++) { for (const C of [7, 8, 9, 11]) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c) c.z = '#,##0.00'; } for (const C of [10, 12]) { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c) c.z = '0.0%'; } }
  ws['!cols'] = [{ wch: 7 }, { wch: 24 }, { wch: 32 }, { wch: 16 }, { wch: 7 }, { wch: 20 }, { wch: 16 }, ...Array(6).fill({ wch: 14 }), { wch: 40 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Comparativo');
  const dep = [['Departamento', 'Presupuesto', 'Real', 'Variación', 'Ppto anual']]; resumen(filas, l => l.ceco, c => c + ' · ' + (DEP[c] || '')).forEach(x => dep.push([x.n, x.p, x.r, x.r - x.p, x.anual]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dep), 'Por departamento');
  if (cur === TODAS) { const ar = [['Área', 'Presupuesto', 'Real', 'Variación', 'Ppto anual']]; resumen(filas, l => l.area, nombreArea).forEach(x => ar.push([x.n, x.p, x.r, x.r - x.p, x.anual])); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ar), 'Por área'); }
  XLSX.writeFile(wb, `Comparativo_${EJ}_${MES[corte - 1]}_${slug(nombreArea(cur))}.xlsx`);
};

// ---------- navegación ----------
function route() {
  if (!me || !LINEAS.length) return;
  const h = location.hash.slice(1);
  if (h === 'consolidado') view = 'cons';
  else if (h === 'accesos' && admin) view = 'acc';
  else { view = 'cap'; if ((AREAS.some(a => a.k === h) || (h === TODAS && verTodas())) && h !== cur) { cur = h; ceco = ''; $('q').value = ''; } }
  if (view === 'cons' && modo !== 'ppto') { modo = 'ppto'; usarStore(); }
  const vista = view === 'cap' && modo === 'comp' ? 'comp' : view;
  for (const [v, id] of [['cap', 'vCap'], ['comp', 'vComp'], ['cons', 'vCons'], ['acc', 'vAcc']]) $(id).classList.toggle('hidden', v !== vista);
  modosRender();
  if (vista === 'comp') { opcionesCeco('cCeco'); comp(); }
  else if (view === 'cap') {
    const cecos = [...new Set(lineasArea(cur).map(l => l.ceco))].sort();
    opcionesCeco('fCeco');
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
$('bReload').onclick = async () => { if ((store.ppto.dirty.size || store.real.dirty.size) && !await confirma('bReload', 'Perderás cambios. ¿Recargar?')) return; await cargar(); };
$('bXA').onclick = () => exportX(lineasVista(), `${modo === 'real' ? 'Real' : 'Plantilla'}_${EJ}_${slug(nombreArea(cur))}${ceco ? '_' + ceco : ''}.xlsx`, false);
$('bXT').onclick = () => exportX(LINEAS, `Presupuesto_${EJ}_Consolidado.xlsx`, true);
window.addEventListener('beforeunload', e => { if (store.ppto.dirty.size || store.real.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
}
