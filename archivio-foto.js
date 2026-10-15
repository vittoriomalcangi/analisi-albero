// ============================================================================
// PARCO IoT — add-on `archivio-foto.js`  —  v3.1 (22/09/2026)
// ============================================================================
// Archivia, DOPO ogni invio riuscito, i tre testi dell'analisi, la confidenza
// in parole, l'accuratezza del GPS e — da questa versione — TUTTE le fotografie
// del rilievo, non più una sola. Parla con la Edge Function `archivio`.
//
// ─────────────────────────────────────────────────────────────────────────
// COSA CAMBIA RISPETTO ALLA v2
//
// 1) TUTTE LE FOTO, NON UNA.
//    La v2 ne archiviava una sola (chioma Nord, o la prima utile). Il resto
//    viveva nella memoria della pagina e spariva alla ricarica: un report
//    rigenerato da una VRA ripresa restava senza immagini, e delle sei foto di
//    una valutazione se ne conservava una. Per un giudizio di rischio su un
//    albero che può cadere addosso a qualcuno, le fotografie sono la prova di
//    cosa si sapeva quel giorno — la stessa ragione per cui i dati grezzi dei
//    sensori non si cancellano mai.
//
// 2) TETTO DI PESO, NON QUALITÀ FISSA.
//    La v2 comprimeva sempre a 1600 px e qualità 0,8: una chioma fitta di
//    foglie arrivava a 700 KB, un tronco su cielo uniforme a 200. Con 200
//    alberi per parco quella variabilità decide se lo spazio basta o no. Qui
//    si comprime finché la foto non sta sotto un tetto dichiarato (250 KB),
//    scendendo prima di qualità e solo dopo di dimensione: sotto i 1200 px si
//    perde il dettaglio della corteccia, ed è proprio quello che una foto di
//    valutazione deve poter dimostrare.
//    Conti a 250 KB: 200 alberi × 3 foto ≈ 150 MB per campagna.
//
// 3) NIENTE PIÙ PAROLA D'ORDINE.
//    Dal 03/08/2026 `archivio` riconosce chi scrive dal login del form, e il
//    lasciapassare viene allegato automaticamente da `codice-parco-prefisso.js`.
//    Sparisce la richiesta della parola d'ordine, sparisce il segreto conservato
//    nel browser, e un errore 401 ora significa "sessione scaduta, rifare il
//    login" invece di "parola sbagliata".
//
// 4) UNA CHIAMATA PER FOTO.
//    Non un unico pacchetto con dentro tutte le immagini: su rete mobile in un
//    parco, se salta la quarta foto si ripete solo quella. La prima chiamata
//    porta anche i testi e il GPS; le successive solo la loro immagine.
//
// ─────────────────────────────────────────────────────────────────────────
// LA REGOLA CHE VIENE PRIMA DI TUTTE: NON BLOCCARE MAI IL RILIEVO
//   • l'invio parte e si conclude ESATTAMENTE come prima; l'archiviazione
//     avviene dopo, staccata, e il suo esito non torna mai al chiamante;
//   • non chiede mai niente durante l'invio;
//   • qualunque errore finisce nella riga di stato dell'archivio, mai in
//     quella del rilievo.
//
// PERCHÉ SOLO DOPO UN INVIO RIUSCITO
// `archivio` fa UPDATE e non crea righe: se il rilievo non è ancora arrivato
// risponde 409. Si aspetta la conferma che SUPABASE abbia ricevuto — non
// l'esito verde complessivo, che tace se il foglio Google cade (v3.1) — e in
// caso di 409 si riprova due volte, perché la riga potrebbe essere in viaggio.
//
// ⚠ CARICARE PER ULTIMO nell'HTML, dopo `vra-bersaglio-guard.js`.
// ============================================================================

