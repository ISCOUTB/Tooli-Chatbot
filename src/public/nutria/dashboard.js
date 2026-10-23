const COL = {
  fecha:0, wa:1, edad:2, genero:3, tiempoCelular:4, verificar:5,
  imagenMetricas:6,
  tiempoRedes:7, redPrincipal:8, sabeUP:9, vioPublicidad:10,
  redPublicidad:11, pubMotivo:12, bebidas:13, panaderia:14,
  postres:15, mecatos:16, comproDespues:17, sellos:18,
  consumiriaSello:19, motivacion:20, comoEntero:21, contacto:22
};

let charts = {};
let countdownTimer = null;
let secondsLeft = 30;

const COLORS = ['#7c3aed','#2563eb','#a855f7','#06b6d4','#8b5cf6','#60a5fa','#c084fc','#38bdf8'];

function count(rows, col, val) {
  return rows.filter(r => (r[col]||'').toLowerCase() === val.toLowerCase()).length;
}
function countMap(rows, col) {
  const m = {};
  rows.forEach(r => { const v = r[col]||'Otro'; m[v] = (m[v]||0)+1; });
  return m;
}
function pct(n, total) {
  return total ? Math.round(n/total*100)+'%' : '0%';
}

function makeChart(id, type, labels, data, opts={}) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: type === 'bar' ? COLORS[0] : COLORS,
        borderColor: type === 'bar' ? COLORS[1] : '#fff',
        borderWidth: type === 'bar' ? 0 : 2,
        borderRadius: type === 'bar' ? 8 : 0,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: type === 'bar' ? 'none' : 'right', labels:{font:{size:11},color:'#4b5563'} }
      },
      ...opts
    }
  });
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  secondsLeft = 30;
  document.getElementById('countdown').textContent = `Próxima actualización: ${secondsLeft}s`;
  countdownTimer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      loadData();
    } else {
      document.getElementById('countdown').textContent = `Próxima actualización: ${secondsLeft}s`;
    }
  }, 1000);
}

async function loadData() {
  try {
    const res = await fetch('/api/tools/nutria/encuestas');
    const json = await res.json();
    const rows = json.rows || [];
    renderDashboard(rows);
    document.getElementById('lastUpdate').textContent =
      'Actualizado: ' + new Date().toLocaleTimeString('es-CO');
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    startCountdown();
  } catch(e) {
    document.getElementById('loading').innerHTML =
      '<p style="color:#7c3aed">Error al cargar datos. Reintentando...</p>';
  }
}

