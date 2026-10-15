// ============================================================================
// PARCO IoT — add-on `codice-albero-guard.js`
// ============================================================================
// Avvisa PRIMA dell'invio quando il codice albero digitato esiste già, e mostra
// di chi è, così chi rileva può accorgersi di un errore di battitura prima che
// sovrascriva il lavoro di qualcun altro.
//
// ─────────────────────────────────────────────────────────────────────────
// PERCHÉ SERVE
// `rilievo` fa un upsert: "inserisci se non c'è, aggiorna se c'è". È giusto —
// un albero va rilevato di nuovo negli anni e il secondo rilievo deve
// aggiornare il primo, non creare un doppione. Ma per il sistema un RILIEVO
// RIPETUTO e un ERRORE DI BATTITURA sono lo stesso identico gesto.
//
// Se il codice coincide per sbaglio con un albero esistente, oggi succede
// questo, senza un solo avviso:
//   • la morfologia viene sostituita, e un trigger ricalcola subito
//     `soglia_tilt_base_gradi`: se quell'albero ha un sensore, il suo tilt
//     viene da quel momento giudicato contro la soglia di un'altra pianta;
//   • `nome_comune` resta quello vecchio (si imposta solo alla creazione),
//     quindi in tabella si continua a leggere il nome sbagliato;
//   • i sensori elencati nel nuovo rilievo vengono riassegnati;
//   • la VRA viene PRESERVATA: un giudizio di rischio calcolato su un albero
//     resta attaccato alle misure di un altro;
//   • (dal blocco 3) la foto finisce nella cartella del primo albero, che
//     smette di essere una sequenza temporale della stessa pianta.
//
// PERCHÉ AVVISA E NON BLOCCA
// Rilevare di nuovo lo stesso albero è legittimo e frequente: impedirlo
// sarebbe un danno peggiore. La decisione resta a chi è davanti alla pianta;
// questo add-on si limita a metterlo di fronte a ciò che sta per sostituire.
//
// ⚠ CARICARE PER ULTIMO nell'HTML, dopo `archivio-foto.js`:
//     <script src="codice-albero-guard.js"></script>
// Deve essere il più esterno di tutti: se si annulla, non deve partire nulla —
// né l'invio, né la doppia scrittura, né l'archiviazione della foto.
//
// SE NON PUÒ VERIFICARE, LASCIA PASSARE
// La verifica passa dallo sportello `vra-bozze`, che richiede la parola
// d'ordine. Su un dispositivo che non ce l'ha, il controllo non è possibile:
// in quel caso l'invio prosegue e viene solo dichiarato che non si è potuto
// verificare. Fermare il lavoro per un controllo mancato sarebbe sproporzionato.
// ============================================================================