(function () {
  'use strict';

  var URL_DEFAULT = 'https://sldotadtisgekovgvsqr.supabase.co/functions/v1/archivio';
  var K_URL = 'archivioUrl';

  var VERDE = '#2f6b4f', FAINT = '#6a7a70', ROSSO = '#a4472f';

  // ── Il tetto di peso ───────────────────────────────────────────────────
  // Si scende prima di qualità, poi di dimensione. L'ultimo gradino si usa
  // comunque anche se resta sopra il tetto: meglio una foto pesante archiviata
  // che nessuna foto.
  var TETTO_BYTE = 250 * 1024;
  var GRADINI = [
    [1600, 0.80],
    [1600, 0.70],
    [1400, 0.66],
    [1200, 0.62],
    [1024, 0.58]
  ];

  // Impronte delle foto già archiviate per ciascun albero IN QUESTA SESSIONE.
  // Serve a distinguere due casi che vanno trattati in modo opposto:
  //   • doppio invio per sbaglio  → stesse foto → non si ricaricano
  //   • scatto rifatto perché mosso → foto diversa → SI ricarica
  // Si azzera ricaricando la pagina; fra campagne diverse la distinzione la
  // garantisce il nome del file, che porta data e ora.
  var fotoFatte = {};

  // ── Configurazione ─────────────────────────────────────────────────────
  function getUrl() {
    try {
      var u = localStorage.getItem(K_URL);
      if (u && /^https?:\/\//.test(u)) return u.trim();
    } catch (e) {}
    return URL_DEFAULT;
  }

  // ── Riga di stato dedicata ─────────────────────────────────────────────
  // Volutamente separata da #sendStatus: quella riga appartiene al rilievo e
  // non deve mai essere sovrascritta da noi.
  function riga() {
    var el = document.getElementById('archivioStatus');
    if (el) return el;
    var dopo = document.getElementById('sendStatus');
    if (!dopo || !dopo.parentNode) return null;
    el = document.createElement('div');
    el.id = 'archivioStatus';
    el.style.cssText = 'margin-top:6px;font-size:13px;line-height:1.45;color:' + FAINT + ';';
    dopo.parentNode.insertBefore(el, dopo.nextSibling);
    return el;
  }

  function stato(testo, tipo) {
    var el = riga();
    if (!el) return;
    el.style.color = tipo === 'err' ? ROSSO : (tipo === 'ok' ? VERDE : FAINT);
    el.textContent = testo;
  }

  // ── Aiutanti ───────────────────────────────────────────────────────────
  function testoDi(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    return s === '' ? null : s;
  }

  function attendi(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // Uint8Array → base64, a blocchi: passare 350 KB in una sola chiamata a
  // String.fromCharCode fa saltare lo stack su alcuni browser.
  function aBase64(bytes) {
    var pezzi = [], BLOCCO = 8192;
    for (var i = 0; i < bytes.length; i += BLOCCO) {
      pezzi.push(String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCCO)));
    }
    return btoa(pezzi.join(''));
  }

  // ── Il rilievo è arrivato dove serve? ──────────────────────────────────
  // v3.1 (22/09/2026). Prima questa funzione guardava se la scritta di
  // conferma del rilievo era VERDE. Ma quella scritta è verde solo se sono
  // andate bene TUTTE le destinazioni: con il foglio Google giù diventava
  // rossa, e le foto non venivano archiviate benché Supabase avesse ricevuto
  // tutto. Si perdevano immagini per un guasto che non c'entrava nulla.
  //
  // Ora `dual-write-supabase.js` dichiara un FATTO per ciascuna destinazione,
  // e qui si legge quello. A noi interessa solo Supabase, perché `archivio`
  // fa UPDATE su una riga che deve già esistere lì; il foglio Google non ha
  // alcun rapporto con l'archiviazione.
  //
  // NESSUN RIPIEGO SUL COLORE se il fatto manca. Ripiegare sembrerebbe
  // prudente e sarebbe la cosa peggiore: la vecchia regola indovina giusto
  // quasi sempre, quindi lo sbaglio resterebbe raro e invisibile. Fatto
  // assente = «non lo so», e ci si ferma dicendolo.
  function esitoInvio(treeIdAtteso) {
    var e = window.__esitoInvio;
    if (!e) {
      return { pronto: false, motivo: 'non risulta un invio in questa pagina' };
    }
    if (treeIdAtteso && e.tree_id && e.tree_id !== treeIdAtteso) {
      return { pronto: false,
        motivo: 'l\u2019ultimo invio riguarda un altro albero (' + e.tree_id + ')' };
    }
    if (!e.supabase) {
      return { pronto: false, motivo: 'Supabase non ha ricevuto il rilievo' };
    }
    return { pronto: true, motivo: '' };
  }

  // ── Raccolta di ciò che va archiviato ──────────────────────────────────
  function raccogli() {
    var dati = { tree_id: null };

    var code = document.getElementById('treeCode');
    dati.tree_id = code ? code.value.trim() : '';
    if (!dati.tree_id) return null;

    var r = null;
    try { if (typeof lastResult !== 'undefined') r = lastResult; } catch (e) {}
    if (r) {
      dati.sintesi_generale = testoDi(r.sintesi_generale);
      dati.note_morfologiche = testoDi(r.note_morfologiche);
      dati.confidence_reason = testoDi(r.confidence_reason);
      dati.confidenza_ai_testo = testoDi(r.confidence);
    }

    try {
      if (typeof gpsData !== 'undefined' && gpsData && gpsData.acc != null) {
        dati.gps_accuratezza_m = gpsData.acc;
      }
    } catch (e) {}

    return dati;
  }

  // Tutte le foto del rilievo, nell'ordine in cui il form le fornisce
  // (chioma Nord, Est, Sud, Ovest, fusto, dal basso). Leggere l'elenco non
  // costa nulla: si guarda solo la scheda del file, non l'immagine.
  function raccogliTutte() {
    if (typeof raccogliFotoRilievo !== 'function' || typeof comprimiImmagine !== 'function') {
      return [];
    }
    var foto;
    try { foto = raccogliFotoRilievo(); } catch (e) { return []; }
    if (!foto || !foto.length) return [];

    return foto.map(function (s) {
      var f = s.file || {};
      return {
        file: s.file,
        direzione: s.label,
        // Impronta: nome, peso e data di scatto. Tre dati che il browser dà
        // senza aprire l'immagine, e bastano a capire se è la stessa foto.
        impronta: [f.name || '', f.size || 0, f.lastModified || 0].join('|')
      };
    });
  }

  // Comprime scendendo di gradino finché non sta sotto il tetto.
  async function comprimiSottoTetto(scelta) {
    var ultimo = null;
    for (var i = 0; i < GRADINI.length; i++) {
      var g = GRADINI[i];
      var c = await comprimiImmagine(scelta.file, g[0], g[1]);
      ultimo = c;
      if (c.bytes.length <= TETTO_BYTE) break;
    }
    return {
      base64: aBase64(ultimo.bytes),
      direzione: scelta.direzione,
      kb: Math.round(ultimo.bytes.length / 1024),
      sopraTetto: ultimo.bytes.length > TETTO_BYTE
    };
  }

  // ── Invio ──────────────────────────────────────────────────────────────
  // Nessuna intestazione di autenticazione qui: il lasciapassare del login lo
  // allega `codice-parco-prefisso.js`, che intercetta le chiamate in uscita.
  // Un posto solo per una regola sola.
  async function spedisci(corpo) {
    var risposta = await fetch(getUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    });
    var testo = await risposta.text();
    var dati = null;
    try { dati = JSON.parse(testo); } catch (e) {}
    return { http: risposta.status, dati: dati, testo: testo };
  }

  function scaduta() {
    // Il testo precedente diceva di premere «Archivia ora»: quel bottone non
    // esiste, esiste solo il comando da console. Un'istruzione che non si può
    // eseguire è peggio di nessuna istruzione. Rinviare il rilievo è sicuro
    // lato Supabase (upsert sul codice albero: aggiorna, non duplica) e fa
    // ripartire l'archiviazione da sé.
    stato('\u26a0 Rilievo inviato. Archivio rifiutato: sessione scaduta. ' +
      'Rifare il login e inviare di nuovo il rilievo: le foto verranno ' +
      'archiviate allora.', 'err');
  }

  // ── Il lavoro vero ─────────────────────────────────────────────────────
  async function archivia() {
    // Prima il codice albero, poi il controllo dell'invio: serve sapere di
    // quale albero stiamo parlando per confrontarlo con quello dell'invio.
    var dati = raccogli();
    if (!dati) { stato('Archivio saltato: codice albero mancante.', 'err'); return; }

    var esito = esitoInvio(dati.tree_id);
    if (!esito.pronto) {
      stato('Archivio saltato: ' + esito.motivo + '.', 'err');
      return;
    }

    var tutte = [];
    try { tutte = raccogliTutte(); } catch (e) { tutte = []; }

    // Già archiviate poco fa e identiche: si saltano, e lo si dichiara.
    var viste = fotoFatte[dati.tree_id] || {};
    var daFare = tutte.filter(function (s) { return !viste[s.impronta]; });
    var saltate = tutte.length - daFare.length;

    stato('\u23f3 Archiviazione in corso\u2026');

    var caricate = [], fallite = [], pesanti = 0, kbTotali = 0;
    var testiFatti = false, gpsFatto = false, primaOk = false;

    // ---- Prima chiamata: testi + GPS + (se c'è) la prima foto ----------
    // I tentativi ripetuti servono solo qui: il 409 significa "albero non
    // ancora arrivato in Supabase", e riguarda la riga, non l'immagine.
    var primo = Object.assign({}, dati);
    var primaFoto = daFare.length ? daFare[0] : null;

    if (primaFoto) {
      try {
        var c0 = await comprimiSottoTetto(primaFoto);
        primo.foto_base64 = c0.base64;
        primo.foto_direzione = c0.direzione;
        primo.__kb = c0.kb;
        if (c0.sopraTetto) pesanti++;
      } catch (e) {
        fallite.push((primaFoto.direzione || 'foto') + ' \u2014 compressione non riuscita');
        primaFoto = null;
      }
    }

    var tentativi = [0, 3000, 8000];
    var r = null;
    for (var i = 0; i < tentativi.length; i++) {
      if (tentativi[i]) await attendi(tentativi[i]);
      try { r = await spedisci(primo); }
      catch (e) { r = { http: 0, dati: null, testo: String(e && e.message || e) }; continue; }
      if (r.http === 401) { scaduta(); return; }
      if (r.http === 409) continue;
      if (r.http >= 500) continue;
      break;
    }

    if (!r || !r.dati) {
      stato('\u26a0 Rilievo inviato correttamente. Archivio NON riuscito' +
        (r && r.testo ? ' (' + r.testo.slice(0, 90) + ')' : '') +
        '. Il rilievo \u00e8 comunque salvato.', 'err');
      return;
    }
    if (r.http === 409) {
      stato('\u26a0 Rilievo inviato. Archivio non riuscito: l\u2019albero non risulta ancora ' +
        'in Supabase dopo tre tentativi. Testi e foto non sono stati salvati.', 'err');
      return;
    }

    primaOk = true;
    var d = r.dati;
    if (d.testi && d.testi.ok && d.testi.colonne && d.testi.colonne.length) testiFatti = true;
    if (d.gps && d.gps.ok && d.gps.valore != null) gpsFatto = true;

    if (primaFoto) {
      if (d.foto && d.foto.ok && d.foto.caricata) {
        caricate.push(primaFoto);
        kbTotali += primo.__kb || 0;
      } else {
        fallite.push((primaFoto.direzione || 'foto') +
          (d.foto && d.foto.errore ? ' \u2014 ' + d.foto.errore : ''));
      }
    }

    // ---- Le altre foto, una alla volta ---------------------------------
    for (var k = 1; k < daFare.length; k++) {
      var s = daFare[k];
      stato('\u23f3 Archiviazione foto ' + (k + 1) + ' di ' + daFare.length + '\u2026');

      var c = null;
      try { c = await comprimiSottoTetto(s); }
      catch (e) {
        fallite.push((s.direzione || 'foto') + ' \u2014 compressione non riuscita');
        continue;
      }
      if (c.sopraTetto) pesanti++;

      var esito = null;
      // Un solo ripensamento: qui il 409 non può più capitare, l'albero c'è
      // già per forza. Si riprova solo per un guaio di rete o di server.
      for (var t = 0; t < 2; t++) {
        if (t) await attendi(2000);
        try {
          esito = await spedisci({
            tree_id: dati.tree_id,
            foto_base64: c.base64,
            foto_direzione: c.direzione
          });
        } catch (e) {
          esito = { http: 0, dati: null, testo: String(e && e.message || e) };
          continue;
        }
        if (esito.http === 401) { scaduta(); return; }
        if (esito.http >= 500) continue;
        break;
      }

      if (esito && esito.dati && esito.dati.foto && esito.dati.foto.ok && esito.dati.foto.caricata) {
        caricate.push(s);
        kbTotali += c.kb;
      } else {
        fallite.push((s.direzione || 'foto') +
          (esito && esito.dati && esito.dati.foto && esito.dati.foto.errore
            ? ' \u2014 ' + esito.dati.foto.errore
            : (esito && esito.testo ? ' \u2014 ' + esito.testo.slice(0, 60) : '')));
      }
    }

    // Le impronte si segnano SOLO per ciò che è davvero arrivato.
    if (!fotoFatte[dati.tree_id]) fotoFatte[dati.tree_id] = {};
    caricate.forEach(function (s) { fotoFatte[dati.tree_id][s.impronta] = true; });

    riassumi({
      totali: tutte.length, saltate: saltate,
      caricate: caricate, fallite: fallite,
      pesanti: pesanti, kb: kbTotali,
      testi: testiFatti, gps: gpsFatto, primaOk: primaOk
    });
  }

  function riassumi(e) {
    var fatti = [];
    if (e.testi) fatti.push('sintesi');
    if (e.gps) fatti.push('accuratezza GPS');
    if (e.caricate.length) {
      fatti.push(e.caricate.length + (e.caricate.length === 1 ? ' foto' : ' foto') +
        ' (' + e.kb + ' KB)');
    }

    var note = [];
    if (!e.totali) note.push('nessuna foto in questo rilievo');
    if (e.saltate) note.push(e.saltate + ' gi\u00e0 archiviate poco fa, identiche');
    // Un'assenza va sempre dichiarata: una spunta verde che tace una foto
    // mancante è peggio di un avviso.
    if (e.pesanti) note.push(e.pesanti + ' sopra il tetto di 250 KB anche alla massima compressione');

    var coda = note.length ? ' (' + note.join('; ') + ')' : '';

    if (!e.fallite.length) {
      stato((fatti.length
        ? '\u2713 Archiviato: ' + fatti.join(', ') + '.'
        : '\u2713 Niente da archiviare per questo rilievo.') + coda,
        note.length && !e.caricate.length && e.totali ? null : 'ok');
    } else {
      stato('\u26a0 Rilievo inviato.' +
        (fatti.length ? ' Archiviato: ' + fatti.join(', ') + '.' : '') +
        ' NON archiviato: ' + e.fallite.join('; ') + '.' + coda, 'err');
    }
  }

  // ── Aggancio ───────────────────────────────────────────────────────────
  function installa() {
    if (typeof window.inviaAlFoglio !== 'function' || window.inviaAlFoglio.__archivio) {
      return setTimeout(installa, 400);
    }
    var _orig = window.inviaAlFoglio;

    window.inviaAlFoglio = function () {
      var out = _orig.apply(this, arguments);

      Promise.resolve(out).then(function () {
        // Mezzo secondo di respiro. La ragione originale (attendere che la
        // riga di esito comparisse a schermo) non vale più: il fatto viene
        // scritto prima che l'invio si concluda. L'attesa resta perché non
        // costa nulla e lascia finire di scrivere la riga del rilievo prima
        // che la nostra le compaia sotto.
        setTimeout(function () {
          archivia().catch(function (e) {
            stato('\u26a0 Rilievo inviato. Archivio non riuscito: ' +
              String(e && e.message || e).slice(0, 90) + '.', 'err');
          });
        }, 500);
      }).catch(function () { /* l'invio ha già segnalato il suo errore */ });

      return out;
    };
    window.inviaAlFoglio.__archivio = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installa);
  } else {
    installa();
  }
  setTimeout(installa, 300);   // rete di sicurezza, come gli altri add-on

  // Esposto per diagnosi da console.
  window.archivioFoto = {
    versione: 'archivio-foto v3.1 (22/09/2026)',
    tettoKB: Math.round(TETTO_BYTE / 1024),
    archiviaOra: archivia,
    url: getUrl
  };
})();
