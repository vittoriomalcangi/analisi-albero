// dual-write-supabase.js
// ─────────────────────────────────────────────────────────────────────────
// Doppia scrittura del rilievo: invia lo STESSO payload sia al foglio Google
// (Apps Script) sia alla Edge Function `rilievo` di Supabase, in parallelo.
// Fase transitoria di migrazione: il foglio resta rete di sicurezza mentre si
// valida Supabase sugli stessi dati reali.
//
// Innesto (stile arete-vra-logic): un solo <script> in fondo ad
// Analisi_Albero.html, DOPO tutti gli altri (in particolare dopo
// arete-vra-logic.js, così i campi vra_* sono già fusi in buildRilievoPayload):
//
//   <script src="dual-write-supabase.js"></script>
//
// Non tocca nessun file esistente: ridefinisce window.inviaAlFoglio riusando le
// funzioni globali già presenti (buildRilievoPayload, getWebAppUrl).
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // URL della Edge Function `rilievo`. Modificabile qui o via localStorage
  // (chiave 'supabaseRilievoUrl'), senza ridistribuire il file.
  var SUPABASE_RILIEVO_URL_DEFAULT =
    'https://sldotadtisgekovgvsqr.supabase.co/functions/v1/rilievo';

  function getSupabaseUrl() {
    try {
      var u = localStorage.getItem('supabaseRilievoUrl');
      if (u && /^https?:\/\//.test(u)) return u.trim();
    } catch (e) {}
    return SUPABASE_RILIEVO_URL_DEFAULT;
  }

  // POST del payload a una destinazione. Ritorna {ok, msg} senza mai lanciare,
  // così un errore su un backend non blocca l'altro.
  async function inviaA(url, payload) {
    try {
      var resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: niente preflight
        body: JSON.stringify(payload)
      });
      var txt = await resp.text();
      if (/^ERR/i.test(txt)) return { ok: false, msg: txt.slice(0, 140) };
      if (!resp.ok) return { ok: false, msg: 'HTTP ' + resp.status };
      return { ok: true, msg: '' };
    } catch (e) {
      return { ok: false, msg: (e && e.message) ? e.message : String(e) };
    }
  }

  function installa() {
    // Se l'inline script non ha ancora definito le dipendenze, riprova a breve.
    if (typeof window.buildRilievoPayload !== 'function') {
      return setTimeout(installa, 300);
    }
    if (window.inviaAlFoglio && window.inviaAlFoglio.__dual) return;

    window.inviaAlFoglio = async function () {
      var status = document.getElementById('sendStatus');
      function set(cls, msg) { status.className = 'send-status ' + cls; status.textContent = msg; }

      // ── Il fatto dell'invio (22/09/2026) ───────────────────────────────
      // Azzerato PRIMA di qualunque cosa, comprese le validazioni che escono
      // subito: finché non viene riscritto vale «non lo so», mai «sì». Senza
      // questa riga, un fatto vecchio resterebbe in pagina e l'archiviazione
      // si fiderebbe di un invio di mezz'ora prima, magari di un altro albero.
      window.__esitoInvio = null;

      // ── stessa validazione dell'originale ──────────────────────────────
      var tipoFusto = document.getElementById('tipoFusto').value;
      var saluteEsito = document.getElementById('saluteEsito').value;
      var nord = document.getElementById('sensoreNord').checked;
      document.getElementById('nordRow').classList.toggle('required-missing', !nord);
      var manca = [];
      if (!tipoFusto) manca.push('tipo di tronco');
      if (!saluteEsito) manca.push('esito valutazione agronomo');
      if (!nord) manca.push('conferma orientamento Nord');
      if (manca.length) { set('err', '⚠️ Completa prima di inviare: ' + manca.join(', ') + '.'); return; }

      var payload = window.buildRilievoPayload();

      // ── destinazioni ───────────────────────────────────────────────────
      var sheetUrl = (typeof window.getWebAppUrl === 'function') ? window.getWebAppUrl() : '';
      var supaUrl = getSupabaseUrl();
      var targets = [];
      if (sheetUrl) targets.push({ nome: 'foglio', url: sheetUrl });
      if (supaUrl) targets.push({ nome: 'Supabase', url: supaUrl });

      if (!targets.length) {
        set('err', '⚠️ Nessuna destinazione configurata (né foglio né Supabase). I dati restano nel report — usa “Copia tutto”.');
        return;
      }

      set('loading', '⏳ Invio a ' + targets.map(function (t) { return t.nome; }).join(' + ') + '…');

      var esiti = await Promise.all(targets.map(function (t) {
        return inviaA(t.url, payload).then(function (r) { return { nome: t.nome, ok: r.ok, msg: r.msg }; });
      }));

      var ok = esiti.filter(function (e) { return e.ok; });
      var ko = esiti.filter(function (e) { return !e.ok; });

      // ── Si dichiara il fatto, per destinazione ─────────────────────────
      // Prima di tradurre gli esiti in una frase colorata, li si scrive come
      // fatti. La frase serve all'occhio; questo serve agli altri add-on.
      // `archivio-foto.js` legge di qui, e non dal colore della scritta: il
      // colore è verde solo se sono andate bene TUTTE le destinazioni, quindi
      // un foglio Google giù faceva saltare l'archiviazione delle foto anche
      // quando Supabase aveva ricevuto tutto.
      var eSupa = esiti.filter(function (e) { return e.nome === 'Supabase'; })[0];
      var eFoglio = esiti.filter(function (e) { return e.nome === 'foglio'; })[0];
      var campoCodice = document.getElementById('treeCode');
      window.__esitoInvio = {
        quando: Date.now(),
        tree_id: campoCodice ? campoCodice.value.trim() : '',
        supabase: !!(eSupa && eSupa.ok),
        foglio: !!(eFoglio && eFoglio.ok)
      };

      if (!ko.length) {
        set('ok', '✓ Inviato a: ' + ok.map(function (e) { return e.nome; }).join(', ') + '.');
      } else if (ok.length) {
        set('err', '⚠️ Inviato a ' + ok.map(function (e) { return e.nome; }).join(', ') +
          ', ma FALLITO su ' + ko.map(function (e) { return e.nome + ' (' + e.msg + ')'; }).join('; ') +
          '. I dati sono nel report — usa “Copia tutto”.');
      } else {
        set('err', '❌ Invio non riuscito su tutte le destinazioni: ' +
          ko.map(function (e) { return e.nome + ' (' + e.msg + ')'; }).join('; ') +
          '. I dati restano nel report — usa “Copia tutto”.');
      }
    };
    window.inviaAlFoglio.__dual = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installa);
  } else {
    installa();
  }
  setTimeout(installa, 300); // rete di sicurezza, come per il modulo VRA
})();
