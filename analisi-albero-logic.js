// analisi-albero-logic.js
// Logica completa del form di analisi morfologica albero v0.3
// Da includere nel nuovo design con <script src="analisi-albero-logic.js"></script>
// IMPORTANTE: tutti gli ID HTML referenziati devono essere preservati nel nuovo design.
// Vedere design-brief.md per la lista completa degli ID obbligatori.

let selectedMode = null;
  let inclMode = null;
  let orientedFiles = { N: null, E: null, S: null, O: null };
  let inclFotoFiles = { N: null, E: null, S: null, O: null };
  // (22/09/2026) La foto dal basso è stata tolta. La densità della chioma la
  // sceglie l'arborista con tre pulsanti, senza niente di preselezionato:
  // finché non sceglie, Analizza resta spento. Prima, senza foto, il form
  // scriveva «media» in silenzio — e la densità entra nella soglia di partenza
  // e nel peso della chioma usato dal motore dei sensori.
  let densitaScelta = null;
  function selectDensita(v) {
    densitaScelta = v;
    ['rada', 'media', 'densa'].forEach(d => {
      const b = document.getElementById('btnDens' + d.charAt(0).toUpperCase() + d.slice(1));
      if (b) b.classList.toggle('selected', d === v);
    });
    const h = document.getElementById('hintDensita');
    if (h) h.classList.toggle('hidden', !!v);
    updateAnalyzeBtn();
  }

  // GPS state
  let gpsData = { lat: null, lng: null, acc: null };

  // Sensors list
  let sensori = []; // array of { deveui, note, fittizio? }

  // Codice sensore fittizio precompilato per non dover inserire un DevEUI
  // ad ogni prova. Rimane finché non viene rimosso a mano o sostituito
  // aggiungendo un sensore vero (che lo rimpiazza automaticamente).
  const SENSORE_FITTIZIO_DEVEUI = 'DEADBEEF00000001';

  function aggiungiSensoreFittizioSeVuoto() {
    if (sensori.length === 0) {
      sensori.push({ deveui: SENSORE_FITTIZIO_DEVEUI, note: '', fittizio: true });
      renderSensori();
    }
  }

  // QR scanner state
  let qrStream = null;
  let qrScanInterval = null;
  let qrTargetInput = null;

  // ─── AI (Claude vision) ───────────────────────────────────────────
  // Usa l'helper integrato window.claude.complete (ambiente Claude). In
  // alternativa, un proxy lato server che custodisce la API key, impostabile
  // via localStorage 'analisi_albero_ai_proxy' per il self-hosting.
  // Su un sito pubblicato (es. Netlify) l'helper window.claude NON esiste:
  // si usa la funzione serverless che custodisce la API key.
  // 15/10/2026 — copia per GitHub Pages: il proxy non è più la funzione di Netlify
  // ma la Edge Function `ai-proxy` di Supabase (stessa logica, stessi controlli).
  const AI_PROXY_DEFAULT = 'https://sldotadtisgekovgvsqr.supabase.co/functions/v1/ai-proxy';
  function getAIProxyUrl(){
    try { const v = (localStorage.getItem('analisi_albero_ai_proxy') || '').trim(); if (v) return v; } catch(e){}
    return AI_PROXY_DEFAULT;
  }

  function aiAvailable(){
    return (typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function')
        || !!getAIProxyUrl();
  }

  // content: array di blocchi {type:'image'|'text', ...}. Ritorna il testo della risposta AI.
  async function aiComplete(content, maxTokens){
    if (typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function'){
      const out = await window.claude.complete({ messages: [{ role: 'user', content: content }] });
      return (typeof out === 'string') ? out : (out && (out.text || '')) || '';
    }
    const proxy = getAIProxyUrl();
    if (proxy){
      const resp = await fetch(proxy, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ max_tokens: maxTokens || 600, messages: [{ role: 'user', content: content }] })
      });
      const data = await resp.json();
      if (data && data.error) throw new Error(data.error.message || 'Errore AI');
      if (typeof data === 'string') return data;
      if (data && data.text) return data.text;
      if (data && Array.isArray(data.content)) return data.content.map(b => b.text || '').join('');
      return JSON.stringify(data);
    }
    throw new Error('AI_NON_DISPONIBILE');
  }

  // Diagnostica: invia una piccola immagine di test e riferisce se l'AI risponde
  // e (su Netlify) quale provider ha risposto. Utile per verificare le chiavi.
  async function verificaAI(){
    const out = document.getElementById('aiDiagStatus');
    const btn = document.getElementById('btnVerificaAI');
    if (out){ out.className = 'ai-diag-status loading'; out.textContent = '⏳ Verifica AI in corso…'; }
    if (btn) btn.disabled = true;
    try {
      // mini immagine JPEG "ad alberello" generata al volo
      const c = document.createElement('canvas'); c.width = 64; c.height = 80;
      const x = c.getContext('2d');
      x.fillStyle = '#aacbe0'; x.fillRect(0,0,64,80);
      x.fillStyle = '#6b4a2a'; x.fillRect(29,46,6,34);
      x.fillStyle = '#2f7a3f'; x.beginPath(); x.arc(32,30,22,0,7); x.fill();
      const b64 = c.toDataURL('image/jpeg', 0.8).split(',')[1];

      const usingProxy = !(typeof window !== 'undefined' && window.claude && typeof window.claude.complete === 'function');
      let provider = usingProxy ? null : 'claude (ambiente integrato)';

      if (usingProxy){
        // chiamata diretta al proxy per leggere anche il campo "provider"
        const resp = await fetch(getAIProxyUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ max_tokens: 30, messages: [{ role:'user', content:[
            { type:'image', source:{ type:'base64', media_type:'image/jpeg', data:b64 } },
            { type:'text', text:'Rispondi solo: OK' }
          ]}] })
        });
        const data = await resp.json();
        if (data && data.error) throw new Error(data.error.message || ('HTTP ' + resp.status));
        provider = (data && data.provider) ? data.provider : 'sconosciuto';
        var replyTxt = (data && Array.isArray(data.content)) ? data.content.map(b => b.text || '').join('') : '';
      } else {
        replyTxt = await aiComplete([
          { type:'image', source:{ type:'base64', media_type:'image/jpeg', data:b64 } },
          { type:'text', text:'Rispondi solo: OK' }
        ], 30);
      }

      if (out){
        out.className = 'ai-diag-status ok';
        out.textContent = '✓ AI attiva — provider: ' + provider + '. Risposta: "' + (replyTxt || '').trim().slice(0,40) + '"';
      }
    } catch(e){
      if (out){
        out.className = 'ai-diag-status err';
        out.textContent = '✕ AI non raggiungibile: ' + String((e && e.message) || e) +
          '. Controlla i segreti della funzione ai-proxy su Supabase (Edge Functions → Secrets).';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ─── GPS ──────────────────────────────────────────────────────────────────

  function getGPS() {
    if (!navigator.geolocation) {
      setGpsStatus('error', '❌ GPS non disponibile su questo dispositivo');
      return;
    }
    setGpsStatus('loading', '⏳ Rilevamento posizione in corso...');
    document.getElementById('btnGps').disabled = true;

    navigator.geolocation.getCurrentPosition(
      pos => {
        gpsData.lat = Math.round(pos.coords.latitude  * 100000) / 100000;
        gpsData.lng = Math.round(pos.coords.longitude * 100000) / 100000;
        gpsData.acc = Math.round(pos.coords.accuracy);
        setGpsStatus('ok', '✓ Posizione rilevata');
        showStepError('errGps', false);
        document.getElementById('gpsLat').textContent = gpsData.lat;
        document.getElementById('gpsLng').textContent = gpsData.lng;
        document.getElementById('gpsAcc').textContent = '±' + gpsData.acc + ' m';
        document.getElementById('gpsCoords').classList.remove('hidden');
        document.getElementById('gpsLatManual').value = gpsData.lat;
        document.getElementById('gpsLngManual').value = gpsData.lng;
        document.getElementById('btnGps').disabled = false;
        document.getElementById('btnGps').textContent = '🔄 Aggiorna posizione';
      },
      err => {
        const msgs = {1:'Accesso negato — consenti il GPS nelle impostazioni', 2:'Posizione non disponibile', 3:'Timeout — riprova'};
        setGpsStatus('error', '❌ ' + (msgs[err.code] || 'Errore GPS'));
        document.getElementById('btnGps').disabled = false;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function setGpsStatus(type, msg) {
    const el = document.getElementById('gpsStatus');
    el.className = 'gps-status gps-' + type;
    el.innerHTML = msg;
    // Visual feedback on card
    const card = document.getElementById('gpsCard');
    card.style.borderColor = type === 'ok' ? 'rgba(58,107,42,0.35)' : '';
  }

  function toggleGpsManual() {
    const el = document.getElementById('gpsManual');
    el.classList.toggle('hidden');
    const toggle = document.querySelector('.gps-manual-toggle');
    toggle.textContent = el.classList.contains('hidden')
      ? '▸ Inserisci coordinate manualmente'
      : '▾ Inserisci coordinate manualmente';
  }

  function updateGpsFromManual() {
    const lat = parseFloat(document.getElementById('gpsLatManual').value);
    const lng = parseFloat(document.getElementById('gpsLngManual').value);
    if (!isNaN(lat) && !isNaN(lng)) {
      gpsData.lat = Math.round(lat * 100000) / 100000;
      gpsData.lng = Math.round(lng * 100000) / 100000;
      gpsData.acc = null;
      document.getElementById('gpsLat').textContent = gpsData.lat;
      document.getElementById('gpsLng').textContent = gpsData.lng;
      document.getElementById('gpsAcc').textContent = 'inserito manualmente';
      document.getElementById('gpsCoords').classList.remove('hidden');
      setGpsStatus('ok', '✓ Coordinate inserite manualmente');
      showStepError('errGps', false);
    }
  }

  // ─── SENSORI ──────────────────────────────────────────────────────────────

  // Parser QR Milesight — gestisce formati comuni
  function parseMilesightQR(raw) {
    if (!raw) return null;
    raw = raw.trim();

    // Formato: SN:xxx;DevEUI:24E124...;AppKey:...
    let m = raw.match(/DevEUI[:\s=]+([0-9A-Fa-f]{16})/i);
    if (m) return m[1].toUpperCase();

    // Formato JSON: {"DevEUI":"24E124..."}
    try {
      const obj = JSON.parse(raw);
      const key = Object.keys(obj).find(k => k.toLowerCase().includes('deveui') || k.toLowerCase().includes('eui'));
      if (key) return obj[key].toUpperCase().replace(/[^0-9A-F]/g, '');
    } catch(e) {}

    // Formato URL con DevEUI come parametro
    m = raw.match(/[?&](?:deveui|eui)[=:]([0-9A-Fa-f]{16})/i);
    if (m) return m[1].toUpperCase();

    // Stringa esadecimale pura di 16 caratteri
    if (/^[0-9A-Fa-f]{16}$/.test(raw)) return raw.toUpperCase();

    // Stringa con separatori tipo 24:E1:24:FF:... o 24-E1-24-FF-...
    const clean = raw.replace(/[:\-\s]/g,'');
    if (/^[0-9A-Fa-f]{16}$/.test(clean)) return clean.toUpperCase();

    return null;
  }

  let activeSensorInputId = null;

  function addSensorUI() {
    // Create inline input row
    const list = document.getElementById('sensoriList');
    document.getElementById('sensoriEmpty').style.display = 'none';

    const rowId = 'sensorRow_' + Date.now();
    const inputId = 'sensorInput_' + Date.now();
    const row = document.createElement('div');
    row.className = 'sensor-input-row';
    row.id = rowId;
    row.innerHTML = `
      <input type="text" id="${inputId}" placeholder="DevEUI — es. 24E124FFFEFE14BC"
             maxlength="23" oninput="this.value=this.value.toUpperCase().replace(/[^0-9A-F]/g,'')">
      <button class="btn-qr" title="Scansiona QR" onclick="startQR('${inputId}')">📷</button>
      <button class="btn-sensor-confirm" onclick="confirmSensor('${inputId}','${rowId}')">✓ Aggiungi</button>
    `;
    list.appendChild(row);
    document.getElementById(inputId).focus();
  }

  function confirmSensor(inputId, rowId) {
    const val = document.getElementById(inputId).value.trim().replace(/[^0-9A-F]/gi,'').toUpperCase();
    if (val.length !== 16) {
      document.getElementById(inputId).classList.add('required-empty');
      document.getElementById(inputId).placeholder = 'DevEUI deve essere 16 caratteri esadecimali';
      return;
    }
    // Check duplicates
    if (sensori.find(s => s.deveui === val)) {
      document.getElementById(inputId).classList.add('required-empty');
      document.getElementById(inputId).value = '';
      document.getElementById(inputId).placeholder = 'Questo sensore è già nella lista';
      return;
    }
    // Un DevEUI vero sostituisce automaticamente eventuali sensori fittizi
    sensori = sensori.filter(s => !s.fittizio);
    sensori.push({ deveui: val, note: '' });
    document.getElementById(rowId).remove();
    renderSensori();
  }

  function renderSensori() {
    const list = document.getElementById('sensoriList');
    list.querySelectorAll('.sensor-card').forEach(el => el.remove());
    if (sensori.length > 0) showStepError('errSensori', false);
    if (sensori.length === 0) {
      document.getElementById('sensoriEmpty').style.display = 'block';
    } else {
      document.getElementById('sensoriEmpty').style.display = 'none';
      sensori.forEach((s, i) => {
        const card = document.createElement('div');
        card.className = 'sensor-card' + (s.fittizio ? ' sensor-card-fittizio' : '');
        const meta = s.fittizio
          ? '🧪 Sensore fittizio (prova) · rimuovilo o aggiungine uno vero per sostituirlo'
          : 'Milesight EM320-TILT · Sensore ' + (i + 1);
        card.innerHTML = `
          <div class="sensor-card-info">
            <div class="sensor-deveui">${s.deveui}${s.fittizio ? ' <span class="sensor-fittizio-badge">FITTIZIO</span>' : ''}</div>
            <div class="sensor-meta">${meta}</div>
          </div>
          <button class="sensor-remove" onclick="removeSensor(${i})" title="Rimuovi">✕</button>
        `;
        list.insertBefore(card, list.firstChild);
      });
    }
  }

  function removeSensor(idx) {
    sensori.splice(idx, 1);
    renderSensori();
  }

  // ─── QR SCANNER ───────────────────────────────────────────────────────────

  async function startQR(targetInputId) {
    qrTargetInput = targetInputId;
    const wrap = document.getElementById('qrScannerWrap');
    wrap.classList.remove('hidden');

    try {
      qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      const video = document.getElementById('qrVideo');
      video.srcObject = qrStream;
      await video.play();

      // Use BarcodeDetector if available (Chrome/Android)
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['qr_code','code_128','code_39','ean_13'] });
        qrScanInterval = setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            if (codes.length > 0) {
              handleQRResult(codes[0].rawValue);
            }
          } catch(e) {}
        }, 300);
      } else {
        // Fallback: ask user to type after camera opens
        document.querySelector('.qr-hint').textContent =
          'Scansione automatica non disponibile — digita il DevEUI nel campo sottostante';
      }
    } catch(err) {
      stopQR();
      // Fallback to manual input
      const inp = document.getElementById(qrTargetInput);
      if (inp) { inp.focus(); inp.placeholder = 'Fotocamera non disponibile — digita il DevEUI'; }
    }
  }

  function handleQRResult(raw) {
    const deveui = parseMilesightQR(raw);
    stopQR();
    if (deveui && qrTargetInput) {
      const inp = document.getElementById(qrTargetInput);
      if (inp) {
        inp.value = deveui;
        inp.classList.remove('required-empty');
      }
    } else if (qrTargetInput) {
      const inp = document.getElementById(qrTargetInput);
      if (inp) inp.placeholder = 'QR non riconosciuto — inserisci DevEUI manualmente';
    }
  }

  function stopQR() {
    if (qrScanInterval) { clearInterval(qrScanInterval); qrScanInterval = null; }
    if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
    document.getElementById('qrScannerWrap').classList.add('hidden');
    document.getElementById('qrVideo').srcObject = null;
  }

  // --- ORIENTED SLOTS SETUP ---
  function setupOrientedSlot(dir) {
    const input = document.getElementById('file' + dir);
    const zone = document.getElementById('zone' + dir);
    const preview = document.getElementById('preview' + dir);

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
      if (f) setOrientedFile(dir, f);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) setOrientedFile(dir, input.files[0]);
      input.value = '';
    });
  }

  function setOrientedFile(dir, file) {
    orientedFiles[dir] = file;
    const zone = document.getElementById('zone' + dir);
    const preview = document.getElementById('preview' + dir);
    zone.classList.add('filled');
    const reader = new FileReader();
    reader.onload = e => {
      preview.classList.add('active');
      preview.innerHTML = `<img src="${e.target.result}"><button class="remove-btn" onclick="clearOrientedFile('${dir}')">✕</button>`;
    };
    reader.readAsDataURL(file);
    updateOrientedCount();
    updateAnalyzeBtn();
  }

  window.clearOrientedFile = function(dir) {
    orientedFiles[dir] = null;
    const zone = document.getElementById('zone' + dir);
    const preview = document.getElementById('preview' + dir);
    zone.classList.remove('filled');
    preview.classList.remove('active');
    preview.innerHTML = '';
    updateOrientedCount();
    updateAnalyzeBtn();
  };

  function updateOrientedCount() {
    const n = Object.values(orientedFiles).filter(f => f !== null).length;
    const el = document.getElementById('photoCountA');
    if (n === 0) el.textContent = '';
    else if (n < 3) el.textContent = `${n} foto caricate — ne servono almeno 3 (Nord, Est, Sud)`;
    else if (n === 3) el.textContent = '3 foto caricate ✓ — puoi aggiungere anche Ovest';
    else el.textContent = '4 foto caricate ✓ — ottimo, analisi completa';
  }

  ['N','E','S','O'].forEach(setupOrientedSlot);

  // --- MODE SELECTION ---
  function selectMode(mode) {
    selectedMode = mode;
    document.getElementById('btnModeIsolated').classList.toggle('selected', mode === 'isolated');
    document.getElementById('btnModeDense').classList.toggle('selected', mode === 'dense');
    document.getElementById('modeIsolatedCard').classList.toggle('hidden', mode !== 'isolated');
    document.getElementById('modeDenseCard').classList.toggle('hidden', mode !== 'dense');
    document.getElementById('modeDenseInclCard').classList.toggle('hidden', mode !== 'dense');
    document.getElementById('analyzeBtn').classList.remove('hidden');
    updateAnalyzeBtn();
    // Auto-advance to step 3
    goToStep(3);
  }

  function selectInclMode(mode) {
    inclMode = mode;
    document.getElementById('btnInclStima').classList.toggle('selected', mode === 'stima');
    document.getElementById('btnInclFoto').classList.toggle('selected', mode === 'foto');
    document.getElementById('inclStimaSection').classList.toggle('hidden', mode !== 'stima');
    document.getElementById('inclFotoSection').classList.toggle('hidden', mode !== 'foto');
    updateAnalyzeBtn();
  }

  // Show direction field when inclination > 0
  document.getElementById('inclStimaGradi').addEventListener('change', function() {
    const val = parseFloat(this.value);
    document.getElementById('inclStimaDir').classList.toggle('hidden', val === 0);
  });

  // Setup inclination photo slots
  ['N','E','S','O'].forEach(dir => {
    const input = document.getElementById('fileIncl' + dir);
    const zone  = document.getElementById('zoneIncl' + dir);
    const preview = document.getElementById('previewIncl' + dir);
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const f = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
      if (f) setInclFile(dir, f);
    });
    input.addEventListener('change', () => {
      if (input.files[0]) setInclFile(dir, input.files[0]);
      input.value = '';
    });
  });

  function setInclFile(dir, file) {
    inclFotoFiles[dir] = file;
    const zone = document.getElementById('zoneIncl' + dir);
    const preview = document.getElementById('previewIncl' + dir);
    zone.classList.add('filled');
    const reader = new FileReader();
    reader.onload = e => {
      preview.classList.add('active');
      preview.innerHTML = `<img src="${e.target.result}"><button class="remove-btn" onclick="clearInclFile('${dir}')">✕</button>`;
    };
    reader.readAsDataURL(file);
    updateInclCount();
    updateAnalyzeBtn();
  }

  window.clearInclFile = function(dir) {
    inclFotoFiles[dir] = null;
    const zone = document.getElementById('zoneIncl' + dir);
    const preview = document.getElementById('previewIncl' + dir);
    zone.classList.remove('filled');
    preview.classList.remove('active');
    preview.innerHTML = '';
    updateInclCount();
    updateAnalyzeBtn();
  };

  function updateInclCount() {
    const n = Object.values(inclFotoFiles).filter(f => f !== null).length;
    const el = document.getElementById('photoCountIncl');
    if (!el) return;
    el.textContent = n === 0 ? '' : n < 2 ? '1 foto — aggiungi almeno quella da Est' : `${n} foto caricate ✓`;
  }

  // Step navigation
  let currentStep = 1;

  function highlightRequired(inputId, hintId, valid) {
    const inp = document.getElementById(inputId);
    const hint = document.getElementById(hintId);
    if (inp) inp.classList.toggle('required-empty', !valid);
    if (hint) hint.classList.toggle('visible', !valid);
  }

  function showStepError(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('visible', show);
  }

  function goToStep(n) {
    // Validate step 1 before proceeding
    if (n === 2) {
      const dbh = parseFloat(document.getElementById('dbh').value);
      const dbhValid = dbh && dbh > 0;
      highlightRequired('dbh', 'hintDbh', dbhValid);
      showStepError('errStep1', !dbhValid);

      const gpsValid = gpsData.lat !== null && gpsData.lng !== null;
      showStepError('errGps', !gpsValid);

      // Esito valutazione agronomo — obbligatorio
      const saluteEl = document.getElementById('saluteEsito');
      const saluteValid = !!(saluteEl && saluteEl.value);
      showStepError('errSalute', !saluteValid);

      const sensoriValid = sensori.length > 0;
      showStepError('errSensori', !sensoriValid);

      // Conferma orientamento Nord — obbligatoria
      const nordEl = document.getElementById('sensoreNord');
      const nordValid = !!(nordEl && nordEl.checked);
      const nordRow = document.getElementById('nordRow');
      if (nordRow) nordRow.classList.toggle('required-missing', !nordValid);
      showStepError('errNord', !nordValid);

      // Blocca l'avanzamento sul primo campo mancante (ordine dall'alto al basso)
      if (!dbhValid) { document.getElementById('dbh').focus(); document.getElementById('errStep1').scrollIntoView({behavior:'smooth',block:'center'}); return; }
      if (!gpsValid) { document.getElementById('btnGps').scrollIntoView({behavior:'smooth',block:'center'}); return; }
      if (!saluteValid) { document.getElementById('agronomoCard').scrollIntoView({behavior:'smooth',block:'center'}); return; }
      if (!sensoriValid) { document.getElementById('sensoriCard').scrollIntoView({behavior:'smooth',block:'center'}); return; }
      if (!nordValid) { document.getElementById('nordRow').scrollIntoView({behavior:'smooth',block:'center'}); return; }

      showStepError('errStep1', false);
      showStepError('errGps', false);
      showStepError('errSalute', false);
      showStepError('errSensori', false);
      showStepError('errNord', false);
    }
    // Validate step 2 — mode must be selected (auto via selectMode)
    if (n === 3 && !selectedMode) return;

    // Validate step 3 before proceeding to 4
    if (n === 4) {
      if (selectedMode === 'isolated') {
        const nFoto = Object.values(orientedFiles).filter(f => f !== null).length;
        const ok = nFoto >= 3;
        showStepError('errStep3A', !ok);
        if (!ok) return;
      } else {
        const altezza = parseFloat(document.getElementById('altezzaManuale').value);
        const ok = altezza && altezza > 0;
        highlightRequired('altezzaManuale', 'hintAlt', ok);
        showStepError('errStep3B', !ok);
        if (!ok) {
          document.getElementById('altezzaManuale').focus();
          return;
        }
      }
    }

    // Hide all steps
    [1,2,3,4].forEach(i => {
      const s = document.getElementById('step'+i);
      if (s) s.classList.add('hidden');
      const d = document.getElementById('sdot'+i);
      if (d) {
        d.classList.remove('active','done');
        if (i < n) d.classList.add('done');
      }
    });

    // Show current step
    const s = document.getElementById('step'+n);
    if (s) s.classList.remove('hidden');
    const d = document.getElementById('sdot'+n);
    if (d) d.classList.add('active');
    currentStep = n;

    // Scroll to top of form
    document.getElementById('formSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateAnalyzeBtn() {
    const btn = document.getElementById('analyzeBtn');
    if (!selectedMode) { btn.disabled = true; return; }
    if (selectedMode === 'isolated') {
      const n = Object.values(orientedFiles).filter(f => f !== null).length;
      btn.disabled = n < 3;
    } else {
      const altezza = parseFloat(document.getElementById('altezzaManuale').value);
      if (!altezza || altezza <= 0) { btn.disabled = true; return; }
      if (!densitaScelta) { btn.disabled = true; return; }
      // incl mode must be selected; if foto, need at least 2 photos
      if (!inclMode) { btn.disabled = false; return; } // incl optional
      if (inclMode === 'foto') {
        const n = Object.values(inclFotoFiles).filter(f => f !== null).length;
        btn.disabled = n < 2;
      } else {
        btn.disabled = false;
      }
    }
  }

  // Monitor manual inputs for mode B
  ['ragNord','ragSud','ragEst','ragOvest','inserzioneManuale'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateAnalyzeBtn);
  });

  document.getElementById('altezzaManuale').addEventListener('input', function() {
    const val = parseFloat(this.value);
    highlightRequired('altezzaManuale', 'hintAlt', val && val > 0);
    showStepError('errStep3B', false);
    updateAnalyzeBtn();
  });

  document.getElementById('dbh').addEventListener('input', function() {
    const val = parseFloat(this.value);
    highlightRequired('dbh', 'hintDbh', val && val > 0);
    showStepError('errStep1', false);
    // Anteprima diametro calcolato dalla circonferenza
    const dc = document.getElementById('diametroCalc');
    if (dc){
      if (val && val > 0){
        dc.textContent = 'Diametro (DBH) calcolato: ' + (Math.round((val / Math.PI) * 10) / 10) + ' cm';
        dc.style.display = 'block';
      } else {
        dc.style.display = 'none';
      }
    }
  });

  // --- FILE HANDLING ---
  function setupUpload(inputId, zoneId, gridId, countId, filesArr, otherRef) {
    const input = document.getElementById(inputId);
    const zone = document.getElementById(zoneId);

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      addFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')), gridId, countId, filesArr);
    });
    input.addEventListener('change', () => {
      addFiles(Array.from(input.files), gridId, countId, filesArr);
      input.value = '';
    });
  }


  function addFiles(files, gridId, countId, arr) {
    const grid = document.getElementById(gridId);
    files.forEach(file => {
      if (arr.length >= 8) return;
      arr.push(file);
      const reader = new FileReader();
      reader.onload = e => {
        const idx = arr.length - 1;
        const item = document.createElement('div');
        item.className = 'preview-item';
        item.innerHTML = `<img src="${e.target.result}"><button class="remove-btn" onclick="removeFile('${gridId}','${countId}',${idx},${gridId==='previewGridA'?'filesA':'filesB'})">✕</button>`;
        grid.appendChild(item);
      };
      reader.readAsDataURL(file);
    });
    updateCount(countId, arr);
    updateAnalyzeBtn();
  }

  function removeFileByRef(gridId, countId, idx, arr) {
    arr.splice(idx, 1);
    const grid = document.getElementById(gridId);
    grid.innerHTML = '';
    const temp = [...arr];
    arr.length = 0;
    addFiles(temp, gridId, countId, arr);
  }

  // Inline remove buttons need global refs
  window.removeFileA = (idx) => removeFileByRef('previewGridA', 'photoCountA', idx, filesA);

  // Override addFiles to use correct remove fn
  function addFiles(files, gridId, countId, arr) {
    const grid = document.getElementById(gridId);
    const isA = gridId === 'previewGridA';
    files.forEach(file => {
      if (arr.length >= 8) return;
      arr.push(file);
      const reader = new FileReader();
      const idx = arr.length - 1;
      reader.onload = e => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        const removeFn = isA ? `removeFileA(${arr.length-1})` : `removeFileB(${arr.length-1})`;
        item.innerHTML = `<img src="${e.target.result}"><button class="remove-btn" onclick="${removeFn}">✕</button>`;
        grid.appendChild(item);
      };
      reader.readAsDataURL(file);
    });
    updateCount(countId, arr);
    updateAnalyzeBtn();
  }

  function updateCount(countId, arr) {
    const el = document.getElementById(countId);
    const n = arr.length;
    if (n === 0) el.textContent = '';
    else if (n === 1) el.textContent = '1 foto caricata';
    else el.textContent = `${n} foto caricate ✓`;
  }

  function toBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function setLoading(text) {
    document.getElementById('loadingText').textContent = text;
  }

  // --- ANALYZE ---
  async function analyzeTree() {
    // Il campo #dbh contiene la CIRCONFERENZA misurata col nastro a 1,3 m.
    // Il diametro (DBH vero) si ricava dividendo per π: da qui in poi tutto
    // il pipeline (analisi AI, snellezza, soglia) lavora sul diametro.
    const circonferenza = parseFloat(document.getElementById('dbh').value);
    const errorBox = document.getElementById('errorBox');
    errorBox.classList.remove('active');

    if (!circonferenza || circonferenza <= 0) {
      errorBox.textContent = 'Inserisci la circonferenza del fusto prima di procedere.';
      errorBox.classList.add('active'); return;
    }
    const dbh = Math.round((circonferenza / Math.PI) * 10) / 10; // diametro in cm, 1 decimale
    if (!selectedMode) {
      errorBox.textContent = 'Seleziona il tipo di chioma (libera o sovrapposta).';
      errorBox.classList.add('active'); return;
    }
    if (!aiAvailable()) {
      errorBox.textContent = 'Analisi AI non disponibile in questo contesto. Apri l\'app nell\'ambiente Claude per analizzare le foto, oppure configura un proxy AI per il self-hosting.';
      errorBox.classList.add('active'); return;
    }

    document.getElementById('formSection').classList.add('hidden');
    document.getElementById('loadingSection').classList.add('active');

    try {
      const soilType = document.getElementById('soilType').value;
      const species = document.getElementById('treeSpecies').value || 'non specificata';
      let result;

      // La regola della chioma vive in un file a parte: se manca (file non
      // caricato su Netlify, o script tolto dalla pagina) si dice subito,
      // invece di fallire a metà analisi con un messaggio incomprensibile.
      if (!window.chiomaRegola) {
        throw new Error('Manca il file chioma-regola.js: la pagina non è aggiornata. ' +
          'Ricarica con Ctrl+F5; se il messaggio resta, il file non è stato pubblicato.');
      }

      if (selectedMode === 'isolated') {
        result = await analyzeIsolated(dbh, soilType, species);
      } else {
        result = await analyzeDense(dbh, soilType, species);
      }

      setLoading('Calcolo soglia tilt...');
      const soglia = calcolaSoglia(result, dbh, soilType);

      setLoading('Sintesi generale della pianta...');
      try {
        const sint = await generaSintesiGenerale(result, soglia, dbh, circonferenza, species);
        result.sintesi_generale = sint.testo;
        result.sintesi_fonte = sint.fonte;
      } catch (e) {
        result.sintesi_generale = sintesiDaCodice(result, soglia, dbh, circonferenza, species);
        result.sintesi_fonte = 'codice';
      }

      document.getElementById('loadingSection').classList.remove('active');
      showResults(result, soglia, dbh, circonferenza);

    } catch (err) {
      document.getElementById('loadingSection').classList.remove('active');
      document.getElementById('formSection').classList.remove('hidden');
      errorBox.textContent = 'Errore: ' + err.message;
      errorBox.classList.add('active');
    }
  }

  // ─── SINTESI GENERALE DELLA PIANTA ──────────────────────────────────
  // Produce 3-4 frasi di sintesi complessiva su morfologia e condizioni
  // dell'albero, a valle dell'analisi delle singole foto. Approccio ibrido:
  // prova a farla generare all'AI (più naturale e ragionata); se l'AI non è
  // disponibile o fallisce, ripiega su una sintesi deterministica composta
  // dal codice a partire dai parametri già calcolati.
  function sintesiDaCodice(r, soglia, dbh, circonferenza, species) {
    const parti = [];
    const sp = (species && species !== 'non specificata') ? species : 'Esemplare';
    let apertura = sp;
    if (r.altezza_totale_m) apertura += ` di ${r.altezza_totale_m} m di altezza`;
    if (dbh) apertura += `${r.altezza_totale_m ? ' e' : ' con'} diametro del fusto di ${dbh} cm`;
    parti.push(apertura + '.');

    if (r.snellezza != null) {
      let cls;
      if (r.snellezza < 50) cls = 'fusto robusto e ben proporzionato';
      else if (r.snellezza < 70) cls = 'proporzioni nella norma';
      else if (r.snellezza < 100) cls = 'portamento slanciato, da tenere sotto osservazione';
      else cls = 'esemplare molto snello, potenzialmente più vulnerabile a vento e carichi';
      parti.push(`Snellezza h/D pari a ${r.snellezza}: ${cls}.`);
    }

    const dettagliChioma = [];
    if (r.forma_chioma) dettagliChioma.push('forma ' + String(r.forma_chioma).replace(/_/g,' '));
    if (r.densita_visiva) dettagliChioma.push('densità ' + r.densita_visiva);
    if (r.crown_ratio != null) dettagliChioma.push('crown ratio ' + r.crown_ratio);
    if (dettagliChioma.length) {
      let sim = '';
      if (r.simmetria_chioma && r.simmetria_chioma !== 'regolare') {
        sim = ', chioma ' + String(r.simmetria_chioma).replace(/_/g,' ');
      } else if (r.simmetria_chioma === 'regolare') {
        sim = ', chioma sostanzialmente simmetrica';
      }
      parti.push('Chioma: ' + dettagliChioma.join(', ') + sim + '.');
    }

    if (r.inclinazione_strutturale_gradi > 0) {
      const g = r.inclinazione_strutturale_gradi;
      const sev = g < 5 ? 'lieve' : (g < 10 ? 'moderata' : 'marcata');
      parti.push(`Inclinazione strutturale ${sev} (${g}° verso ${dirName(r.direzione_inclinazione_gradi)}).`);
    } else {
      parti.push('Fusto sostanzialmente verticale, senza inclinazione strutturale rilevata.');
    }

    if (soglia != null) {
      parti.push(`Soglia di allarme tilt consigliata: ${soglia}°.`);
    }
    return parti.join(' ');
  }

  async function generaSintesiGenerale(r, soglia, dbh, circonferenza, species) {
    // Fallback pronto: se l'AI non è disponibile lo usiamo subito.
    const fallback = sintesiDaCodice(r, soglia, dbh, circonferenza, species);
    if (!aiAvailable()) return { testo: fallback, fonte: 'codice' };

    // Compongo un riassunto testuale dei dati per l'AI (nessuna immagine: chiamata leggera)
    const dati = [
      `Specie: ${species || 'non specificata'}`,
      `Circonferenza: ${circonferenza ?? '—'} cm, diametro (DBH): ${dbh ?? '—'} cm`,
      `Altezza totale: ${r.altezza_totale_m ?? '—'} m, inserzione chioma: ${r.altezza_inserzione_chioma_m ?? '—'} m`,
      `Crown ratio: ${r.crown_ratio ?? '—'}, snellezza h/D: ${r.snellezza ?? '—'}`,
      `Forma chioma: ${r.forma_chioma || '—'}, simmetria: ${r.simmetria_chioma || '—'}, densità: ${r.densita_visiva || '—'}`,
      r.raggi ? `Raggi chioma N/S/E/O: ${r.raggi.N}/${r.raggi.S}/${r.raggi.E}/${r.raggi.O} m` : '',
      (r.inclinazione_strutturale_gradi > 0)
        ? `Inclinazione strutturale: ${r.inclinazione_strutturale_gradi}° verso ${dirName(r.direzione_inclinazione_gradi)}`
        : 'Inclinazione strutturale: assente',
      `Soglia tilt consigliata: ${soglia ?? '—'}°`,
      `Osservazioni per foto: ${r.note_morfologiche || '—'}`,
    ].filter(Boolean).join('\n');

    const prompt =
      'Sei un agronomo. Sulla base dei dati morfologici seguenti, provenienti ' +
      'dall\'analisi di più foto orientate dello stesso albero, scrivi una SINTESI ' +
      'GENERALE di 3-4 frasi in italiano sullo stato complessivo della pianta: ' +
      'morfologia, equilibrio della chioma, eventuali criticità strutturali e ' +
      'indicazioni di monitoraggio. Non elencare i singoli dati né ripetere i numeri ' +
      'uno per uno: interpretali in modo discorsivo. Non usare apostrofi tipografici ' +
      'né virgolette. Rispondi solo con il testo della sintesi.\n\nDATI:\n' + dati;

    try {
      const out = await aiComplete([{ type: 'text', text: prompt }], 400);
      const testo = (out || '').trim();
      if (testo.length < 20) return { testo: fallback, fonte: 'codice' };
      return { testo: testo, fonte: 'ai' };
    } catch (e) {
      return { testo: fallback, fonte: 'codice' };
    }
  }

  // MODALITÀ A: foto orientate N/E/S/O → AI analizza ogni foto separatamente
  async function analyzeIsolated(dbh, soilType, species) {
    const slots = [
      { id: 'N', file: orientedFiles.N },
      { id: 'E', file: orientedFiles.E },
      { id: 'S', file: orientedFiles.S },
      { id: 'O', file: orientedFiles.O },
    ];

    const present = slots.filter(s => s.file !== null);
    if (present.length < 3) throw new Error('Carica almeno 3 foto (Nord, Est, Sud) prima di procedere.');

    setLoading('Analisi foto orientate in corso...');

    // Geometria corretta:
    // Foto da Nord (guarda verso Sud): misura raggio Est (destra tronco) e raggio Ovest (sinistra tronco)
    // Foto da Est  (guarda verso Ovest): misura raggio Nord (destra tronco) e raggio Sud (sinistra tronco)
    // Foto da Sud  (guarda verso Nord): conferma raggio Est (sinistra tronco) e raggio Ovest (destra tronco)
    // Foto da Ovest (guarda verso Est): conferma raggio Nord (sinistra tronco) e raggio Sud (destra tronco)

    // Ogni raggio viene stimato da due foto diverse → prendiamo la media
    const stime = { N: [], S: [], E: [], O: [] };
    let altezzeRaw = [], inserzRaw = [];
    let densitaVoti = [], noteList = [], confidenceList = [];
    let inclGradiRaw = [], inclDirRaw = [];

    // Prompt specifico per ogni posizione fotografo
    const promptMap = {
      N: `Sei un esperto di arboricoltura. Questa foto e stata scattata stando a NORD dell albero, fotografando verso SUD.
DBH del fusto: ${dbh}cm (usalo come scala). Specie: ${species}.
ISTRUZIONE FONDAMENTALE: individua il tronco nella foto. Il tronco e il punto zero.
Misura separatamente:
- quanto si estende la chioma a DESTRA del tronco = raggio EST
- quanto si estende la chioma a SINISTRA del tronco = raggio OVEST
Con chioma asimmetrica il tronco non e al centro della chioma. Misura sempre dal tronco.
Rispondi SOLO con JSON valido:
{
  "raggio_est_m": <numero>,
  "raggio_ovest_m": <numero>,
  "altezza_totale_m": <numero>,
  "altezza_inserzione_chioma_m": <numero>,
  "inclinazione_fusto_gradi": <numero 0-45, angolo del fusto dalla verticale>,
  "direzione_inclinazione_gradi": <numero 0-359, verso cui il fusto si inclina, 0=Nord>,
  "densita_visiva": "<rada|media|densa>",
  "confidence": "<alta|media|bassa>",
  "note": "<breve nota senza apostrofi>"
}
IMPORTANTE: niente apostrofi ne virgolette nelle stringhe.`,

      E: `Sei un esperto di arboricoltura. Questa foto e stata scattata stando a EST dell albero, fotografando verso OVEST.
DBH del fusto: ${dbh}cm (usalo come scala). Specie: ${species}.
ISTRUZIONE FONDAMENTALE: individua il tronco nella foto. Il tronco e il punto zero.
Misura separatamente:
- quanto si estende la chioma a DESTRA del tronco = raggio NORD
- quanto si estende la chioma a SINISTRA del tronco = raggio SUD
Con chioma asimmetrica il tronco non e al centro della chioma. Misura sempre dal tronco.
Rispondi SOLO con JSON valido:
{
  "raggio_nord_m": <numero>,
  "raggio_sud_m": <numero>,
  "altezza_totale_m": <numero>,
  "altezza_inserzione_chioma_m": <numero>,
  "inclinazione_fusto_gradi": <numero 0-45, angolo del fusto dalla verticale>,
  "direzione_inclinazione_gradi": <numero 0-359, verso cui il fusto si inclina, 0=Nord>,
  "densita_visiva": "<rada|media|densa>",
  "confidence": "<alta|media|bassa>",
  "note": "<breve nota senza apostrofi>"
}
IMPORTANTE: niente apostrofi ne virgolette nelle stringhe.`,

      S: `Sei un esperto di arboricoltura. Questa foto e stata scattata stando a SUD dell albero, fotografando verso NORD.
DBH del fusto: ${dbh}cm (usalo come scala). Specie: ${species}.
ISTRUZIONE FONDAMENTALE: individua il tronco nella foto. Il tronco e il punto zero.
Misura separatamente:
- quanto si estende la chioma a SINISTRA del tronco = raggio EST (conferma)
- quanto si estende la chioma a DESTRA del tronco = raggio OVEST (conferma)
Con chioma asimmetrica il tronco non e al centro della chioma. Misura sempre dal tronco.
Rispondi SOLO con JSON valido:
{
  "raggio_est_m": <numero>,
  "raggio_ovest_m": <numero>,
  "altezza_totale_m": <numero>,
  "altezza_inserzione_chioma_m": <numero>,
  "inclinazione_fusto_gradi": <numero 0-45, angolo del fusto dalla verticale>,
  "direzione_inclinazione_gradi": <numero 0-359, verso cui il fusto si inclina, 0=Nord>,
  "densita_visiva": "<rada|media|densa>",
  "confidence": "<alta|media|bassa>",
  "note": "<breve nota senza apostrofi>"
}
IMPORTANTE: niente apostrofi ne virgolette nelle stringhe.`,

      O: `Sei un esperto di arboricoltura. Questa foto e stata scattata stando a OVEST dell albero, fotografando verso EST.
DBH del fusto: ${dbh}cm (usalo come scala). Specie: ${species}.
ISTRUZIONE FONDAMENTALE: individua il tronco nella foto. Il tronco e il punto zero.
Misura separatamente:
- quanto si estende la chioma a SINISTRA del tronco = raggio NORD (conferma)
- quanto si estende la chioma a DESTRA del tronco = raggio SUD (conferma)
Con chioma asimmetrica il tronco non e al centro della chioma. Misura sempre dal tronco.
Rispondi SOLO con JSON valido:
{
  "raggio_nord_m": <numero>,
  "raggio_sud_m": <numero>,
  "altezza_totale_m": <numero>,
  "altezza_inserzione_chioma_m": <numero>,
  "densita_visiva": "<rada|media|densa>",
  "confidence": "<alta|media|bassa>",
  "note": "<breve nota senza apostrofi>"
}
IMPORTANTE: niente apostrofi ne virgolette nelle stringhe.`
    };

    for (const slot of present) {
      setLoading(`AI analizza foto da ${slot.id}...`);
      const b64 = await toBase64(slot.file);
      const mt = slot.file.type || 'image/jpeg';

      try {
        const _aiTxt = await aiComplete([
          { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
          { type: 'text', text: promptMap[slot.id] }
        ], 500);
        {
          const r = parseJSON(_aiTxt);

          // Assegna i raggi in base alla posizione del fotografo.
          // (22/09/2026) Prima si scriveva `if (r.raggio_est_m)`, che scarta
          // anche lo ZERO: un lato stimato senza chioma veniva buttato come se
          // l'IA non avesse risposto. Ora conta ogni numero non negativo.
          const stimaValida = v => { const n = chiomaRegola.numero(v); return (n != null && n >= 0) ? n : null; };
          if (slot.id === 'N' || slot.id === 'S') {
            const vE = stimaValida(r.raggio_est_m),   vO = stimaValida(r.raggio_ovest_m);
            if (vE != null) stime.E.push(vE);
            if (vO != null) stime.O.push(vO);
          } else {
            const vN = stimaValida(r.raggio_nord_m),  vS = stimaValida(r.raggio_sud_m);
            if (vN != null) stime.N.push(vN);
            if (vS != null) stime.S.push(vS);
          }

          if (r.altezza_totale_m) altezzeRaw.push(r.altezza_totale_m);
          if (r.altezza_inserzione_chioma_m) inserzRaw.push(r.altezza_inserzione_chioma_m);
          if (r.densita_visiva) densitaVoti.push(r.densita_visiva);
          if (r.note) noteList.push(`[${slot.id}] ${r.note}`);
          if (r.confidence) confidenceList.push(r.confidence);
          if (r.inclinazione_fusto_gradi != null) inclGradiRaw.push(r.inclinazione_fusto_gradi);
          if (r.direzione_inclinazione_gradi != null) inclDirRaw.push(r.direzione_inclinazione_gradi);
        }
      } catch(e) { /* continua */ }
    }

    // Media dei raggi da foto multiple
    const media = arr => arr.length > 0
      ? Math.round((arr.reduce((a,b)=>a+b,0)/arr.length)*10)/10
      : 0;

    // (22/09/2026) Un raggio senza nessuna stima NON diventa zero. `media`
    // restituisce 0 su un elenco vuoto: per l'altezza va bene perché è
    // protetta a monte, per i raggi no — uno zero inventato dice «qui non c'è
    // chioma» su un lato che semplicemente nessuna foto ha letto (rete caduta,
    // foto mossa, risposta dell'IA illeggibile). Si ferma l'analisi e si dice
    // quale foto rifare. Da qui in avanti nei dati entrano solo numeri.
    const mediaRaggio = arr => arr.length > 0 ? media(arr) : null;
    const raggi = {
      N: mediaRaggio(stime.N),
      S: mediaRaggio(stime.S),
      E: mediaRaggio(stime.E),
      O: mediaRaggio(stime.O)
    };
    const senzaStima = chiomaRegola.mancanti(raggi);
    if (senzaStima.length) {
      // N e S si leggono dalle foto scattate da Est e da Ovest; E e O da quelle
      // scattate da Nord e da Sud.
      const daRifare = senzaStima.some(d => d === 'N' || d === 'S');
      const daRifare2 = senzaStima.some(d => d === 'E' || d === 'O');
      const foto = [daRifare ? 'la foto da Est o da Ovest' : null,
                    daRifare2 ? 'la foto da Nord o da Sud' : null].filter(Boolean).join(' e ');
      throw new Error('Raggio ' + senzaStima.map(chiomaRegola.nome).join(', ') +
        ' non stimato dalle foto. Rifai ' + foto + ', oppure passa alle misure manuali.');
    }

    const altezza    = altezzeRaw.length > 0 ? media(altezzeRaw) : null;
    const inserzione = inserzRaw.length  > 0 ? media(inserzRaw)  : null;

    // Densità più frequente
    const densitaCount = {};
    densitaVoti.forEach(v => densitaCount[v] = (densitaCount[v]||0)+1);
    const densita = Object.keys(densitaCount).sort((a,b)=>densitaCount[b]-densitaCount[a])[0] || 'media';

    // Larghezza e simmetria: dalla regola unica (chioma-regola.js).
    // Prima gli zeri venivano scartati: con E 5 / O 0 la larghezza raddoppiava
    // un raggio solo e la simmetria usciva «regolare».
    const larghezza = chiomaRegola.larghezza(raggi);
    const simmetria = chiomaRegola.simmetria(raggi);

    const crownRatio = (altezza && inserzione) ? Math.round(((altezza-inserzione)/altezza)*100)/100 : null;
    const snellezza  = altezza ? Math.round((altezza*100)/dbh) : null;

    const confRank = { alta:2, media:1, bassa:0 };
    const confidence = confidenceList.length > 0
      ? confidenceList.sort((a,b)=>confRank[a]-confRank[b])[0]
      : 'bassa';

    // Inclinazione strutturale: media delle stime da tutte le foto
    const inclGradi = inclGradiRaw.length > 0 ? media(inclGradiRaw) : 0;
    // Media circolare della direzione di inclinazione
    let inclDir = 0;
    if (inclDirRaw.length > 0) {
      const sinSum = inclDirRaw.reduce((s,d) => s + Math.sin(d*Math.PI/180), 0);
      const cosSum = inclDirRaw.reduce((s,d) => s + Math.cos(d*Math.PI/180), 0);
      inclDir = Math.round(((Math.atan2(sinSum,cosSum)*180/Math.PI)+360)%360);
    }

    return {
      altezza_totale_m: altezza,
      altezza_inserzione_chioma_m: inserzione,
      larghezza_chioma_m: larghezza,
      profondita_chioma_m: larghezza,
      crown_ratio: crownRatio,
      snellezza: snellezza,
      simmetria_chioma: simmetria,
      forma_chioma: document.getElementById('formaChioma').value || '',
      densita_visiva: densita,
      confidence: confidence,
      confidence_reason: `Analisi di ${present.length} foto orientate. Ogni raggio e la media di piu stime.`,
      note_morfologiche: noteList.join(' — ') || 'Nessuna nota disponibile.',
      metodo: 'foto_orientate',
      raggi: raggi,
      inclinazione_strutturale_gradi: inclGradi,
      direzione_inclinazione_gradi: inclDir
    };
  }

  // MODALITÀ B: foto dal basso + misure manuali
  async function analyzeDense(dbh, soilType, species) {
    const altezza = parseFloat(document.getElementById('altezzaManuale').value);
    const inserzione = parseFloat(document.getElementById('inserzioneManuale').value) || altezza * 0.3;
    // (22/09/2026) Regola decisa: nel modo manuale il vuoto non esiste, un
    // campo vuoto vale 0 = «da questo lato non c'è chioma». I campi partono
    // già con 0 scritto dentro, quindi ciò che si vede è ciò che si manda.
    // Un numero negativo è un errore di battitura: si ferma e lo si dice,
    // invece di correggerlo in silenzio.
    const leggiRaggio = (id, lato) => {
      const n = chiomaRegola.numero(document.getElementById(id).value);
      if (n == null) return 0;
      if (n < 0) throw new Error('Il raggio ' + lato + ' è negativo (' + n + '): correggilo.');
      return n;
    };
    const rN = leggiRaggio('ragNord', 'Nord');
    const rS = leggiRaggio('ragSud', 'Sud');
    const rE = leggiRaggio('ragEst', 'Est');
    const rO = leggiRaggio('ragOvest', 'Ovest');

    if (!altezza) throw new Error('Inserisci almeno l\'altezza stimata dell\'albero.');

    // Larghezza dalla regola unica (chioma-regola.js). Prima gli zeri venivano
    // scartati dalla media: con E 5 / O 0 / N 3 / S 3 usciva 7,3 m invece di 5,5.
    const raggiManuali = { N: rN, S: rS, E: rE, O: rO };
    const larghezzaChioma = chiomaRegola.larghezza(raggiManuali);

    const altezzaChioma = altezza - inserzione;
    const crownRatio = altezzaChioma / altezza;
    const snellezza = (altezza * 100) / dbh;

    // Simmetria dai raggi misurati, per asse (Nord/Sud, Est/Ovest), dalla
    // regola unica. Prima confrontava il più grande e il più piccolo dei
    // raggi NON nulli fra tutti e quattro: gli zeri sparivano e un lato senza
    // chioma non contava.
    const simmetria = chiomaRegola.simmetria(raggiManuali);

    // Densità: la sceglie l'arborista (tre pulsanti). Non c'è ripiego: se
    // manca si ferma, invece di scrivere «media» senza dirlo.
    if (!densitaScelta) throw new Error('Scegli la densità della chioma: rada, media o densa.');
    const densita = densitaScelta;
    const noteAI = 'Parametri calcolati da misure manuali.';
    const confidence = 'media';
    const confidenceReason = 'Dati manuali diretti; densità della chioma scelta dall\u2019arborista.';
    // Rimasti vuoti di proposito: la foto dal basso non c'è più, e con lei le
    // stime dell'IA su forma e simmetria.
    const formaChiomaAI = '';
    const simmetriaAI = '';

    // Inclinazione strutturale modalità B
    let inclGradi = 0, inclDir = 0;
    if (inclMode === 'stima') {
      inclGradi = parseFloat(document.getElementById('inclStimaGradi').value) || 0;
      inclDir   = parseFloat(document.getElementById('inclStimaDirGradi').value) || 0;
    } else if (inclMode === 'foto') {
      const inclResult = await analyzeInclFoto(dbh, species);
      inclGradi = inclResult.gradi;
      inclDir   = inclResult.dir;
    }

    return {
      altezza_totale_m: altezza,
      altezza_inserzione_chioma_m: inserzione,
      larghezza_chioma_m: larghezzaChioma,
      profondita_chioma_m: larghezzaChioma,
      crown_ratio: Math.round(crownRatio * 100) / 100,
      snellezza: Math.round(snellezza),
      // (22/09/2026) Vince la MISURA. Prima la simmetria stimata dall'IA dalla
      // foto dal basso sostituiva quella calcolata dai raggi misurati col
      // metro, e arrivava così al database e al motore dei sensori.
      simmetria_chioma: simmetria,
      forma_chioma: formaChiomaAI || document.getElementById('formaChiomaDense').value || '',
      densita_visiva: densita,
      confidence: confidence,
      confidence_reason: confidenceReason,
      // La stima dell'IA non si butta: finisce nelle note, dichiarata, e solo
      // se è diversa dalla misura (se coincide non aggiunge nulla).
      note_morfologiche: noteAI + ((simmetriaAI && simmetriaAI !== simmetria)
        ? ' — Simmetria stimata dall\u2019IA dalla foto dal basso: ' + simmetriaAI.replace(/_/g, ' ') +
          ' (non usata: vale quella calcolata dai raggi misurati, ' + simmetria.replace(/_/g, ' ') + ').'
        : ''),
      metodo: 'misure_manuali',
      raggi: { N: rN, S: rS, E: rE, O: rO },
      inclinazione_strutturale_gradi: inclGradi,
      direzione_inclinazione_gradi: inclDir
    };
  }

  // Analisi inclinazione strutturale da foto del fusto (modalità B2)
  async function analyzeInclFoto(dbh, species) {
    const dirs = ['N','E','S','O'];
    const present = dirs.filter(d => inclFotoFiles[d] !== null);
    if (present.length === 0) return { gradi: 0, dir: 0 };

    const dirLabels = { N:'NORD', E:'EST', S:'SUD', O:'OVEST' };
    let inclRaw = [], dirRaw = [];

    for (const d of present) {
      setLoading(`AI analizza fusto da ${dirLabels[d]}...`);
      const b64 = await toBase64(inclFotoFiles[d]);
      const mt = inclFotoFiles[d].type || 'image/jpeg';
      const prompt = {
        type: 'text',
        text: `Sei un esperto di arboricoltura. Questa foto e stata scattata stando a ${dirLabels[d]} dell albero, fotografando verso il lato opposto.
DBH fusto: ${dbh}cm. Specie: ${species}.
COMPITO: guarda SOLO il fusto dell albero. Ignora completamente la chioma.
Stima l angolo di inclinazione del fusto rispetto alla verticale e la direzione verso cui si inclina.
Un fusto dritto = 0 gradi. Una inclinazione evidente = 10-15 gradi. Molto inclinato = 20-30 gradi.
Rispondi SOLO con JSON valido:
{
  "inclinazione_fusto_gradi": <numero 0-45>,
  "direzione_inclinazione_gradi": <numero 0-359, verso cui si inclina la cima, 0=Nord, 90=Est>,
  "confidence": "<alta|media|bassa>",
  "note": "<breve nota senza apostrofi>"
}
IMPORTANTE: niente apostrofi ne virgolette nelle stringhe.`
      };
      try {
        const _aiTxt = await aiComplete([
          { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
          prompt
        ], 300);
        {
          const r = parseJSON(_aiTxt);
          if (r.inclinazione_fusto_gradi != null) inclRaw.push(r.inclinazione_fusto_gradi);
          if (r.direzione_inclinazione_gradi != null) dirRaw.push(r.direzione_inclinazione_gradi);
        }
      } catch(e) { /* continua */ }
    }

    const mediaArr = arr => arr.length > 0 ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
    const gradi = Math.round(mediaArr(inclRaw) * 10) / 10;
    // Media circolare direzione
    let dir = 0;
    if (dirRaw.length > 0) {
      const sinS = dirRaw.reduce((s,d)=>s+Math.sin(d*Math.PI/180),0);
      const cosS = dirRaw.reduce((s,d)=>s+Math.cos(d*Math.PI/180),0);
      dir = Math.round(((Math.atan2(sinS,cosS)*180/Math.PI)+360)%360);
    }
    return { gradi, dir };
  }

  function parseJSON(text) {
    // Attempt 1: direct parse
    try { return JSON.parse(text); } catch(e1) {}

    // Attempt 2: extract JSON block and parse
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Risposta non leggibile dall\'AI.');
    const raw = match[0];
    try { return JSON.parse(raw); } catch(e2) {}

    // Attempt 3: sanitize problematic string values
    // Replace unescaped newlines and quotes inside string values
    const sanitized = raw
      .replace(/:\s*"((?:[^"\\]|\\.)*)"/gs, (m, val) => {
        const fixed = val
          .replace(/\n/g, ' ')
          .replace(/\r/g, ' ')
          .replace(/(?<!\\)"/g, '\\"');
        return ': "' + fixed + '"';
      });
    try { return JSON.parse(sanitized); } catch(e3) {}

    // Attempt 4: extract individual fields with regex fallback
    const extract = (key) => {
      const r = new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"');
      const m = raw.match(r);
      return m ? m[1] : null;
    };
    const extractNum = (key) => {
      const r = new RegExp('"' + key + '"\\s*:\\s*([0-9.]+)');
      const m = raw.match(r);
      return m ? parseFloat(m[1]) : null;
    };
    return {
      altezza_totale_m: extractNum('altezza_totale_m'),
      altezza_inserzione_chioma_m: extractNum('altezza_inserzione_chioma_m'),
      larghezza_chioma_m: extractNum('larghezza_chioma_m'),
      profondita_chioma_m: extractNum('profondita_chioma_m'),
      crown_ratio: extractNum('crown_ratio'),
      snellezza: extractNum('snellezza'),
      simmetria_chioma: extract('simmetria_chioma') || 'regolare',
      densita_visiva: extract('densita_visiva') || 'media',
      confidence: extract('confidence') || 'bassa',
      confidence_reason: extract('confidence_reason') || 'Parsing di emergenza — risposta AI non standard.',
      note_morfologiche: extract('note_morfologiche') || 'Dati estratti parzialmente dalla risposta AI.',
      metodo: extract('metodo') || 'foto_orizzontali'
    };
  }

  // --- CALCOLO SOGLIA ---
  function calcolaSoglia(r, dbh, soilType) {
    const snellezza = r.snellezza || (r.altezza_totale_m * 100 / dbh);
    const crownRatio = r.crown_ratio || 0.5;
    const densita = r.densita_visiva || 'media';

    let soglia = 3.0;
    if (snellezza > 80) soglia -= 0.8;
    else if (snellezza > 60) soglia -= 0.4;
    else if (snellezza < 40) soglia += 0.5;

    if (crownRatio > 0.7) soglia -= 0.5;
    else if (crownRatio < 0.4) soglia += 0.4;

    if (densita === 'densa') soglia -= 0.3;
    else if (densita === 'rada') soglia += 0.3;

    if (soilType === 'sabbioso') soglia -= 0.4;
    else if (soilType === 'roccioso') soglia += 0.3;

    return Math.round(Math.max(1.0, Math.min(6.0, soglia)) * 10) / 10;
  }

  // --- UTILITÀ DIREZIONE (condivisa tra showResults e buildReportText) ---
  const _dirNames16 = ['Nord','Nord-NordEst','NordEst','Est-NordEst','Est','Est-SudEst','SudEst','Sud-SudEst','Sud','Sud-SudOvest','SudOvest','Ovest-SudOvest','Ovest','Ovest-NordOvest','NordOvest','Nord-NordOvest'];
  function dirName(d) { return _dirNames16[Math.round(((d%360)+360)%360/22.5)%16]; }

  // --- MOSTRA RISULTATI ---
  function showResults(r, soglia, dbh, circonferenza) {
    togliTuttiIFilePronti();   // i file pronti erano del risultato precedente
    lastResult = r;
    lastSoglia = soglia;
    lastDbh = dbh;
    lastCirconferenza = (circonferenza != null) ? circonferenza : (dbh != null ? Math.round(dbh * Math.PI * 10) / 10 : null);
    const badge = document.getElementById('confidenceBadge');
    const confMap = { alta: ['alta','confidence-high'], media: ['media','confidence-med'], bassa: ['bassa','confidence-low'] };
    const [label, cls] = confMap[r.confidence] || ['?','confidence-low'];
    badge.textContent = `confidenza ${label}`;
    badge.className = `confidence-badge ${cls}`;

    const modeBadge = document.getElementById('modeBadge');
    modeBadge.textContent = r.metodo === 'misure_manuali' ? 'misure manuali' : r.metodo === 'foto_orientate' ? 'foto orientate' : 'analisi foto';
    const inclLabel = (r.inclinazione_strutturale_gradi > 0)
      ? `${r.inclinazione_strutturale_gradi}° verso ${dirName(r.direzione_inclinazione_gradi)}`
      : '0° (dritto)';

    const metrics = [
      { label: 'Altezza totale', value: r.altezza_totale_m, unit: 'm' },
      { label: 'Inserzione chioma', value: r.altezza_inserzione_chioma_m, unit: 'm' },
      { label: 'Larghezza chioma', value: r.larghezza_chioma_m ?? '—', unit: r.larghezza_chioma_m ? 'm' : '' },
      { label: 'Crown ratio', value: r.crown_ratio, unit: '', note: 'chioma / altezza totale' },
      { label: 'Snellezza (h/D)', value: r.snellezza, unit: '', note: 'rapporto altezza/diametro' },
      { label: 'Simmetria', value: r.simmetria_chioma?.replace(/_/g,' '), unit: '' },
      { label: 'Densità visiva', value: r.densita_visiva, unit: '' },
      { label: 'Diametro (DBH)', value: dbh, unit: 'cm', note: 'calcolato da circonferenza' },
      { label: 'Circonferenza', value: lastCirconferenza, unit: 'cm', note: 'misurata col nastro' },
      { label: 'Inclinazione strutturale', value: inclLabel, unit: '' },
    ];

    document.getElementById('metricsGrid').innerHTML = metrics.map(m => `
      <div class="metric">
        <div class="metric-label">${m.label}</div>
        <div class="metric-value">${m.value ?? '—'}<span class="metric-unit">${m.unit || ''}</span></div>
        ${m.note ? `<div class="metric-note">${m.note}</div>` : ''}
      </div>`).join('');

    document.getElementById('sogliaBox').style.display = 'block';
    document.getElementById('sogliaValue').textContent = `${soglia}°`;
    document.getElementById('sogliaDesc').textContent =
      `Calcolata su snellezza (${r.snellezza}), crown ratio (${r.crown_ratio}), densità chioma (${r.densita_visiva}) e terreno (${document.getElementById('soilType').value}). Se il sensore supera ${soglia}° scatta l'allarme.`;

    document.getElementById('aiNote').innerHTML =
      `<strong>Sintesi generale:</strong> ${r.sintesi_generale || '—'}<br><br>` +
      `<strong>Dettaglio per foto:</strong> ${r.note_morfologiche || '—'}<br><br>` +
      `<strong>Affidabilità stima:</strong> ${r.confidence_reason || '—'}`;

    // Avviso inclinazione strutturale significativa
    const inclWarn = document.getElementById('inclWarnBox');
    if (r.inclinazione_strutturale_gradi > 5) {
      inclWarn.style.display = 'block';
      inclWarn.innerHTML = `⚠️ <strong>Inclinazione strutturale significativa: ${r.inclinazione_strutturale_gradi}° verso ${dirName(r.direzione_inclinazione_gradi)}.</strong> `+
        `Questo albero è già inclinato. Il margine di sicurezza residuo è ridotto. `+
        `Il rischio è maggiore con vento da ${dirName(r.direzione_inclinazione_gradi)} e minore con vento da ${dirName((r.direzione_inclinazione_gradi+180)%360)}.`;
    } else {
      inclWarn.style.display = 'none';
    }

    document.getElementById('resultsSection').classList.add('active');
  }

  // --- REPORT TESTUALE ---
  let lastResult = null;
  let lastSoglia = null;
  let lastDbh = null;
  let lastCirconferenza = null;

  function buildReportText() {
    if (!lastResult) return '';
    const r = lastResult;
    const soglia = lastSoglia;
    const dbh = lastDbh;
    const circ = lastCirconferenza;
    const code = document.getElementById('treeCode').value || 'N/D';
    const species = document.getElementById('treeSpecies').value || 'Non specificata';
    const soilLabels = { normale: 'Normale / compatto', sabbioso: 'Sabbioso / sciolto', argilloso: 'Argilloso / pesante', roccioso: 'Roccioso' };
    const soilLabel = soilLabels[document.getElementById('soilType').value] || '';
    const metodo = r.metodo === 'misure_manuali' ? 'Misure manuali + foto dal basso' : 'Analisi foto orizzontali';
    const now = new Date().toLocaleString('it-IT');

    // Campi morfologici extra (stessa logica del report CSV)
    const tipoFustoEl = document.getElementById('tipoFusto');
    const tipoFusto = tipoFustoEl ? tipoFustoEl.value : '';
    const formaChiomaDenseEl = document.getElementById('formaChiomaDense');
    const formaChiomaEl = document.getElementById('formaChioma');
    const formaChioma = (formaChiomaDenseEl && formaChiomaDenseEl.value)
      ? formaChiomaDenseEl.value
      : ((formaChiomaEl && formaChiomaEl.value) || r.forma_chioma || '');
    const cdSpecieEl = document.getElementById('cdSpecie');
    const cdSpecie = (cdSpecieEl && cdSpecieEl.value) ? cdSpecieEl.value : (r.cd_specie ?? '');
    const sensoreNordEl = document.getElementById('sensoreNord');
    const sensoreNord = sensoreNordEl && sensoreNordEl.checked ? 'sì' : 'no';

    // Valutazione agronomo (passaggio opzionale del rilievo, riportato per intero)
    const saluteEsitoRaw = (document.getElementById('saluteEsito') || {}).value || '';
    const saluteEsito = saluteEsitoRaw === 'sano' ? 'Albero sano'
      : (saluteEsitoRaw === 'anomalie' ? 'Anomalie rilevate' : 'Da completare');
    const saluteAgronomo = ((document.getElementById('saluteAgronomo') || {}).value || '').trim();
    const saluteData = (document.getElementById('saluteData') || {}).value || '';
    const saluteNote = ((document.getElementById('saluteNote') || {}).value || '').trim();

    const sep = '─'.repeat(40);
    let lines = [
      'PARCO IoT — REPORT ANALISI MORFOLOGICA',
      sep,
      `Data rilievo:       ${now}`,
      `Metodo:             ${metodo}`,
      `Confidenza AI:      ${r.confidence || '—'}`,
      '',
      'DATI ALBERO',
      sep,
      `Codice / Nome:      ${code}`,
      `Specie:             ${species}`,
      `Circonferenza:      ${circ ?? '—'} cm (misurata a 1,3 m)`,
      `Diametro (DBH):     ${dbh} cm (calcolato)`,
      `Tipo terreno:       ${soilLabel}`,
      `Tipo fusto:         ${tipoFusto ? tipoFusto.replace(/_/g,' ') : '—'}`,
      `Posizione GPS:      ${gpsData.lat && gpsData.lng ? gpsData.lat + ', ' + gpsData.lng + (gpsData.acc ? ' (+-' + gpsData.acc + 'm)' : '') : 'non rilevata'}`,
      `Sensori:            ${sensori.length > 0 ? sensori.map(s=>s.deveui).join(' | ') : 'nessuno'}`,
      `Sensore orient. Nord: ${sensoreNord}`,
      '',
      'PARAMETRI MORFOLOGICI STIMATI',
      sep,
      `Altezza totale:     ${r.altezza_totale_m ?? '—'} m`,
      `Inclinaz. strutturale: ${r.inclinazione_strutturale_gradi > 0 ? r.inclinazione_strutturale_gradi + 'deg verso ' + dirName(r.direzione_inclinazione_gradi) : '0 (dritto)'}`,
      `Inserzione chioma:  ${r.altezza_inserzione_chioma_m ?? '—'} m`,
      `Larghezza chioma:   ${r.larghezza_chioma_m != null ? r.larghezza_chioma_m + ' m' : '—'}`,
      `Crown ratio:        ${r.crown_ratio ?? '—'}  (chioma / altezza totale)`,
      `Snellezza (h/D):    ${r.snellezza ?? '—'}`,
      `Forma chioma:       ${formaChioma ? String(formaChioma).replace(/_/g, ' ') : '—'}`,
      `Simmetria chioma:   ${(r.simmetria_chioma || '—').replace(/_/g, ' ')}`,
      `Densità visiva:     ${r.densita_visiva ?? '—'}`,
      `Cd specie:          ${cdSpecie !== '' ? cdSpecie : '—'}`,
    ];

    if (r.raggi) {
      lines.push(`Raggi chioma:       N=${r.raggi.N}m  S=${r.raggi.S}m  E=${r.raggi.E}m  O=${r.raggi.O}m`);
    }

    lines = lines.concat([
      '',
      'SOGLIA TILT CONSIGLIATA',
      sep,
      `>>> ${soglia}° <<<`,
      `Se il sensore supera ${soglia}° scatta l'allarme per questo albero.`,
      '',
      'SINTESI GENERALE',
      sep,
      r.sintesi_generale || '—',
      '',
      'DETTAGLIO PER FOTO',
      sep,
      r.note_morfologiche || '—',
      '',
      `Affidabilità stima: ${r.confidence_reason || '—'}`,
      '',
      'VALUTAZIONE AGRONOMO',
      sep,
      `Esito:              ${saluteEsito}`,
      `Nome agronomo:      ${saluteAgronomo || '—'}`,
      `Data valutazione:   ${saluteData || '—'}`,
      `Note:               ${saluteNote || '—'}`,
      '',
      sep,
      '⚠ Valori stimati da foto/misure manuali.',
      'Verificare altezza e larghezza chioma sul campo',
      'prima di usare la soglia in produzione.',
    ]);

    return lines.join('\n');
  }

  // Raccoglie tutte le foto disponibili nel rilievo corrente, con etichetta
  // (13/10/2026) Entrano solo le foto del modo che ha prodotto il risultato:
  // le orientate con la chioma libera ('isolated'); quelle del fusto con la
  // chioma sovrapposta ('dense') e solo se l'inclinazione è «da foto». Le foto
  // rimaste in memoria da un modo lasciato non vanno nel report né in archivio.
  function usaFotoOrientate() { return selectedMode === 'isolated'; }
  function usaFotoFusto()     { return selectedMode === 'dense' && inclMode === 'foto'; }

  // Quante foto sono in memoria ma non vengono incluse (per dirlo a schermo).
  function contaFotoEscluse() {
    let n = 0;
    if (!usaFotoOrientate()) ['N','E','S','O'].forEach(d => { if (orientedFiles[d]) n++; });
    if (!usaFotoFusto())     ['N','E','S','O'].forEach(d => { if (inclFotoFiles[d]) n++; });
    return n;
  }
  function notaFotoEscluse() {
    const n = contaFotoEscluse();
    if (!n) return '';
    return ' — ' + n + (n === 1 ? ' foto non inclusa' : ' foto non incluse') + ': non usate in questa analisi';
  }

  function raccogliFotoRilievo() {
    const foto = [];
    if (usaFotoOrientate()) ['N','E','S','O'].forEach(dir => {
      if (orientedFiles[dir]) foto.push({ file: orientedFiles[dir], label: 'Chioma orientata — ' + dirName({N:0,E:90,S:180,O:270}[dir]) });
    });
    if (usaFotoFusto()) ['N','E','S','O'].forEach(dir => {
      if (inclFotoFiles[dir]) foto.push({ file: inclFotoFiles[dir], label: 'Fusto / inclinazione — ' + dirName({N:0,E:90,S:180,O:270}[dir]) });
    });
    return foto;
  }

  // ─── REPORT CSV ─────────────────────────────────────────────────────
  // Un CSV a riga singola (intestazione + una riga dati) per ogni rilievo.
  // Le intestazioni sono sempre identiche: scaricando più report e
  // incollandone le righe dati in un unico file (o foglio Google/Excel) si
  // ottiene una tabella comparabile per colonna/parola chiave tra alberi e
  // rilievi diversi. Non contiene le foto (un CSV non può incorporare
  // immagini): vengono elencate solo le etichette e i nomi dei file.
  function csvEscape(val) {
    const s = (val === null || val === undefined) ? '' : String(val);
    if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Comprime un'immagine (File o Blob) a JPEG qualità ridotta, ritorna {bytes, w, h}
  function comprimiImmagine(file, maxDim, qualita) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error('Compressione fallita')); return; }
          blob.arrayBuffer().then(buf => resolve({ bytes: new Uint8Array(buf), w, h }));
        }, 'image/jpeg', qualita);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
      img.src = url;
    });
  }

  // ─── REPORT ZIP (CSV + foto) ────────────────────────────────────────
  // Un CSV non può incorporare immagini, quindi il report è uno zip che
  // contiene: 1) il CSV a riga singola (intestazione + una riga dati),
  // comparabile tra rilievi diversi incollando più righe insieme; 2) le
  // foto vere usate nel rilievo, in una sottocartella "foto/", compresse
  // per restare leggere. La colonna "foto_utilizzate" nel CSV riporta i
  // nomi dei file dentro la cartella, così CSV e foto restano collegati.
  function csvEscape(val) {
    const s = (val === null || val === undefined) ? '' : String(val);
    if (/[;"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ─── FILE PRONTI PER IL DOWNLOAD (13/10/2026) ──────────────────────
  // Su iPhone il download deve nascere direttamente dal tocco della persona.
  // Per questo i pulsanti «Prepara» fanno solo il lavoro lento e, a file pronto,
  // mettono in pagina un collegamento vero: toccarlo scarica e basta.
  // Il collegamento resta finché non si prepara un altro report dello stesso
  // tipo, non si ripete l'analisi o non si ricomincia da capo.
  const __filePronti = { zip: null, docx: null };   // { url } per tipo
  const __zonaFilePronti = { zip: 'prontiZip', docx: 'prontiDocx' };

  function pesoLeggibile(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  // Toglie il collegamento di quel tipo e libera la memoria del file.
  function togliFilePronto(tipo) {
    const f = __filePronti[tipo];
    if (f && f.url) { try { URL.revokeObjectURL(f.url); } catch (e) {} }
    __filePronti[tipo] = null;
    const zona = document.getElementById(__zonaFilePronti[tipo]);
    if (zona) zona.innerHTML = '';
  }
  function togliTuttiIFilePronti() {
    togliFilePronto('zip');
    togliFilePronto('docx');
    // Anche la scritta «Report pronto…»: senza collegamenti sarebbe falsa.
    const st = document.getElementById('csvStatus');
    if (st) { st.textContent = ''; st.className = 'send-status'; }
  }

  // Mette in pagina il collegamento. Se la zona non c'è nella pagina lancia un
  // errore (visibile nel riquadro di stato): mai un file pronto che nessuno vede.
  function mostraFilePronto(tipo, blob, nomeFile) {
    const zona = document.getElementById(__zonaFilePronti[tipo]);
    if (!zona) throw new Error('Nella pagina manca la zona dei file pronti (' + __zonaFilePronti[tipo] + ')');
    togliFilePronto(tipo);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeFile;
    a.className = 'file-pronto-link';
    a.textContent = '⬇️ ' + nomeFile + ' (' + pesoLeggibile(blob.size) + ')';
    zona.appendChild(a);
    __filePronti[tipo] = { url: url };
  }

  async function generaReportZip() {
    if (!lastResult) return;
    const btn = document.getElementById('btnCsv');
    const status = document.getElementById('csvStatus');
    const testoOriginale = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Preparo il report…';
    status.textContent = '';
    status.className = 'send-status';
    togliFilePronto('zip');   // il file di prima non deve restare accanto a un eventuale errore

    try {
      if (typeof JSZip === 'undefined') throw new Error('Libreria JSZip non caricata');

      const r = lastResult, soglia = lastSoglia, dbh = lastDbh, circ = lastCirconferenza;
      const code = document.getElementById('treeCode').value || 'N/D';
      const species = document.getElementById('treeSpecies').value || '';
      const soilLabels = { normale: 'Normale / compatto', sabbioso: 'Sabbioso / sciolto', argilloso: 'Argilloso / pesante', roccioso: 'Roccioso' };
      const soilLabel = soilLabels[document.getElementById('soilType').value] || '';
      const metodo = r.metodo === 'misure_manuali' ? 'Misure manuali + foto dal basso' : 'Analisi foto orientate';
      const now = new Date();
      const nowIt = now.toLocaleString('it-IT');
      const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const codeSafe = code.replace(/[^a-zA-Z0-9_-]/g, '_');

      const tipoFustoEl = document.getElementById('tipoFusto');
      const formaChiomaDenseEl = document.getElementById('formaChiomaDense');
      const formaChiomaEl = document.getElementById('formaChioma');
      const formaChioma = (formaChiomaDenseEl && formaChiomaDenseEl.value)
        ? formaChiomaDenseEl.value
        : ((formaChiomaEl && formaChiomaEl.value) || r.forma_chioma || '');
      const cdSpecieEl = document.getElementById('cdSpecie');
      const cdSpecie = (cdSpecieEl && cdSpecieEl.value) ? cdSpecieEl.value : (r.cd_specie ?? '');
      const sensoreNordEl = document.getElementById('sensoreNord');

      // Valutazione agronomo — passaggio opzionale del rilievo, incluso per intero
      const saluteEsito = (document.getElementById('saluteEsito') || {}).value || '';
      const saluteAgronomo = ((document.getElementById('saluteAgronomo') || {}).value || '').trim();
      const saluteData = (document.getElementById('saluteData') || {}).value || '';
      const saluteNote = ((document.getElementById('saluteNote') || {}).value || '').trim();

      const sensoriElenco = sensori.map(s => s.deveui + (s.fittizio ? ' [FITTIZIO]' : '')).join(' | ');

      // Nomi dei file foto dentro la cartella "foto/" dello zip
      const foto = raccogliFotoRilievo();
      const fotoEntries = foto.map((f, i) => {
        const safeLabel = f.label.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return { ...f, zipPath: `foto/${String(i + 1).padStart(2, '0')}_${safeLabel}.jpg` };
      });
      const fotoElenco = fotoEntries.map(f => f.zipPath).join(' | ');

      const campi = [
        ['data_ora_report', nowIt],
        ['codice_albero', code],
        ['specie', species],
        ['circonferenza_cm', circ ?? ''],
        ['dbh_cm', dbh ?? ''],
        ['tipo_terreno', soilLabel],
        ['tipo_fusto', tipoFustoEl ? tipoFustoEl.value : ''],
        ['gps_lat', gpsData.lat ?? ''],
        ['gps_lng', gpsData.lng ?? ''],
        ['gps_accuratezza_m', gpsData.acc ?? ''],
        ['sensori', sensoriElenco || 'nessuno'],
        ['sensore_orientato_nord', sensoreNordEl && sensoreNordEl.checked ? 'si' : 'no'],
        ['metodo_rilievo', metodo],
        ['confidenza_ai', r.confidence ?? ''],
        ['affidabilita_stima', r.confidence_reason ?? ''],
        ['altezza_totale_m', r.altezza_totale_m ?? ''],
        ['altezza_inserzione_chioma_m', r.altezza_inserzione_chioma_m ?? ''],
        ['larghezza_chioma_m', r.larghezza_chioma_m ?? ''],
        ['crown_ratio', r.crown_ratio ?? ''],
        ['snellezza_h_d', r.snellezza ?? ''],
        ['forma_chioma', formaChioma],
        ['simmetria_chioma', r.simmetria_chioma ?? ''],
        ['densita_visiva', r.densita_visiva ?? ''],
        ['cd_specie', cdSpecie],
        ['raggio_nord_m', r.raggi ? r.raggi.N : ''],
        ['raggio_sud_m', r.raggi ? r.raggi.S : ''],
        ['raggio_est_m', r.raggi ? r.raggi.E : ''],
        ['raggio_ovest_m', r.raggi ? r.raggi.O : ''],
        ['inclinazione_strutturale_gradi', r.inclinazione_strutturale_gradi ?? 0],
        ['direzione_inclinazione_gradi', r.direzione_inclinazione_gradi ?? ''],
        ['soglia_tilt_gradi', soglia ?? ''],
        ['sintesi_generale', r.sintesi_generale ?? ''],
        ['note_morfologiche_ai', r.note_morfologiche ?? ''],
        ['valutazione_agronomo_esito', saluteEsito],
        ['valutazione_agronomo_nome', saluteAgronomo],
        ['valutazione_agronomo_data', saluteData],
        ['valutazione_agronomo_note', saluteNote],
        ['foto_utilizzate', fotoElenco || 'nessuna'],
      ];

      if (window.vraExtra) { try { campi.push.apply(campi, window.vraExtra.csvRows()); } catch(e){} }

      const header = campi.map(c => csvEscape(c[0])).join(';');
      const riga = campi.map(c => csvEscape(c[1])).join(';');
      // BOM iniziale per far riconoscere l'UTF-8 (accenti) a Excel
      const csvContent = '\uFEFF' + header + '\r\n' + riga + '\r\n';

      const zip = new JSZip();
      zip.file(`report_${codeSafe}_${stamp}.csv`, csvContent);

      let fotoOk = 0;
      for (const f of fotoEntries) {
        try {
          const compresso = await comprimiImmagine(f.file, 1600, 0.8);
          zip.file(f.zipPath, compresso.bytes);
          fotoOk++;
        } catch (e) { /* foto illeggibile: la saltiamo, il resto del report prosegue */ }
      }

      btn.textContent = '⏳ Comprimo lo zip…';
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const nomeFile = `report_${codeSafe}_${stamp}.zip`;
      mostraFilePronto('zip', zipBlob, nomeFile);

      status.textContent = `✓ Report pronto (CSV + ${fotoOk}${fotoEntries.length > fotoOk ? '/' + fotoEntries.length : ''} foto): tocca il collegamento qui sotto per scaricarlo` + notaFotoEscluse();
      status.className = 'send-status ok';
    } catch (err) {
      status.textContent = '✗ Errore generazione report: ' + (err.message || err);
      status.className = 'send-status err';
    } finally {
      btn.disabled = false;
      btn.textContent = testoOriginale;
    }
  }

  // ─── REPORT DOCX (editabile, foto incorporate) ──────────────────────
  // Genera un documento Word con tutti i campi (compresa la valutazione
  // agronomo) in tabelle campo/valore leggibili, e le foto del rilievo
  // incorporate dentro il file (medie, ~mezza pagina). A differenza del
  // CSV serve alla lettura/modifica umana: l'agronomo può aprirlo in
  // Word/LibreOffice/Google Docs, annotarlo e firmarlo. Usa la libreria
  // globale `docx` (UMD via CDN) e `comprimiImmagine` già in uso per lo ZIP.
  async function generaDocxReport() {
    if (!lastResult) return;
    const btn = document.getElementById('btnDocx');
    const status = document.getElementById('csvStatus');
    const testoOriginale = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Preparo il report Word…';
    status.textContent = '';
    status.className = 'send-status';
    togliFilePronto('docx');   // il file di prima non deve restare accanto a un eventuale errore

    try {
      if (typeof docx === 'undefined') throw new Error('Libreria docx non caricata');
      const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel,
              Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, TableLayoutType } = docx;

      const r = lastResult, soglia = lastSoglia, dbh = lastDbh, circ = lastCirconferenza;
      const code = document.getElementById('treeCode').value || 'N/D';
      const species = document.getElementById('treeSpecies').value || 'Non specificata';
      const soilLabels = { normale: 'Normale / compatto', sabbioso: 'Sabbioso / sciolto', argilloso: 'Argilloso / pesante', roccioso: 'Roccioso' };
      const soilLabel = soilLabels[document.getElementById('soilType').value] || '—';
      const metodo = r.metodo === 'misure_manuali' ? 'Misure manuali + foto dal basso' : 'Analisi foto orientate';
      const now = new Date();
      const nowIt = now.toLocaleString('it-IT');
      const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const codeSafe = code.replace(/[^a-zA-Z0-9_-]/g, '_');

      // Campi morfologici extra (stessa logica di CSV e report testuale)
      const tipoFustoEl = document.getElementById('tipoFusto');
      const tipoFusto = tipoFustoEl ? (tipoFustoEl.value || '').replace(/_/g,' ') : '';
      const formaChiomaDenseEl = document.getElementById('formaChiomaDense');
      const formaChiomaEl = document.getElementById('formaChioma');
      const formaChioma = (formaChiomaDenseEl && formaChiomaDenseEl.value)
        ? formaChiomaDenseEl.value
        : ((formaChiomaEl && formaChiomaEl.value) || r.forma_chioma || '');
      const cdSpecieEl = document.getElementById('cdSpecie');
      const cdSpecie = (cdSpecieEl && cdSpecieEl.value) ? cdSpecieEl.value : (r.cd_specie ?? '');
      const sensoreNordEl = document.getElementById('sensoreNord');
      const sensoreNord = sensoreNordEl && sensoreNordEl.checked ? 'sì' : 'no';

      // Valutazione agronomo (per intero)
      const saluteEsitoRaw = (document.getElementById('saluteEsito') || {}).value || '';
      const saluteEsito = saluteEsitoRaw === 'sano' ? 'Albero sano'
        : (saluteEsitoRaw === 'anomalie' ? 'Anomalie rilevate' : 'Da completare');
      const saluteAgronomo = ((document.getElementById('saluteAgronomo') || {}).value || '').trim();
      const saluteData = (document.getElementById('saluteData') || {}).value || '';
      const saluteNote = ((document.getElementById('saluteNote') || {}).value || '').trim();

      const GREEN = '2F6B4F', INK = '15211A', FAINT = '6A7A70';

      // Larghezze tabelle in twip (DXA). Pagina A4 (11906) − margini default
      // (1440 × 2) = 9026 twip utili. Ripartizione 34% / 66% come in origine.
      // NB: con WidthType.PERCENTAGE la griglia del docx (tblGrid) veniva scritta
      // con valori privi di senso e Word/Google Docs schiacciavano le colonne.
      const TW_TOT = 9026, TW_LABEL = 3069, TW_VALUE = 5957;

      // Helper: riga tabella campo/valore
      function kv(label, value) {
        return new TableRow({ children: [
          new TableCell({ width: { size: TW_LABEL, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 },
            children: [ new Paragraph({ children: [ new TextRun({ text: label, bold: true, size: 20, color: FAINT }) ] }) ] }),
          new TableCell({ width: { size: TW_VALUE, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 },
            children: [ new Paragraph({ children: [ new TextRun({ text: (value === null || value === undefined || value === '') ? '—' : String(value), size: 20, color: INK }) ] }) ] }),
        ] });
      }
      function tabella(righe) {
        return new Table({
          width: { size: TW_TOT, type: WidthType.DXA },
          columnWidths: [TW_LABEL, TW_VALUE],
          layout: TableLayoutType.FIXED,
          borders: {
            top:{style:BorderStyle.SINGLE,size:4,color:'DDE5E0'}, bottom:{style:BorderStyle.SINGLE,size:4,color:'DDE5E0'},
            left:{style:BorderStyle.SINGLE,size:4,color:'DDE5E0'}, right:{style:BorderStyle.SINGLE,size:4,color:'DDE5E0'},
            insideHorizontal:{style:BorderStyle.SINGLE,size:4,color:'DDE5E0'}, insideVertical:{style:BorderStyle.SINGLE,size:4,color:'DDE5E0'},
          },
          rows: righe,
        });
      }
      function h2(testo) {
        return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 },
          children: [ new TextRun({ text: testo, bold: true, color: GREEN, size: 24 }) ] });
      }

      const children = [];
      // Intestazione
      children.push(new Paragraph({ spacing: { after: 40 },
        children: [ new TextRun({ text: 'PARCO IoT — Report analisi morfologica', bold: true, color: GREEN, size: 36 }) ] }));
      children.push(new Paragraph({ spacing: { after: 200 },
        children: [ new TextRun({ text: nowIt + ' · Metodo: ' + metodo + ' · Confidenza AI: ' + (r.confidence || '—'), italics: true, color: FAINT, size: 18 }) ] }));

      // Dati albero
      children.push(h2('Dati albero'));
      children.push(tabella([
        kv('Codice / Nome', code),
        kv('Specie', species),
        kv('Circonferenza (misurata a 1,3 m)', circ != null ? circ + ' cm' : '—'),
        kv('Diametro DBH (calcolato)', dbh != null ? dbh + ' cm' : '—'),
        kv('Tipo terreno', soilLabel),
        kv('Tipo fusto', tipoFusto),
        kv('Posizione GPS', (gpsData.lat && gpsData.lng) ? (gpsData.lat + ', ' + gpsData.lng + (gpsData.acc ? ' (±' + gpsData.acc + ' m)' : '')) : 'non rilevata'),
        kv('Sensori', sensori.length ? sensori.map(s => s.deveui + (s.fittizio ? ' [FITTIZIO]' : '')).join(' | ') : 'nessuno'),
        kv('Sensore orientato a Nord', sensoreNord),
      ]));

      // Parametri morfologici
      children.push(h2('Parametri morfologici stimati'));
      const rowsMorfo = [
        kv('Altezza totale', r.altezza_totale_m != null ? r.altezza_totale_m + ' m' : '—'),
        kv('Inserzione chioma', r.altezza_inserzione_chioma_m != null ? r.altezza_inserzione_chioma_m + ' m' : '—'),
        kv('Larghezza chioma', r.larghezza_chioma_m != null ? r.larghezza_chioma_m + ' m' : '—'),
        kv('Crown ratio', r.crown_ratio ?? '—'),
        kv('Snellezza (h/D)', r.snellezza ?? '—'),
        kv('Forma chioma', formaChioma ? String(formaChioma).replace(/_/g,' ') : '—'),
        kv('Simmetria chioma', (r.simmetria_chioma || '—').replace(/_/g,' ')),
        kv('Densità visiva', r.densita_visiva ?? '—'),
        kv('Cd specie', cdSpecie !== '' ? cdSpecie : '—'),
      ];
      if (r.raggi) rowsMorfo.push(kv('Raggi chioma N/S/E/O', `${r.raggi.N} / ${r.raggi.S} / ${r.raggi.E} / ${r.raggi.O} m`));
      rowsMorfo.push(kv('Inclinazione strutturale',
        (r.inclinazione_strutturale_gradi > 0)
          ? r.inclinazione_strutturale_gradi + '° verso ' + dirName(r.direzione_inclinazione_gradi)
          : '0° (dritto)'));
      children.push(tabella(rowsMorfo));

      // Soglia tilt
      children.push(h2('Soglia tilt consigliata'));
      children.push(new Paragraph({ spacing: { after: 60 },
        children: [ new TextRun({ text: (soglia != null ? soglia + '°' : '—'), bold: true, color: GREEN, size: 44 }) ] }));
      children.push(new Paragraph({ children: [ new TextRun({
        text: soglia != null ? `Se il sensore supera ${soglia}° scatta l'allarme per questo albero.` : '', size: 20, color: INK }) ] }));

      // Sintesi generale + dettaglio per foto
      children.push(h2('Sintesi generale'));
      children.push(new Paragraph({ children: [ new TextRun({ text: r.sintesi_generale || '—', size: 20, color: INK }) ] }));
      children.push(h2('Dettaglio per foto'));
      children.push(new Paragraph({ children: [ new TextRun({ text: r.note_morfologiche || '—', size: 20, color: INK }) ] }));
      children.push(new Paragraph({ spacing: { before: 80 },
        children: [ new TextRun({ text: 'Affidabilità stima: ' + (r.confidence_reason || '—'), italics: true, size: 18, color: FAINT }) ] }));

      // Valutazione agronomo
      children.push(h2('Valutazione agronomo'));
      children.push(tabella([
        kv('Esito', saluteEsito),
        kv('Nome agronomo', saluteAgronomo),
        kv('Data valutazione', saluteData),
        kv('Note', saluteNote),
      ]));

      if (window.vraExtra) { try { children.push.apply(children, window.vraExtra.docxChildren(docx)); } catch(e){} }

      // Documentazione fotografica — foto medie (~mezza pagina)
      const foto = raccogliFotoRilievo();
      children.push(h2('Documentazione fotografica'));
      let fotoOk = 0;
      if (foto.length === 0) {
        children.push(new Paragraph({ children: [ new TextRun({ text: 'Nessuna foto allegata al rilievo.', italics: true, size: 18, color: FAINT }) ] }));
      } else {
        // Larghezza media: ~mezza pagina utile (pagina A4 utile ~468pt → ~300px)
        const TARGET_W = 300;
        for (const f of foto) {
          let compresso;
          try { compresso = await comprimiImmagine(f.file, 1400, 0.75); }
          catch (e) { continue; }
          const scale = TARGET_W / compresso.w;
          const w = Math.round(compresso.w * scale);
          const h = Math.round(compresso.h * scale);
          children.push(new Paragraph({ spacing: { before: 160, after: 40 },
            children: [ new TextRun({ text: f.label, bold: true, size: 20, color: GREEN }) ] }));
          children.push(new Paragraph({ children: [
            new ImageRun({ data: compresso.bytes, transformation: { width: w, height: h } }) ] }));
          fotoOk++;
        }
      }

      // Nota di cautela finale
      children.push(new Paragraph({ spacing: { before: 300 },
        children: [ new TextRun({ text: '⚠ Valori stimati da foto/misure manuali. Verificare altezza e larghezza chioma sul campo prima di usare la soglia in produzione.', italics: true, size: 16, color: FAINT }) ] }));

      const doc = new Document({
        creator: 'Parco IoT',
        title: 'Report analisi morfologica — ' + code,
        sections: [{ properties: {}, children }],
      });

      btn.textContent = '⏳ Preparo il file…';
      const blob = await Packer.toBlob(doc);
      const nomeFile = `report_${codeSafe}_${stamp}.docx`;
      mostraFilePronto('docx', blob, nomeFile);

      status.textContent = `✓ Report Word pronto` + (foto.length ? ` (${fotoOk}${foto.length > fotoOk ? '/' + foto.length : ''} foto)` : '') + `: tocca il collegamento qui sotto per scaricarlo` + notaFotoEscluse();
      status.className = 'send-status ok';
    } catch (err) {
      status.textContent = '✗ Errore generazione DOCX: ' + (err.message || err);
      status.className = 'send-status err';
    } finally {
      btn.disabled = false;
      btn.textContent = testoOriginale;
    }
  }

  function toggleReport() {
    const box = document.getElementById('copyReportBox');
    const textarea = document.getElementById('reportText');
    const isHidden = window.getComputedStyle(box).display === 'none';
    if (isHidden) {
      const testo = buildReportText();
      textarea.value = testo || '— Completa prima l\'analisi AI per generare il report. —';
      box.style.display = 'block';
      textarea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      box.style.display = 'none';
    }
  }

  function copyReport() {
    const textarea = document.getElementById('reportText');
    textarea.select();
    textarea.setSelectionRange(0, 99999);
    try {
      navigator.clipboard.writeText(textarea.value).then(() => {
        showCopied();
      }).catch(() => {
        document.execCommand('copy');
        showCopied();
      });
    } catch(e) {
      document.execCommand('copy');
      showCopied();
    }
  }

  function showCopied() {
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✓ Copiato!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copia tutto';
      btn.classList.remove('copied');
    }, 2000);
  }

  function downloadReport() { toggleReport(); }


  // --- RESET ---
  function resetForm() {
    lastResult = null; lastSoglia = null; lastDbh = null; lastCirconferenza = null;
    togliTuttiIFilePronti();
    document.getElementById('copyReportBox').style.display = 'none';
    selectedMode = null;
    inclMode = null;
    gpsData = { lat: null, lng: null, acc: null };
    sensori = [];
    setGpsStatus('idle', '📍 Posizione non ancora rilevata');
    document.getElementById('gpsCoords').classList.add('hidden');
    document.getElementById('btnGps').disabled = false;
    document.getElementById('btnGps').textContent = '📍 Usa posizione attuale';
    document.getElementById('gpsLatManual').value = '';
    document.getElementById('gpsLngManual').value = '';
    document.getElementById('gpsManual').classList.add('hidden');
    document.querySelector('.gps-manual-toggle').textContent = '▸ Inserisci coordinate manualmente';
    document.getElementById('sensoriList').querySelectorAll('.sensor-card,.sensor-input-row').forEach(e=>e.remove());
    document.getElementById('sensoriEmpty').style.display = 'block';
    stopQR();
    ['N','E','S','O'].forEach(d => {
      inclFotoFiles[d] = null;
      const zi = document.getElementById('zoneIncl'+d);
      const pi = document.getElementById('previewIncl'+d);
      if (zi) zi.classList.remove('filled');
      if (pi) { pi.classList.remove('active'); pi.innerHTML=''; }
    });
    const ps = document.getElementById('photoCountIncl');
    if (ps) ps.textContent = '';
    ['btnInclStima','btnInclFoto'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('selected');
    });
    ['inclStimaSection','inclFotoSection'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    const isg = document.getElementById('inclStimaGradi');
    if (isg) isg.value = '0';
    const isd = document.getElementById('inclStimaDirGradi');
    if (isd) isd.value = '';
    document.getElementById('inclStimaDir').classList.add('hidden');
    ['N','E','S','O'].forEach(d => {
      orientedFiles[d] = null;
      const zone = document.getElementById('zone' + d);
      const preview = document.getElementById('preview' + d);
      if (zone) zone.classList.remove('filled');
      if (preview) { preview.classList.remove('active'); preview.innerHTML = ''; }
    });
    selectDensita(null);
    document.getElementById('photoCountA').textContent = '';
    document.getElementById('treeCode').value = '';
    document.getElementById('treeSpecies').value = '';
    document.getElementById('dbh').value = '';
    var _dc = document.getElementById('diametroCalc'); if (_dc) _dc.style.display = 'none';
    document.getElementById('soilType').value = 'normale';
    // (22/09/2026) I raggi ripartono da 0, non da vuoto: nel modo manuale il
    // vuoto vale zero, e il campo deve mostrare ciò che verrà mandato.
    document.getElementById('ragNord').value = '0';
    document.getElementById('ragSud').value = '0';
    document.getElementById('ragEst').value = '0';
    document.getElementById('ragOvest').value = '0';
    document.getElementById('altezzaManuale').value = '';
    document.getElementById('inserzioneManuale').value = '';
    document.getElementById('btnModeIsolated').classList.remove('selected');
    document.getElementById('btnModeDense').classList.remove('selected');
    document.getElementById('modeIsolatedCard').classList.add('hidden');
    document.getElementById('modeDenseCard').classList.add('hidden');
    document.getElementById('analyzeBtn').classList.add('hidden');
    document.getElementById('resultsSection').classList.remove('active');
    document.getElementById('errorBox').classList.remove('active');
    document.getElementById('formSection').classList.remove('hidden');
    goToStep(1);
  }