// vra-sospendi.js
// ─────────────────────────────────────────────────────────────────────────
// Sospendere una VRA e riprenderla in un secondo momento, anche da un altro
// dispositivo. Si appoggia alla Edge Function `vra-bozze`.
//
// Innesto (stile dual-write-supabase.js): un solo <script> in fondo ad
// Analisi_Albero.html, DOPO arete-vra-logic.js:
//
//   <script src="vra-sospendi.js"></script>
//
// Non tocca nessun file esistente: usa le funzioni globali già presenti
// (showResults, vraTogglePanel, vraLive, vraExtra, inviaAlFoglio).
//
// TRE AZIONI
//   • Sospendi  — salva pericolosità + dati branca sul server (o in coda se
//                 manca la rete) e lascia l'albero fra le "VRA da completare".
//   • Riprendi  — ricostruisce la schermata dei risultati da database, senza
//                 rifare le foto, e ricarica la bozza nel pannello.
//   • Concludi  — chiude una VRA ripresa passando da `vra-bozze`, MAI da
//                 `rilievo`: quest'ultima invierebbe anche la morfologia letta
//                 dai campi a schermo, che in modalità ripresa non è attendibile.
//
// SICUREZZA: la parola d'ordine di `vra-bozze` NON è scritta in questo file
// (che è pubblico su Netlify). Viene chiesta una volta per dispositivo e
// conservata in localStorage. Resta un segreto "da browser": protegge da
// chiamate anonime, non da chi ha in mano il tablet sbloccato.
//
// ─────────────────────────────────────────────────────────────────────────
// VERSIONE 2 (18/07/2026) — richiede `vra-bozze` v2 sul server.
//
// Problema risolto: dopo una ripresa i report (CSV/ZIP e DOCX) uscivano
// incompleti. I report leggono da TRE fonti — l'oggetto `lastResult`, i campi
// a schermo, e due memorie interne del form (posizione GPS ed elenco sensori).
// La v1 ricostruiva la prima a metà, la seconda in parte, le due memorie per
// niente.
//
// Cosa cambia, tutto dentro `riprendi` e nei suoi aiutanti:
//   • larghezza chioma, crown ratio, snellezza, coefficiente aerodinamico,
//     forma e simmetria della chioma nell'oggetto risultato;
//   • valutazione agronomo per intero (prima solo il nome dell'agronomo);
//   • posizione GPS ed elenco sensori rimessi nelle memorie del form;
//   • casella "sensore orientato a Nord";
//   • CONFIDENZA: tolta la costante 'media' che la v1 scriveva a tabellino.
//     Finiva nel badge, nel CSV e nel DOCX come se fosse il giudizio reale.
//     Il valore vero non è recuperabile (vedi commento in `riprendi`), quindi
//     ora si dichiara assente invece di essere inventato;
//   • DICHIARAZIONE DI RICOSTRUZIONE su CSV, DOCX e "Copia tutto": un report
//     rigenerato non è il documento originale e deve dirlo.
//
// ORDINE DI INSTALLAZIONE: prima `vra-bozze` v2 sul server, poi questo file.
// Al contrario il ripristino chiederebbe dati che non gli arrivano, e i campi
// resterebbero vuoti senza alcun errore a schermo.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var URL_DEFAULT = 'https://sldotadtisgekovgvsqr.supabase.co/functions/v1/vra-bozze';
  var K_URL = 'vraBozzeUrl', K_SEC = 'vraSecret', K_CODA = 'vraBozzeCoda';

  var VERDE = '#2f6b4f', ECRU = '#f6f4ec';

  // Albero in corso di ripresa: se valorizzato, il pulsante d'invio normale
  // viene bloccato e la conclusione passa da `vra-bozze`.
  var ripresa = null;

  // v2 — Stato "questa schermata è stata ricostruita da database".
  // È volutamente SEPARATO da `ripresa`: quello si azzera quando concludi la
  // VRA, questo no. Se si azzerasse, un report generato subito dopo la
  // conclusione tornerebbe a spacciarsi per il documento originale.
  // Si azzera solo quando parte un'analisi vera (vedi `installa`).
  var ricostruzione = null;
  var _inRipristino = false;

  // ── Configurazione ─────────────────────────────────────────────────────
  function getUrl() {
    try {
      var u = localStorage.getItem(K_URL);
      if (u && /^https?:\/\//.test(u)) return u.trim();
    } catch (e) {}
    return URL_DEFAULT;
  }

  function getSegreto(chiediSeManca) {
    var s = null;
    try { s = localStorage.getItem(K_SEC); } catch (e) {}
    if (s) return s;
    if (!chiediSeManca) return null;
    s = window.prompt('Parola d\u2019ordine per le VRA sospese\n(la si imposta una volta sola su questo dispositivo):');
    if (s) { s = s.trim(); try { localStorage.setItem(K_SEC, s); } catch (e) {} }
    return s || null;
  }

  // ── Chiamate allo sportello ────────────────────────────────────────────
  async function api(metodo, azione, corpo) {
    var seg = getSegreto(true);
    if (!seg) return { ok: false, msg: 'parola d\u2019ordine non impostata' };
    var url = getUrl() + (azione ? '?action=' + encodeURIComponent(azione) : '');
    if (metodo === 'GET' && corpo && corpo.tree_id) {
      url += '&tree_id=' + encodeURIComponent(corpo.tree_id);
    }
    try {
      var opt = { method: metodo, headers: { 'x-parco-secret': seg } };
      if (metodo === 'POST') {
        opt.headers['Content-Type'] = 'application/json';
        opt.body = JSON.stringify(corpo || {});
      }
      var resp = await fetch(url, opt);
      var txt = await resp.text();
      if (/^ERR/i.test(txt)) return { ok: false, msg: txt.slice(0, 160), http: resp.status };
      if (!resp.ok) return { ok: false, msg: 'HTTP ' + resp.status, http: resp.status };
      return { ok: true, dati: JSON.parse(txt) };
    } catch (e) {
      // Distinzione importante: rete assente ≠ rifiuto del server.
      return { ok: false, offline: true, msg: (e && e.message) ? e.message : String(e) };
    }
  }

  // ── Lettura dei campi del pannello VRA ─────────────────────────────────
  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function raccogliBozza() {
    var treeId = val('treeCode');
    if (!treeId) return null;
    var tipo = val('vraImpTipo') || 'albero';
    var b = {
      tree_id: treeId,
      vra_pericolo_radice: val('vraP_radice'),
      vra_pericolo_colletto: val('vraP_colletto'),
      vra_pericolo_fusto: val('vraP_fusto'),
      vra_pericolo_rami: val('vraP_rami'),
      vra_impulso_tipo: tipo,
      // Congelato al momento della sospensione: il campo salute può essere
      // riscritto da un controllo successivo fatto da un'altra persona.
      vra_bozza_autore: val('saluteAgronomo'),
      vra_pericolo_data_oss: oggiISO(),
      vra_pericolo_note: val('vraNoteOss')
    };
    if (tipo === 'branca') {
      b.vra_impulso_branca_diam_cm = val('vraImpDram');
      b.vra_impulso_branca_lung_m = val('vraImpLram');
      b.vra_impulso_branca_hins_m = val('vraImpHins');
    }
    return b;
  }

  function oggiISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ── Coda locale (paracadute quando manca la rete) ───────────────────────
  function leggiCoda() {
    try { return JSON.parse(localStorage.getItem(K_CODA) || '[]'); } catch (e) { return []; }
  }
  function scriviCoda(c) {
    try { localStorage.setItem(K_CODA, JSON.stringify(c)); } catch (e) {}
  }
  function accoda(bozza) {
    var c = leggiCoda();
    // Una bozza per albero: la nuova sostituisce la precedente, non si accoda.
    c = c.filter(function (x) { return x.tree_id !== bozza.tree_id; });
    c.push(bozza);
    scriviCoda(c);
  }
  async function svuotaCoda(silenzioso) {
    var c = leggiCoda();
    if (!c.length) return 0;
    var restanti = [], inviate = 0;
    for (var i = 0; i < c.length; i++) {
      var r = await api('POST', 'bozza', c[i]);
      if (r.ok) inviate++; else restanti.push(c[i]);
    }
    scriviCoda(restanti);
    if (inviate && !silenzioso) {
      avviso('\u2713 ' + inviate + ' bozza/e in attesa inviata/e.', 'ok');
    }
    return inviate;
  }

  // ── Avvisi a schermo ───────────────────────────────────────────────────
  function avviso(testo, tipo) {
    var box = document.getElementById('vraSospStatus');
    if (!box) { alert(testo); return; }
    box.textContent = testo;
    box.style.color = tipo === 'err' ? '#a33' : (tipo === 'ok' ? VERDE : '#6a7a70');
  }

  // ── Azione: SOSPENDI ───────────────────────────────────────────────────
  async function sospendi() {
    var bozza = raccogliBozza();
    if (!bozza) { avviso('\u26a0\ufe0f Manca il codice dell\u2019albero.', 'err'); return; }
    var almeno = ['vra_pericolo_radice', 'vra_pericolo_colletto', 'vra_pericolo_fusto', 'vra_pericolo_rami']
      .some(function (k) { return bozza[k] && bozza[k] !== 'nv'; });
    if (!almeno) {
      avviso('\u26a0\ufe0f Compila almeno una classe di pericolosit\u00e0 prima di sospendere.', 'err');
      return;
    }

    avviso('Salvataggio\u2026');
    await svuotaCoda(true);
    var r = await api('POST', 'bozza', bozza);

    if (r.ok) { avviso('\u2713 VRA sospesa: la ritrovi in \u201cVRA da completare\u201d.', 'ok'); return; }

    if (r.offline) {
      accoda(bozza);
      avviso('\u26a0\ufe0f Nessuna rete: bozza salvata sul dispositivo, verr\u00e0 inviata appena torna la connessione.', 'err');
      return;
    }
    if (r.http === 404) {
      // L'albero non esiste ancora su Supabase: il rilievo non è mai partito.
      accoda(bozza);
      avviso('\u26a0\ufe0f Invia prima il rilievo con \u201cInvia\u201d, poi premi di nuovo Sospendi (la bozza \u00e8 gi\u00e0 al sicuro sul dispositivo).', 'err');
      return;
    }
    accoda(bozza);
    avviso('\u26a0\ufe0f Salvataggio non riuscito (' + r.msg + '). Bozza tenuta sul dispositivo.', 'err');
  }

  // ── Azione: ELENCO delle VRA da completare ─────────────────────────────
  async function apriElenco() {
    var r = await api('GET', 'lista', null);
    if (!r.ok) { alert('Elenco non disponibile: ' + r.msg); return; }
    mostraElenco(r.dati.bozze || []);
  }

  function mostraElenco(bozze) {
    var vecchio = document.getElementById('vraElencoOverlay');
    if (vecchio) vecchio.parentNode.removeChild(vecchio);

    var ov = document.createElement('div');
    ov.id = 'vraElencoOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;';

    var html = '<div style="background:' + ECRU + ';max-width:560px;width:100%;max-height:80vh;overflow:auto;border-radius:12px;padding:18px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<strong style="color:' + VERDE + '">VRA da completare</strong>' +
      '<button id="vraElencoX" style="border:0;background:none;font-size:20px;cursor:pointer">\u00d7</button></div>';

    if (!bozze.length) {
      html += '<p style="color:#6a7a70">Nessuna valutazione sospesa.</p>';
    } else {
      html += '<ul style="list-style:none;padding:0;margin:0">';
      bozze.forEach(function (b) {
        var quando = b.vra_pericolo_data_oss ? ('osservato il ' + b.vra_pericolo_data_oss) : 'data non registrata';
        var chi = b.vra_bozza_autore ? (' \u00b7 ' + b.vra_bozza_autore) : '';
        var gg = (b.giorni_da_osservazione != null) ? (' (' + b.giorni_da_osservazione + " gg fa)") : '';
        html += '<li style="border-top:1px solid #dde5e0;padding:10px 0">' +
          '<div style="font-weight:600">' + esc(b.tree_id) + (b.specie ? ' \u2014 ' + esc(b.specie) : '') + '</div>' +
          '<div style="font-size:13px;color:#6a7a70">' + esc(quando) + gg + esc(chi) +
          (b.vra_impulso_tipo === 'branca' ? ' \u00b7 branca' : '') + '</div>' +
          '<button data-tree="' + esc(b.tree_id) + '" class="vraRiprendiBtn" ' +
          'style="margin-top:6px;background:' + VERDE + ';color:#fff;border:0;border-radius:8px;padding:6px 12px;cursor:pointer">Riprendi</button>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    ov.innerHTML = html;
    document.body.appendChild(ov);

    document.getElementById('vraElencoX').onclick = function () { ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.parentNode.removeChild(ov); });
    Array.prototype.forEach.call(ov.querySelectorAll('.vraRiprendiBtn'), function (b) {
      b.onclick = function () {
        ov.parentNode.removeChild(ov);
        riprendi(b.getAttribute('data-tree'));
      };
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── Azione: RIPRENDI ───────────────────────────────────────────────────
  async function riprendi(treeId) {
    if (!window.chiomaRegola) {
      alert('Manca il file chioma-regola.js: la pagina non è aggiornata. ' +
        'Ricarica con Ctrl+F5; se il messaggio resta, il file non è stato pubblicato.');
      return;
    }
    var r = await api('GET', 'bozza', { tree_id: treeId });
    if (!r.ok) { alert('Bozza non recuperata: ' + r.msg); return; }

    var b = r.dati.bozza || {}, m = r.dati.morfologia;
    var elencoSensori = r.dati.sensori || [];   // v2: in v1 non arrivava affatto
    if (!m) { alert('Questo albero non ha dati morfologici: impossibile ricostruire la schermata.'); return; }

    // Lo sportello v2 può riuscire solo in parte (es. elenco sensori illeggibile):
    // si prosegue, ma non in silenzio.
    if (r.dati.avvisi && r.dati.avvisi.length) {
      console.warn('[vra-sospendi] letture parziali dallo sportello:', r.dati.avvisi);
    }

    // 1) Larghezza della chioma — non esiste come colonna, si ricostruisce dai
    //    quattro raggi con la regola unica (chioma-regola.js), la STESSA del
    //    form. Oltre ai report alimenta la dimensione caratteristica W del
    //    bersaglio (pedoni e traffico veicolare).
    //    (22/09/2026) Non si legge più `raggio_medio_m` del database: quella
    //    colonna scarta gli zeri, e riportava la formula sbagliata dentro ogni
    //    VRA ripresa. Se un raggio manca (dati vecchi) la larghezza resta null.
    var raggi = { N: m.raggio_nord_m, E: m.raggio_est_m, S: m.raggio_sud_m, O: m.raggio_ovest_m };
    var larghezza = window.chiomaRegola.larghezza(raggi);

    var cd = (b.cd_specie != null) ? b.cd_specie : m.cd_specie;

    // 2) Oggetto risultato: è la fonte principale da cui leggono i report.
    var res = {
      // CONFIDENZA — in v1 qui c'era scritto 'media', a tabellino. Non era un
      // dato letto da qualche parte: era una costante messa per far
      // funzionare il badge. Finiva nel documento DOCX come "Confidenza AI:
      // media" anche per un rilievo che era stato giudicato "bassa".
      // v3: per i rilievi dal 18/07/2026 il valore VERO esiste, in
      // `confidenza_ai_testo` (colonna di testo, non la vecchia numerica che
      // resta vuota per costruzione). Per i rilievi precedenti resta assente,
      // ed è dichiarata tale: mai un valore inventato.
      confidence: m.confidenza_ai_testo || '',
      confidence_reason: m.confidence_reason || '',
      sintesi_generale: m.sintesi_generale || '',
      note_morfologiche: m.note_morfologiche || '',
      metodo: m.metodo_rilievo || 'misure_manuali',
      altezza_totale_m: m.altezza_totale_m,
      altezza_inserzione_chioma_m: m.altezza_inserzione_m,
      larghezza_chioma_m: larghezza,
      profondita_chioma_m: larghezza,
      crown_ratio: m.crown_ratio,
      snellezza: m.snellezza,
      cd_specie: cd,
      raggi: raggi,
      densita_visiva: m.densita_visiva,
      forma_chioma: m.forma_chioma,
      simmetria_chioma: m.simmetria_chioma,
      inclinazione_strutturale_gradi: m.inclinazione_strutturale_gradi || 0,
      direzione_inclinazione_gradi: m.direzione_inclinazione_gradi || 0
    };
    var circ = (m.dbh_cm != null) ? Math.round(m.dbh_cm * Math.PI * 10) / 10 : null;

    // 3) Campi del form (coerenza visiva; l'invio resta comunque bloccato).
    set('treeCode', b.tree_id);
    set('treeSpecies', b.specie || '');
    set('soilType', b.tipo_terreno || '');
    set('tipoFusto', b.tipo_fusto || '');
    if (circ != null) set('dbh', circ);
    set('altezzaManuale', m.altezza_totale_m);
    set('inserzioneManuale', m.altezza_inserzione_m);
    set('ragNord', m.raggio_nord_m); set('ragEst', m.raggio_est_m);
    set('ragSud', m.raggio_sud_m); set('ragOvest', m.raggio_ovest_m);

    // v2 — valutazione agronomo per intero. In v1 tornava (e si ripristinava)
    // solo il nome: nel report rigenerato esito, data e note erano vuoti.
    set('saluteAgronomo', b.salute_agronomo || '');
    set('saluteEsito', b.salute_esito || '');
    set('saluteData', b.salute_data || '');
    set('saluteNote', b.salute_note || '');

    // v2 — coefficiente aerodinamico e forma della chioma: i report leggono
    // PRIMA questi campi a schermo e solo come ripiego l'oggetto risultato.
    // Si scrivono entrambi i selettori della forma (modalità A e B): quello
    // che non ha l'opzione corrispondente resta vuoto e cede il posto all'altro.
    if (cd != null) set('cdSpecie', cd);
    set('formaChioma', m.forma_chioma || '');
    set('formaChiomaDense', m.forma_chioma || '');

    // v2 — "sensore orientato a Nord": è una casella, non un campo di testo.
    var nordEl = document.getElementById('sensoreNord');
    if (nordEl) nordEl.checked = !!m.sensore_nord;

    // 4) v2 — le due memorie interne del form da cui i report leggono in modo
    //    diretto, senza passare né dai campi né dall'oggetto risultato.
    ripristinaGps(b);
    ripristinaSensori(elencoSensori);

    // 5) Dichiarazione di ricostruzione, PRIMA di disegnare la schermata.
    ricostruzione = {
      tree_id: b.tree_id,
      data_rilievo: m.data_rilievo || '',
      data_osservazione: b.vra_pericolo_data_oss || '',
      mancanti: elencoMancanti(b, m, elencoSensori)
    };

    // 6) Schermata dei risultati (monta anche il pannello VRA, via patch).
    _inRipristino = true;
    try {
      window.showResults(res, m.soglia_tilt_base_gradi, m.dbh_cm, circ);
    } catch (e) {
      _inRipristino = false;
      ricostruzione = null;
      alert('Non è stato possibile ricostruire la schermata: ' + (e.message || e));
      return;
    }
    _inRipristino = false;

    correggiBadgeConfidenza(res.confidence);
    ripresa = b.tree_id;

    // 7) Apertura del pannello e riempimento della bozza.
    setTimeout(function () { riempiPannello(b); }, 120);
  }

  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function testo(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = String(v);
  }

  // Il badge nasce dalla confidenza: senza valore mostrerebbe "confidenza ?",
  // che non dice nulla a chi guarda. Meglio scriverlo a lettere.
  // v3: se la confidenza VERA è stata archiviata (rilievi dal 18/07/2026), il
  // badge che il form ha già disegnato è corretto e non va toccato.
  function correggiBadgeConfidenza(valore) {
    if (valore) return;
    var el = document.getElementById('confidenceBadge');
    if (el) el.textContent = 'confidenza non disponibile';
  }

  // ── v2: le memorie interne del form ────────────────────────────────────
  // `gpsData` e `sensori` sono variabili di analisi-albero-logic.js. Sono
  // raggiungibili da qui perché quel file non è chiuso in un involucro: è la
  // stessa porta che arete-vra-logic.js e vra-bersaglio-guard.js già usano per
  // leggere `lastResult`. Si modificano SUL POSTO invece di riassegnarle, così
  // non si dipende da come sono state dichiarate.

  function ripristinaGps(b) {
    var lat = numOrNull(b.lat), lng = numOrNull(b.lng);
    // v3.1: l'accuratezza ORA esiste sul server (colonna aggiunta dal blocco 3
    // e restituita da vra-bozze v3). In v2 era forzata a null con la nota
    // "mai salvata sul server": vero allora, falso da oggi. Il CSV la legge da
    // qui, non dall'oggetto risultato, quindi restava vuota anche quando il
    // dato c'era.
    var acc = numOrNull(b.gps_accuratezza_m);
    try {
      if (typeof gpsData !== 'undefined' && gpsData) {
        gpsData.lat = lat;
        gpsData.lng = lng;
        gpsData.acc = acc;
      }
    } catch (e) {}
    if (lat != null) set('gpsLatManual', lat);
    if (lng != null) set('gpsLngManual', lng);
    testo('gpsLat', lat != null ? lat : '—');
    testo('gpsLng', lng != null ? lng : '—');
    testo('gpsAcc', acc != null ? '\u00b1' + acc + ' m' : 'non disponibile');

    // v3.1: il riquadro delle coordinate nasce con la classe `hidden` e viene
    // scoperto da `getGPS()` o dall'inserimento manuale. Dopo una ripresa non
    // succede né l'uno né l'altro: i valori venivano scritti dentro un riquadro
    // invisibile, e a schermo la posizione sembrava assente pur essendoci.
    if (lat != null && lng != null) {
      var box = document.getElementById('gpsCoords');
      if (box) box.classList.remove('hidden');
      var st = document.getElementById('gpsStatus');
      if (st) st.textContent = 'Posizione ricostruita dall\u2019archivio (nessuna nuova rilevazione).';
    }
  }

  function ripristinaSensori(elenco) {
    try {
      if (typeof sensori === 'undefined' || !sensori) return;
      sensori.length = 0;
      (elenco || []).forEach(function (s) {
        if (!s || !s.device_eui) return;
        sensori.push({ deveui: s.device_eui, note: s.note || '' });
      });
    } catch (e) { return; }
    try { renderSensori(); } catch (e) {}
  }

  // ── v2: cosa il documento ricostruito NON contiene ─────────────────────
  // Calcolato guardando ciò che è tornato vuoto, non scritto a mano: così si
  // accorcia da solo man mano che l'archivio si riempie.
  //
  // v3 — CORREZIONE. In v2 le prime quattro voci leggevano da `b` (la riga di
  // `alberi`) con nomi ipotizzati prima che le colonne esistessero. Tre erano
  // sbagliate: i testi e la foto stanno su `morfologia` (cioè in `m`), e la
  // colonna della foto si chiama `foto_path`, non `foto_archivio_path`. Con i
  // nomi errati l'elenco avrebbe dichiarato "non contiene la sintesi" anche
  // per un report che la contiene — un'assenza inventata, lo specchio del
  // vecchio 'media'. Solo `gps_accuratezza_m` era giusta: sta davvero su
  // `alberi`, accanto a lat/lng.
  // v4 (03/08/2026) — l'elenco delle assenze si compone quando si RIPRENDE la
  // bozza, mentre le fotografie vengono recuperate dall'archivio più tardi, al
  // clic sul pulsante del report. Perciò non si può togliere la voce quando
  // l'elenco nasce: in quel momento non è ancora successo niente. Si toglie
  // qui, nel momento in cui l'elenco viene SCRITTO nel documento — che è
  // l'unico istante in cui si sa davvero cosa il documento contiene.
  function mancantiOra() {
    var lista = (ricostruzione && ricostruzione.mancanti) ? ricostruzione.mancanti.slice() : [];
    var recuperate = 0;
    try {
      var dep = window.fotoReport ? window.fotoReport.deposito() : null;
      var campo = document.getElementById('treeCode');
      var codice = campo ? campo.value.trim() : '';
      if (dep && dep.albero === codice) recuperate = dep.recuperate || 0;
    } catch (e) {}
    if (recuperate > 0) {
      lista = lista.filter(function (v) { return v.indexOf('fotografie') < 0; });
    }
    return lista;
  }
  function elencoMancanti(b, m, elencoSensori) {
    var out = [];

    // Le fotografie non entrano mai in un report rigenerato: il pacchetto ZIP
    // le prende dai campi del form, che dopo una ripresa sono vuoti. Ma se una
    // è in archivio, vale la pena dire dove: è la differenza fra "non ce l'ho"
    // e "non è qui dentro".
    if (m.foto_path) {
      out.push('le fotografie del rilievo (una \u00e8 archiviata: ' + m.foto_path + ')');
    } else {
      out.push('le fotografie del rilievo');
    }
    // (22/09/2026) Qui c'era una graffa di troppo, che chiudeva la funzione a
    // metà e rendeva illeggibile l'INTERO file: il browser non ne eseguiva
    // nemmeno una riga, senza mostrare nessun errore a schermo.
    if (!m.sintesi_generale && !m.note_morfologiche) out.push('la sintesi e le note dell\u2019analisi AI');
    if (!m.confidenza_ai_testo) out.push('la confidenza della stima');
    if (numOrNull(b.gps_accuratezza_m) == null) out.push('l\u2019accuratezza del GPS');
    if (numOrNull(b.lat) == null || numOrNull(b.lng) == null) out.push('la posizione GPS');
    if (!b.salute_esito && !b.salute_agronomo) out.push('la valutazione agronomo');
    if (!(elencoSensori && elencoSensori.length)) out.push('l\u2019elenco dei sensori');
    if (!m.data_rilievo) out.push('la data del rilievo originale');
    if (!m.metodo_rilievo) out.push('il metodo di rilievo');
    return out;
  }

  // ── v2: la dichiarazione sui report ────────────────────────────────────
  // Nessun generatore di report viene toccato. Ci si aggancia ai tre punti di
  // estensione che il modulo VRA già espone (`window.vraExtra`), gli stessi
  // che arete-vra-logic.js usa per infilare la VRA in CSV, DOCX e "Copia tutto".
  function installaDichiarazione() {
    if (!window.vraExtra) return setTimeout(installaDichiarazione, 400);
    if (window.vraExtra.__vraSospDich) return;
    window.vraExtra.__vraSospDich = true;

    var _csv = window.vraExtra.csvRows;
    window.vraExtra.csvRows = function () {
      var righe = [];
      try { righe = _csv.apply(this, arguments) || []; } catch (e) {}
      // Le tre colonne si aggiungono SEMPRE, anche a un rilievo normale, dove
      // restano quasi vuote. Se comparissero solo nelle ricostruzioni, i CSV
      // non sarebbero più incollabili uno sotto l'altro: le colonne andrebbero
      // fuori posto. Meglio una colonna vuota che una tabella disallineata.
      righe.push(['report_tipo', ricostruzione ? 'ricostruzione da database' : 'rilievo originale']);
      righe.push(['report_data_rilievo_originale',
        ricostruzione ? (ricostruzione.data_rilievo || 'non registrata') : '']);
      righe.push(['report_non_contiene',
        ricostruzione ? mancantiOra().join('; ') : '']);
      return righe;
    };

    var _lin = window.vraExtra.reportLines;
    window.vraExtra.reportLines = function () {
      var L = [];
      try { L = _lin.apply(this, arguments) || []; } catch (e) {}
      if (!ricostruzione) return L;
      return L.concat(righeDichiarazione());
    };

    var _dcx = window.vraExtra.docxChildren;
    window.vraExtra.docxChildren = function (docx) {
      var ch = [];
      try { ch = _dcx.apply(this, arguments) || []; } catch (e) {}
      if (!ricostruzione || !docx) return ch;
      try { ch = ch.concat(docxDichiarazione(docx)); } catch (e) {}
      return ch;
    };
  }

  function oggiLeggibile() {
    try { return new Date().toLocaleString('it-IT'); } catch (e) { return oggiISO(); }
  }

  function righeDichiarazione() {
    var sep = '\u2500'.repeat(40);
    return ['', 'AVVERTENZA \u2014 DOCUMENTO RICOSTRUITO', sep,
      'Questo non \u00e8 il documento originale del rilievo: \u00e8 stato rigenerato',
      'da database il ' + oggiLeggibile() + '.',
      'Rilievo originale:     ' + (ricostruzione.data_rilievo || 'data non registrata'),
      'Pericolosit\u00e0 osservata: ' + (ricostruzione.data_osservazione || 'data non registrata'),
      'Non contiene:          ' + mancantiOra().join('; ') + '.'];
  }

  function docxDichiarazione(docx) {
    var Paragraph = docx.Paragraph, TextRun = docx.TextRun, HeadingLevel = docx.HeadingLevel;
    var GIALLO = '8A6D1F', INK = '15211A';
    var ch = [];
    ch.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 },
      children: [new TextRun({ text: '\u26a0 Avvertenza \u2014 documento ricostruito', bold: true, color: GIALLO, size: 24 })]
    }));
    ch.push(new Paragraph({
      children: [new TextRun({
        text: 'Questo report non \u00e8 il documento originale del rilievo. \u00c8 stato rigenerato ' +
          'da database il ' + oggiLeggibile() + ', riprendendo una valutazione sospesa. ' +
          'I dati morfologici provengono dall\u2019archivio, non da una nuova osservazione.',
        size: 20, color: INK
      })]
    }));
    ch.push(new Paragraph({
      spacing: { before: 100 },
      children: [new TextRun({
        text: 'Rilievo originale: ' + (ricostruzione.data_rilievo || 'data non registrata') +
          ' \u00b7 Pericolosit\u00e0 osservata: ' + (ricostruzione.data_osservazione || 'data non registrata'),
        size: 20, color: INK
      })]
    }));
    ch.push(new Paragraph({
      spacing: { before: 100 },
      children: [new TextRun({
        text: 'Non contiene: ' + mancantiOra().join('; ') + '.',
        size: 20, color: INK
      })]
    }));
    return ch;
  }

  function set(id, v) {
    var el = document.getElementById(id);
    if (el && v != null && v !== '') el.value = v;
  }

  function riempiPannello(b) {
    var panel = document.getElementById('vraPanel');
    if (!panel) { avviso('Pannello VRA non disponibile.', 'err'); return; }
    // Il pannello si costruisce al primo click: forziamolo se non è ancora fatto.
    if (!panel.dataset.built) {
      try { window.vraTogglePanel(); } catch (e) {}
    }
    setTimeout(function () {
      set('vraP_radice', b.vra_pericolo_radice);
      set('vraP_colletto', b.vra_pericolo_colletto);
      set('vraP_fusto', b.vra_pericolo_fusto);
      set('vraP_rami', b.vra_pericolo_rami);

      // L'interruttore albero/branca va mosso PRIMA di riempire i tre numeri:
      // il blocco della branca è nascosto finché non lo si seleziona.
      if (b.vra_impulso_tipo === 'branca') {
        set('vraImpTipo', 'branca');
        try { window.vraImpTipoChange(); } catch (e) {}
        set('vraImpDram', b.vra_impulso_branca_diam_cm);
        set('vraImpLram', b.vra_impulso_branca_lung_m);
        set('vraImpHins', b.vra_impulso_branca_hins_m);
      }
      set('vraNoteOss', b.vra_pericolo_note);
      try { window.vraLive(); } catch (e) {}
      mostraBannerRipresa(b);
      avviso('\u2713 Bozza caricata: completa bersaglio, valore e aspettativa, poi \u201cConcludi\u201d.', 'ok');
    }, 150);
  }

  function mostraBannerRipresa(b) {
    var host = document.getElementById('vraBlock');
    if (!host || document.getElementById('vraBanner')) return;
    var d = document.createElement('div');
    d.id = 'vraBanner';
    d.style.cssText = 'background:#fff6e0;border:1px solid #e2c98a;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:13px';
    d.innerHTML = 'Stai completando la VRA di <strong>' + esc(b.tree_id) + '</strong>' +
      (b.vra_pericolo_data_oss ? ' \u2014 pericolosit\u00e0 osservata il ' + esc(b.vra_pericolo_data_oss) : '') +
      '.<br>Al termine usa <strong>Concludi VRA</strong>: il pulsante \u201cInvia\u201d \u00e8 disattivato, perch\u00e9 rispedirebbe anche le misure e sovrascriverebbe il rilievo.';
    host.insertBefore(d, host.firstChild);
  }

  // ── Azione: CONCLUDI (solo per VRA riprese) ────────────────────────────
  async function concludi() {
    if (!ripresa) { avviso('Nessuna VRA ripresa in corso.', 'err'); return; }
    var esiti = {};
    try { esiti = window.vraExtra.payload() || {}; } catch (e) {}
    if (!esiti.vra_compilata) {
      avviso('\u26a0\ufe0f La valutazione non \u00e8 ancora completa: mancano dati in bersaglio, valore o aspettativa.', 'err');
      return;
    }
    var corpo = raccogliBozza() || {};
    corpo.tree_id = ripresa;
    Object.keys(esiti).forEach(function (k) { corpo[k] = esiti[k]; });

    avviso('Conclusione in corso\u2026');
    var r = await api('POST', 'completa', corpo);
    if (r.ok) {
      ripresa = null;
      var ban = document.getElementById('vraBanner');
      if (ban) ban.parentNode.removeChild(ban);
      avviso('\u2713 VRA conclusa e salvata.', 'ok');
    } else if (r.offline) {
      avviso('\u26a0\ufe0f Nessuna rete: riprova quando torna la connessione (i dati restano a schermo).', 'err');
    } else {
      avviso('\u26a0\ufe0f Non salvata: ' + r.msg, 'err');
    }
  }

  // ── Innesto dei pulsanti nel pannello VRA ──────────────────────────────
  function innestaPulsanti() {
    var host = document.getElementById('vraBlock');
    if (!host || document.getElementById('vraSospBar')) return;

    var bar = document.createElement('div');
    bar.id = 'vraSospBar';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 10px';
    bar.innerHTML =
      '<button id="vraSospBtn" class="btn btn-ghost" style="cursor:pointer">\u23f8 Sospendi VRA</button>' +
      '<button id="vraConclBtn" class="btn btn-ghost" style="cursor:pointer">\u2705 Concludi VRA</button>' +
      '<span id="vraSospStatus" style="font-size:13px;color:#6a7a70"></span>';
    host.appendChild(bar);

    document.getElementById('vraSospBtn').onclick = sospendi;
    document.getElementById('vraConclBtn').onclick = concludi;

    // Campo note sull'osservazione, se il pannello è già costruito.
    innestaNote();
  }

  function innestaNote() {
    var panel = document.getElementById('vraPanel');
    if (!panel || document.getElementById('vraNoteOss')) return;
    var primo = panel.querySelector('.vra-acc-body');
    if (!primo) return;
    var d = document.createElement('div');
    d.className = 'field';
    d.innerHTML = '<label class="lbl">Note sull\u2019osservazione <span class="opt">\u2014 cosa hai visto, per rileggerlo fra settimane</span></label>' +
      '<textarea id="vraNoteOss" rows="2" placeholder="es. carpoforo alla base, corteccia inclusa sul castello"></textarea>';
    primo.appendChild(d);
  }

  // Launcher dell'elenco, sempre raggiungibile.
  function innestaLauncher() {
    if (document.getElementById('vraElencoBtn')) return;
    var b = document.createElement('button');
    b.id = 'vraElencoBtn';
    b.textContent = '\ud83d\udccb VRA da completare';
    b.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9997;background:' + VERDE +
      ';color:#fff;border:0;border-radius:20px;padding:9px 14px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)';
    b.onclick = apriElenco;
    document.body.appendChild(b);
  }

  // ── Blocco dell'invio normale durante una ripresa ───────────────────────
  // Senza questo, concludere una VRA ripresa rispedirebbe l'intero payload del
  // rilievo con i campi morfologici letti dal form: se non sono stati
  // ripopolati alla perfezione, la morfologia dell'albero verrebbe azzerata.
  function proteggiInvio() {
    if (typeof window.inviaAlFoglio !== 'function' || window.inviaAlFoglio.__vraSosp) {
      return setTimeout(proteggiInvio, 400);
    }
    var _orig = window.inviaAlFoglio;
    window.inviaAlFoglio = function () {
      if (ripresa) {
        avviso('\u26a0\ufe0f Stai completando una VRA ripresa: usa \u201cConcludi VRA\u201d, non \u201cInvia\u201d.', 'err');
        return;
      }
      return _orig.apply(this, arguments);
    };
    window.inviaAlFoglio.__vraSosp = true;
  }

  // ── Aggancio al montaggio del pannello VRA ─────────────────────────────
  function installa() {
    if (typeof window.showResults !== 'function') return setTimeout(installa, 300);
    if (window.showResults.__vraSosp) return;

    var _sr = window.showResults;
    window.showResults = function () {
      // v2 — se questa schermata NON arriva da un ripristino, allora è
      // un'analisi vera: la dichiarazione di ricostruzione va spenta, altrimenti
      // il rilievo successivo erediterebbe l'avvertenza del precedente.
      if (!_inRipristino) ricostruzione = null;
      var out = _sr.apply(this, arguments);
      try { setTimeout(innestaPulsanti, 60); } catch (e) {}
      return out;
    };
    window.showResults.__vraSosp = true;

    // Il pannello si costruisce al primo click: agganciamo lì il campo note.
    if (typeof window.vraTogglePanel === 'function' && !window.vraTogglePanel.__vraSosp) {
      var _tp = window.vraTogglePanel;
      window.vraTogglePanel = function () {
        var out = _tp.apply(this, arguments);
        try { setTimeout(innestaNote, 30); } catch (e) {}
        return out;
      };
      window.vraTogglePanel.__vraSosp = true;
    }

    innestaLauncher();
    proteggiInvio();
    installaDichiarazione();   // v2
    svuotaCoda(true);
  }

  // Ritenta l'invio delle bozze in coda appena torna la connessione.
  window.addEventListener('online', function () { svuotaCoda(false); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installa);
  } else {
    installa();
  }
  setTimeout(installa, 400);

  // Esposto per diagnosi da console.
  window.vraSospendi = {
    versione: 'vra-sospendi v3.1 (20/07/2026)',
    sospendi: sospendi,
    elenco: apriElenco,
    riprendi: riprendi,
    concludi: concludi,
    coda: leggiCoda,
    svuotaCoda: svuotaCoda,
    // Diagnosi del ripristino: null in un rilievo normale, valorizzato dopo
    // una ripresa, con dentro l'elenco di ciò che il report non contiene.
    ricostruzione: function () { return ricostruzione; }
  };
})();