function renderDashboard(rows) {
  const n = rows.length;

  document.getElementById('kTotal').textContent = n;
  document.getElementById('kVioPublicidad').textContent = pct(count(rows, COL.vioPublicidad, 'Sí'), n);
  document.getElementById('kComproRedes').textContent = pct(count(rows, COL.comproDespues, 'Sí'), n);
  document.getElementById('kSabeUP').textContent = pct(count(rows, COL.sabeUP, 'Sí'), n);
  document.getElementById('kContacto').textContent = pct(count(rows, COL.contacto, 'Sí'), n);

  const genMap = countMap(rows, COL.genero);
  makeChart('chartGenero','doughnut', Object.keys(genMap), Object.values(genMap));

  const edadMap = countMap(rows, COL.edad);
  const edadLabels = Object.keys(edadMap).sort();
  makeChart('chartEdad','bar', edadLabels, edadLabels.map(k=>edadMap[k]),
    {scales:{y:{beginAtZero:true,ticks:{stepSize:1,color:'#6b7280'},grid:{color:'#f3f0ff'}}}});

  const redesMap = countMap(rows, COL.tiempoRedes);
  makeChart('chartTiempoRedes','doughnut', Object.keys(redesMap), Object.values(redesMap));

  const redMap = countMap(rows, COL.redPrincipal);
  makeChart('chartRed','bar', Object.keys(redMap), Object.values(redMap),
    {indexAxis:'y', scales:{x:{beginAtZero:true,ticks:{stepSize:1,color:'#6b7280'},grid:{color:'#f3f0ff'}}}});

  const cats = ['Bebidas','Panadería','Postres','Mecatos'];
  const catCols = [COL.bebidas, COL.panaderia, COL.postres, COL.mecatos];
  const freqMap = {'Ninguna vez':0,'1 vez':1,'2 veces':2,'3 veces':3,'Más de 4 veces':4};
  const promedios = catCols.map(col => {
    const vals = rows.map(r => freqMap[r[col]] ?? 0);
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : 0;
  });
  makeChart('chartConsumo','bar', cats, promedios,
    {scales:{y:{beginAtZero:true,max:4,title:{display:true,text:'Promedio veces/sem',color:'#6b7280'},ticks:{color:'#6b7280'},grid:{color:'#f3f0ff'}}}});

  const sellosMap = countMap(rows, COL.sellos);
  makeChart('chartSellos','doughnut', Object.keys(sellosMap), Object.values(sellosMap));

  const motivoMap = countMap(rows, COL.pubMotivo);
  makeChart('chartMotivo','doughnut', Object.keys(motivoMap), Object.values(motivoMap));

  const enteroMap = countMap(rows, COL.comoEntero);
  makeChart('chartEntero','bar', Object.keys(enteroMap), Object.values(enteroMap),
    {scales:{y:{beginAtZero:true,ticks:{stepSize:1,color:'#6b7280'},grid:{color:'#f3f0ff'}}}});

  const tbody = document.getElementById('tablaBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty">No hay respuestas todavía 📭</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${r[COL.fecha]||''}</td>
    <td>${r[COL.edad]||''}</td>
    <td>${r[COL.genero]||''}</td>
    <td>${r[COL.tiempoCelular]||''}</td>
    <td>${r[COL.tiempoRedes]||''}</td>
    <td>${r[COL.redPrincipal]||''}</td>
    <td>${r[COL.vioPublicidad]||''}</td>
    <td>${r[COL.pubMotivo]||''}</td>
    <td>${r[COL.comproDespues]||''}</td>
    <td>${r[COL.sellos]||''}</td>
    <td>${r[COL.consumiriaSello]||''}</td>
    <td>${r[COL.motivacion]||''}</td>
    <td>${r[COL.comoEntero]||''}</td>
    <td>${r[COL.contacto]||''}</td>
  </tr>`).join('');
}

loadData();

// ── Escáner QR ────────────────────────────────────────────────────────────────

let html5QrCode = null;
let scannerRunning = false;
let currentCode = null;

let scanHistory = [];

// Polling del historial desde el servidor cada 5 segundos
async function pollCanjes() {
  try {
    const res = await fetch('/api/tools/nutria/canjes');
    const json = await res.json();
    scanHistory = json.canjes || [];
    renderHistory();
  } catch {}
}
pollCanjes();
setInterval(pollCanjes, 5000);

function toggleScanner() {
  if (scannerRunning) stopScanner();
  else startScanner();
}

function startScanner() {
  document.getElementById('qr-reader').style.display = 'block';
  html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 220 } },
    onQrDetected
  ).then(() => {
    scannerRunning = true;
    document.getElementById('scanBtn').textContent = '⏹ Detener escáner';
    document.getElementById('scanBtn').classList.add('stop');
    resetResult();
  }).catch(err => {
    console.error('Scanner error:', err);
    alert('No se pudo acceder a la cámara. Verifica los permisos.');
  });
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      scannerRunning = false;
      document.getElementById('qr-reader').style.display = 'none';
      document.getElementById('scanBtn').textContent = '📷 Iniciar escáner';
      document.getElementById('scanBtn').classList.remove('stop');
    });
  }
}

async function onQrDetected(decodedText) {
  // Extraer código de la URL o usarlo directamente
  const match = decodedText.match(/NUTR-(?:[A-Z0-9]{10}|[A-Z0-9]{4})(?![A-Z0-9])/);
  if (!match) return;
  const code = match[0];
  if (code === currentCode) return; // evitar re-escaneo del mismo código

  stopScanner();
  currentCode = code;

  // Consultar estado
  try {
    const res = await fetch(`/api/tools/nutria/codigo/${code}`);
    const json = await res.json();
    showResult(code, json, res.status);
  } catch (e) {
    showError('Error de conexión');
  }
}

function showResult(code, data, status) {
  const el = document.getElementById('scanResult');
  const codeEl = document.getElementById('resultCode');
  const infoEl = document.getElementById('resultInfo');
  const btn = document.getElementById('canjearBtn');

  el.style.display = 'block';
  el.className = 'scan-result';

  if (status === 404) {
    el.classList.add('invalid');
    codeEl.textContent = '❌ Código no válido';
    infoEl.textContent = `"${code}" no existe o expiró`;
    btn.style.display = 'none';
  } else if (data.canjeado) {
    el.classList.add('used');
    codeEl.textContent = '⚠️ Ya canjeado';
    infoEl.textContent = `${code} — Canjeado el ${data.canjeadoEn ?? ''}`;
    btn.style.display = 'none';
  } else {
    el.classList.add('valid');
    codeEl.textContent = '✅ Código válido';
    infoEl.textContent = `${code} · Participante registrado`;
    btn.style.display = 'block';
  }
}

function showError(msg) {
  const el = document.getElementById('scanResult');
  el.style.display = 'block';
  el.className = 'scan-result invalid';
  document.getElementById('resultCode').textContent = '❌ Error';
  document.getElementById('resultInfo').textContent = msg;
  document.getElementById('canjearBtn').style.display = 'none';
}

function resetResult() {
  currentCode = null;
  const el = document.getElementById('scanResult');
  el.style.display = 'none';
  document.getElementById('canjearBtn').style.display = 'none';
}

async function canjearCodigo() {
  if (!currentCode) return;
  const btn = document.getElementById('canjearBtn');
  btn.textContent = 'Procesando...';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/tools/nutria/codigo/${currentCode}/canjear`, { method: 'POST' });
    const json = await res.json();

    if (json.ok) {
      const el = document.getElementById('scanResult');
      el.className = 'scan-result used';
      document.getElementById('resultCode').textContent = '🎁 ¡Papita entregada!';
      document.getElementById('resultInfo').textContent = `${currentCode} — Canjeado ahora`;
      btn.style.display = 'none';
      addHistory(currentCode, true);
    } else {
      showError(json.error === 'already_redeemed' ? 'Ya fue canjeado antes' : 'Error al canjear');
    }
  } catch (e) {
    showError('Error de conexión al canjear');
  }

  btn.disabled = false;
  btn.textContent = '🎁 Confirmar canje';
}

function addHistory() {
  pollCanjes(); // refresca inmediatamente desde el servidor
}

function renderHistory() {
  const container = document.getElementById('historyList');
  if (!container) return;
  if (!scanHistory.length) {
    container.innerHTML = '<span style="color:#a78bfa;font-size:.75rem">Sin canjes aún</span>';
    return;
  }
  container.innerHTML = scanHistory.map(h => `
    <div class="history-item ok">
      <span>✅ ${h.code}</span>
      <span>${h.canjeadoEn?.split(' ')[1] ?? ''}</span>
    </div>
  `).join('');
}

// Los handlers viven aqui (no en onclick=) porque la CSP prohibe JS inline.
document.getElementById('refreshBtn').addEventListener('click', loadData);
document.getElementById('scanBtn').addEventListener('click', toggleScanner);
document.getElementById('canjearBtn').addEventListener('click', canjearCodigo);
