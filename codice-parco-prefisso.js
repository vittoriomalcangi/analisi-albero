// codice-parco-prefisso.js  —  versione 2 (03/08/2026)
// ─────────────────────────────────────────────────────────────────────────
// Sostituisce la versione 1. Due compiti, nello stesso punto di passaggio:
//
//   1) antepone la SIGLA DEL PARCO DI LAVORO al codice albero in uscita
//      (l'operatore digita «Q12», a Supabase arriva «P1-Q12»);
//   2) allega il GETTONE di chi ha fatto il login alle chiamate verso
//      Supabase e verso il proxy dell'IA.
//
// COSA CAMBIA RISPETTO ALLA VERSIONE 1
// La sigla non è più la costante 'P1' scritta qui dentro: viene dal parco di
// lavoro scelto in `accesso.js`, cioè dal profilo di chi è entrato. È il
// motivo per cui il login esiste — un valore fisso nel codice sorgente è la
// stessa cosa di un'impostazione sul tablet, e il giorno del secondo parco
// produrrebbe alberi legittimi nel parco sbagliato.
//
// PERCHÉ IL GETTONE VIENE ATTACCATO QUI
// Il codice albero e il gettone servono agli stessi chiamanti: `dual-write`
// (rilievo), `archivio-foto` (foto), `vra-sospendi` (bozze),
// `codice-albero-guard` (guardia), più il proxy dell'IA. Intercettando la
// chiamata di rete si servono tutti **senza toccare nessuno di quei file**.
// Una regola sola, in un posto solo.
//
// PERCHÉ IL GETTONE SI CHIEDE ADESSO E NON PRIMA
// `accesso.gettone()` lo rinnova se sta per scadere. Chiedendolo al momento
// esatto della spedizione, la coda offline delle bozze continua a funzionare:
// in coda finisce il pacchetto, mai il lasciapassare — che altrimenti
// partirebbe scaduto ore dopo.
//
// COSA NON TOCCA
//   • Il campo a schermo: chi rileva digita e rilegge «Q12».
//   • `nome_comune`: `rilievo` lo scrive già senza prefisso.
//   • Il foglio Google: indirizzo diverso, non corrisponde, resta intatto.
//   • Nessun file esistente.
//
// INNESTO
//   <script src="accesso.js"></script>
//   <script src="codice-parco-prefisso.js"></script>
// in quest'ordine, in fondo ad Analisi_Albero.html.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // Destinazioni da servire: le Edge Function di Supabase e il proxy dell'IA
  // su Netlify. Il foglio Google (script.google.com) non compare qui.
  var SUPABASE = /\.supabase\.co\/functions\/v1\//i;
  var PROXY_AI = /\/\.netlify\/functions\/ai\b/i;

  var registro = [];

  // ── La sigla ───────────────────────────────────────────────────────────
  // Unica fonte: il parco di lavoro scelto al login.
  //
  // Se `accesso.js` non è installato del tutto, si ripiega su 'P1' per non
  // lasciare il form inservibile — ma lo si dichiara ad alta voce. Se invece
  // il login c'è e la sigla manca (nessun parco scelto), NON si inventa
  // niente: si lascia il codice nudo e il server lo rifiuta con un messaggio
  // chiaro. Meglio un invio respinto che un albero nel parco sbagliato.
  function siglaCorrente() {
    if (typeof window.accesso === 'undefined') {
      if (!siglaCorrente.avvisato) {
        siglaCorrente.avvisato = true;
        try { console.warn('[prefisso] accesso.js assente: ripiego sulla sigla P1.'); } catch (e) {}
      }
      return 'P1';
    }
    return window.accesso.sigla || null;
  }

  function completa(codice) {
    if (typeof codice !== 'string') return codice;
    var c = codice.trim();
    if (!c) return codice;
    var s = siglaCorrente();
    if (!s) {
      try { console.error('[prefisso] nessun parco di lavoro: codice non prefissato.'); } catch (e) {}
      return c;
    }
    if (c.indexOf(s + '-') === 0) return c;   // già prefissato: si lascia
    return s + '-' + c;
  }

  function annota(dove, prima, dopo) {
    if (prima === dopo) return;
    registro.push({ quando: new Date().toISOString(), dove: dove, da: prima, a: dopo });
    if (registro.length > 50) registro.shift();
    try { console.log('[prefisso] ' + prima + ' → ' + dopo + '  (' + dove + ')'); } catch (e) {}
  }

  function etichetta(url) {
    if (PROXY_AI.test(String(url))) return 'ai';
    var m = String(url).match(/\/functions\/v1\/([^/?]+)/);
    return m ? m[1] : 'supabase';
  }

  // ── 1) Il codice nell'indirizzo (?tree_id=...) ─────────────────────────
  function correggiUrl(url) {
    var s = String(url);
    if (s.indexOf('tree_id=') < 0) return s;
    return s.replace(/([?&]tree_id=)([^&]*)/g, function (tutto, testa, valore) {
      var prima = decodeURIComponent(valore);
      var dopo = completa(prima);
      annota(etichetta(s) + ' (indirizzo)', prima, dopo);
      return testa + encodeURIComponent(dopo);
    });
  }

  // ── 2) Il codice nel pacchetto ─────────────────────────────────────────
  // Solo la chiave `tree_id`, solo al primo livello. Se il corpo non è un
  // JSON leggibile (per esempio un caricamento di file), si lascia stare: non
  // si manomette ciò che non si è capito.
  function correggiCorpo(body, url) {
    if (typeof body !== 'string' || !body) return body;
    var dati;
    try { dati = JSON.parse(body); } catch (e) { return body; }
    if (!dati || typeof dati !== 'object' || Array.isArray(dati)) return body;
    if (typeof dati.tree_id !== 'string') return body;

    var prima = dati.tree_id;
    var dopo = completa(prima);
    if (prima === dopo) return body;

    dati.tree_id = dopo;
    annota(etichetta(url) + ' (pacchetto)', prima, dopo);
    return JSON.stringify(dati);
  }

  // ── L'installazione ────────────────────────────────────────────────────
  var fetchOriginale = window.__fetchNudo || window.fetch;
  if (!fetchOriginale || (window.fetch && window.fetch.__prefisso)) return;
  if (!window.__fetchNudo) window.__fetchNudo = fetchOriginale;

  window.fetch = async function (risorsa, opzioni) {
    try {
      if (typeof risorsa !== 'string') {
        return fetchOriginale.apply(this, arguments);
      }

      var perSupabase = SUPABASE.test(risorsa);
      var perIA = PROXY_AI.test(risorsa);
      if (!perSupabase && !perIA) {
        return fetchOriginale.apply(this, arguments);   // foglio Google e tutto il resto
      }

      var url = risorsa;
      var opt = opzioni ? Object.assign({}, opzioni) : {};

      // Il codice albero riguarda solo Supabase: al proxy dell'IA si mandano
      // fotografie, non codici.
      if (perSupabase) {
        url = correggiUrl(risorsa);
        if (typeof opt.body === 'string') {
          opt.body = correggiCorpo(opt.body, risorsa);
        }
      }

      // Il gettone, chiesto adesso — non prima, non in coda.
      if (window.accesso && typeof window.accesso.gettone === 'function') {
        var g = await window.accesso.gettone();
        if (g) {
          opt.headers = Object.assign({}, opt.headers || {}, {
            'Authorization': 'Bearer ' + g
          });
        }
      }

      return fetchOriginale.call(this, url, opt);

    } catch (e) {
      // Un errore qui non deve impedire l'invio: si spedisce com'era. Un codice
      // senza prefisso verrà rifiutato da `rilievo` con un messaggio leggibile,
      // che è molto meglio di un invio perso in silenzio.
      try { console.error('[prefisso] non applicato:', e); } catch (_e) {}
      return fetchOriginale.apply(this, arguments);
    }
  };
  window.fetch.__prefisso = true;

  // ── Diagnosi da console ────────────────────────────────────────────────
  window.prefissoParco = {
    get sigla() { return siglaCorrente(); },
    stato: function () {
      return {
        sigla: siglaCorrente(),
        parco: (window.accesso && window.accesso.parco) || null,
        ritocchi: registro.length,
        ultimi: registro.slice(-10)
      };
    },
    prova: function (codice) { return completa(codice); }
  };

  document.addEventListener('accesso-pronto', function (ev) {
    try { console.log('[prefisso] sigla in uso: ' + (ev.detail && ev.detail.sigla)); } catch (e) {}
  });

  try { console.log('[prefisso] attivo — sigla dal parco di lavoro, gettone allegato.'); } catch (e) {}
})();