(function () {
  'use strict';

  var URL_DEFAULT = 'https://sldotadtisgekovgvsqr.supabase.co/functions/v1/vra-bozze';
  var K_URL = 'vraBozzeUrl', K_SEC = 'vraSecret';

  var VERDE = '#2f6b4f', ECRU = '#f6f4ec', ROSSO = '#a4472f', FAINT = '#6a7a70';

  // Codici per cui l'operatore ha già confermato "sì, sto aggiornando quello",
  // in questa sessione. Evita di ripetere la domanda a ogni reinvio dello
  // stesso albero — che durante le prove capita di continuo.
  var confermati = {};

  function getUrl() {
    try {
      var u = localStorage.getItem(K_URL);
      if (u && /^https?:\/\//.test(u)) return u.trim();
    } catch (e) {}
    return URL_DEFAULT;
  }

  function getSegreto() {
    try { return localStorage.getItem(K_SEC) || null; } catch (e) { return null; }
  }

  // ── Riga di stato, la stessa usata dall'archivio se c'è ────────────────
  function nota(testo, colore) {
    var el = document.getElementById('archivioStatus');
    if (!el) {
      var dopo = document.getElementById('sendStatus');
      if (!dopo || !dopo.parentNode) return;
      el = document.createElement('div');
      el.id = 'archivioStatus';
      el.style.cssText = 'margin-top:6px;font-size:13px;line-height:1.45;';
      dopo.parentNode.insertBefore(el, dopo.nextSibling);
    }
    el.style.color = colore || FAINT;
    el.textContent = testo;
  }

  // ── Interrogazione allo sportello ──────────────────────────────────────
  // Ritorna: {stato:'libero'} | {stato:'esiste', dati} | {stato:'ignoto', msg}
  async function verifica(treeId) {
    var seg = getSegreto();
    if (!seg) return { stato: 'ignoto', msg: 'parola d\u2019ordine non impostata su questo dispositivo' };

    try {
      var r = await fetch(getUrl() + '?action=bozza&tree_id=' + encodeURIComponent(treeId), {
        headers: { 'x-parco-secret': seg }
      });
      if (r.status === 404) return { stato: 'libero' };
      if (!r.ok) return { stato: 'ignoto', msg: 'lo sportello ha risposto ' + r.status };
      var d = await r.json();
      if (!d || !d.ok || !d.bozza) return { stato: 'ignoto', msg: 'risposta non interpretabile' };
      return { stato: 'esiste', dati: d };
    } catch (e) {
      return { stato: 'ignoto', msg: 'rete non raggiungibile' };
    }
  }

  // ── Descrizione leggibile di ciò che si sta per sostituire ─────────────
  function descrivi(d) {
    var b = d.bozza || {}, m = d.morfologia || {}, s = d.sensori || [];
    var righe = [];

    var nome = b.nome_comune && b.nome_comune !== b.tree_id ? b.nome_comune : null;
    var specie = b.specie || null;
    if (nome && specie) righe.push(['Registrato come', nome + ' (' + specie + ')']);
    else if (nome) righe.push(['Registrato come', nome]);
    else if (specie) righe.push(['Specie', specie]);

    if (m.data_rilievo) righe.push(['Ultimo rilievo', m.data_rilievo]);
    if (m.dbh_cm != null || m.altezza_totale_m != null) {
      righe.push(['Misure attuali',
        (m.dbh_cm != null ? 'DBH ' + m.dbh_cm + ' cm' : '') +
        (m.dbh_cm != null && m.altezza_totale_m != null ? ' \u00b7 ' : '') +
        (m.altezza_totale_m != null ? 'altezza ' + m.altezza_totale_m + ' m' : '')]);
    }
    if (b.salute_esito) righe.push(['Valutazione agronomo', b.salute_esito]);

    if (s.length) {
      righe.push(['Sensori associati', s.map(function (x) { return x.device_eui; }).join(', ')]);
    }

    return righe;
  }

  // Cosa si perde davvero, detto senza giri di parole.
  function conseguenze(d) {
    var b = d.bozza || {}, s = d.sensori || [];
    var out = [];
    if (s.length) {
      out.push('La soglia di allarme del sensore verr\u00e0 ricalcolata sulle NUOVE misure.');
    }
    if (b.vra_compilata) {
      out.push('La valutazione del rischio (VRA) resta attaccata a questo codice, ma riferita alle nuove misure.');
    }
    if (b.vra_stato === 'sospesa') {
      out.push('C\u2019\u00e8 una VRA SOSPESA su questo albero, in attesa di essere completata.');
    }
    out.push('Le misure morfologiche, la specie, la posizione e la valutazione agronomo verranno sostituite.');
    return out;
  }

  // ── La domanda ─────────────────────────────────────────────────────────
  function chiedi(treeId, d) {
    return new Promise(function (risolvi) {
      var vecchio = document.getElementById('codiceGuardOverlay');
      if (vecchio) vecchio.parentNode.removeChild(vecchio);

      var ov = document.createElement('div');
      ov.id = 'codiceGuardOverlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;' +
        'display:flex;align-items:center;justify-content:center;padding:16px;';

      var righe = descrivi(d), cons = conseguenze(d);

      var html = '<div style="background:' + ECRU + ';max-width:560px;width:100%;max-height:85vh;' +
        'overflow:auto;border-radius:12px;padding:18px;">' +
        '<strong style="color:' + ROSSO + ';font-size:15px">\u26a0 Questo codice esiste gi\u00e0</strong>' +
        '<p style="margin:10px 0 4px;font-size:14px;line-height:1.5">Il codice <strong>' +
        esc(treeId) + '</strong> \u00e8 gi\u00e0 in archivio. Se stai <em>ri-rilevando</em> quell\u2019albero, ' +
        'prosegui pure. Se invece \u00e8 un albero nuovo, cambia il codice: inviando adesso ' +
        'sostituiresti i dati qui sotto.</p>' +
        '<div style="margin:12px 0;padding:10px 12px;background:#fff;border-radius:8px;font-size:13px">';

      if (!righe.length) {
        html += '<div style="color:' + FAINT + '">Nessun dettaglio disponibile per questo albero.</div>';
      } else {
        righe.forEach(function (r) {
          html += '<div style="margin:3px 0"><span style="color:' + FAINT + '">' + esc(r[0]) +
            ':</span> <strong>' + esc(r[1]) + '</strong></div>';
        });
      }
      html += '</div>';

      html += '<div style="font-size:13px;line-height:1.5;color:' + ROSSO + '"><strong>Proseguendo:</strong><ul style="margin:6px 0 0;padding-left:18px">';
      cons.forEach(function (c) { html += '<li style="margin:2px 0">' + esc(c) + '</li>'; });
      html += '</ul></div>';

      html += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">' +
        '<button id="cgAnnulla" style="flex:1 1 200px;background:' + VERDE + ';color:#fff;border:0;' +
        'border-radius:8px;padding:11px;font-size:14px;cursor:pointer">Annulla e correggi il codice</button>' +
        '<button id="cgProsegui" style="flex:1 1 160px;background:none;color:' + ROSSO + ';' +
        'border:1px solid ' + ROSSO + ';border-radius:8px;padding:11px;font-size:14px;cursor:pointer">' +
        'S\u00ec, sto aggiornando questo albero</button>' +
        '</div></div>';

      ov.innerHTML = html;
      document.body.appendChild(ov);

      function chiudi(risposta) {
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        risolvi(risposta);
      }

      // Il pulsante "sicuro" è quello grande e verde: annullare è la scelta
      // che non fa danni, quindi è quella che si preme per sbaglio.
      document.getElementById('cgAnnulla').onclick = function () { chiudi(false); };
      document.getElementById('cgProsegui').onclick = function () { chiudi(true); };
      ov.onclick = function (e) { if (e.target === ov) chiudi(false); };
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Aggancio ───────────────────────────────────────────────────────────
  function installa() {
    if (typeof window.inviaAlFoglio !== 'function' || window.inviaAlFoglio.__codiceGuard) {
      return setTimeout(installa, 400);
    }
    var _orig = window.inviaAlFoglio;

    window.inviaAlFoglio = async function () {
      var self = this, args = arguments;

      var el = document.getElementById('treeCode');
      var treeId = el ? el.value.trim() : '';

      // Nessun codice: se ne occupa la catena a valle, che ha già i suoi
      // messaggi. Qui non c'è niente da confrontare.
      if (!treeId) return _orig.apply(self, args);

      // Già confermato in questa sessione: non si ripete la domanda.
      if (confermati[treeId]) return _orig.apply(self, args);

      var esito = await verifica(treeId);

      if (esito.stato === 'libero') {
        return _orig.apply(self, args);
      }

      if (esito.stato === 'ignoto') {
        // Non si blocca il lavoro per un controllo mancato, ma lo si dichiara.
        nota('\u2139 Non ho potuto verificare se il codice \u201c' + treeId + '\u201d esiste gi\u00e0 (' +
          esito.msg + '). L\u2019invio prosegue.', FAINT);
        return _orig.apply(self, args);
      }

      var prosegui = await chiedi(treeId, esito.dati);
      if (!prosegui) {
        nota('Invio annullato: correggi il codice albero e riprova.', ROSSO);
        try { el.focus(); el.select(); } catch (e) {}
        return;
      }

      confermati[treeId] = true;
      return _orig.apply(self, args);
    };
    window.inviaAlFoglio.__codiceGuard = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installa);
  } else {
    installa();
  }
  setTimeout(installa, 300);

  // Esposto per diagnosi da console.
  window.codiceGuard = {
    versione: 'codice-albero-guard v1 (18/07/2026)',
    verifica: verifica,
    dimenticaConferme: function () { confermati = {}; }
  };
})();
