// accesso.js
// ─────────────────────────────────────────────────────────────────────────
// Login del form. Mette una schermata davanti ad "Analisi Albero" e, una volta
// entrati, mette a disposizione degli altri add-on:
//   window.accesso.gettone()   → il lasciapassare da mandare alle funzioni
//   window.accesso.sigla       → la sigla del parco di lavoro (P1, P2…)
//   window.accesso.parco       → { parco_id, nome, sigla }
//   window.accesso.utente      → { id, email, ruolo }
//
// PERCHÉ ESISTE (decisione 25, 02/08/2026)
// Oggi il form è un indirizzo pubblico: `rilievo` non ha alcuna protezione,
// `archivio` e `vra-bozze` hanno una parola d'ordine unica scritta nel browser
// di chiunque, e il proxy dell'IA su Netlify è aperto — chiunque trovi
// l'indirizzo può consumare il credito. Soprattutto: non risulta da nessuna
// parte CHI ha eseguito un rilievo, e il rilievo è la base di un atto tecnico
// firmato.
//
// PERCHÉ SENZA LA LIBRERIA DI SUPABASE
// La libreria si carica da internet. In un parco, senza campo, non si
// caricherebbe — e con essa non si caricherebbe nemmeno la sessione già
// salvata, lasciando fuori chi era già entrato. Qui si parla direttamente con
// Supabase via chiamate normali: se manca la rete si continua a lavorare con
// la sessione conservata, e la coda delle bozze funziona come sempre.
//
// COSA NON FA
// Non protegge nulla da sola. È comodità e identità lato tablet; la porta vera
// la chiudono le Edge Function, che verificano il gettone (passo 3). Fino ad
// allora questo file si può installare senza rompere niente.
//
// INNESTO
//   <script src="accesso.js"></script>
// in fondo ad Analisi_Albero.html, PRIMA di codice-parco-prefisso.js.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // ── DA RIEMPIRE UNA VOLTA SOLA ─────────────────────────────────────────
  // Pannello Supabase → Project Settings → API:
  //   • Project URL      → SUPA_URL   (es. https://xxxx.supabase.co)
  //   • Project API keys → anon public → SUPA_ANON
  // La chiave `anon` è PUBBLICA per costruzione: sta nel browser di chiunque
  // usi l'app, e scriverla qui non è una fuga di dati. Ciò che protegge i dati
  // è la RLS, non la segretezza di questa stringa.
  var SUPA_URL  = 'https://sldotadtisgekovgvsqr.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsZG90YWR0aXNnZWtvdmd2c3FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNjMzNDIsImV4cCI6MjA5OTczOTM0Mn0.A6B4nX33wH_DRBVVBCXquR-HNkK88qVPV2o5HKZa-xw';

  // Se SUPA_URL è vuoto, si ricava dall'indirizzo già configurato dagli altri
  // add-on: evita di avere due configurazioni che possono divergere.
  function baseUrl() {
    if (SUPA_URL) return SUPA_URL.replace(/\/+$/, '');
    var candidati = ['vraBozzeUrl', 'archivioUrl'];
    for (var i = 0; i < candidati.length; i++) {
      var u = null;
      try { u = localStorage.getItem(candidati[i]); } catch (e) {}
      if (u && u.indexOf('/functions/v1/') > 0) {
        return u.split('/functions/v1/')[0];
      }
    }
    return '';
  }

  var K_SESS  = 'accessoSessione';   // gettone + rinnovo + scadenza
  var K_PARCO = 'accessoParco';      // parco di lavoro, per la sessione corrente

  var stato = { sessione: null, profilo: null, parco: null, parchi: [] };

  // ── Conversazione con Supabase ─────────────────────────────────────────
  function chiama(percorso, opzioni) {
    var o = opzioni || {};
    var testate = { 'apikey': SUPA_ANON, 'Content-Type': 'application/json' };
    if (o.gettone) testate['Authorization'] = 'Bearer ' + o.gettone;
    // fetchNudo: la chiamata originale, non quella ritoccata dagli add-on.
    // Qui non deve entrare nessun prefisso: non stiamo mandando codici albero.
    return (window.__fetchNudo || window.fetch)(baseUrl() + percorso, {
      method: o.metodo || 'GET',
      headers: testate,
      body: o.corpo ? JSON.stringify(o.corpo) : undefined
    });
  }

  function salvaSessione(s) {
    stato.sessione = {
      access_token:  s.access_token,
      refresh_token: s.refresh_token,
      scade_a: Date.now() + ((s.expires_in || 3600) * 1000),
      utente: s.user ? { id: s.user.id, email: s.user.email } : null
    };
    try { localStorage.setItem(K_SESS, JSON.stringify(stato.sessione)); } catch (e) {}
  }

  function leggiSessione() {
    try {
      var s = JSON.parse(localStorage.getItem(K_SESS) || 'null');
      if (s && s.access_token) { stato.sessione = s; return s; }
    } catch (e) {}
    return null;
  }

  function dimentica() {
    stato = { sessione: null, profilo: null, parco: null, parchi: [] };
    try { localStorage.removeItem(K_SESS); } catch (e) {}
    try { sessionStorage.removeItem(K_PARCO); } catch (e) {}
  }

  async function entra(email, password) {
    var r = await chiama('/auth/v1/token?grant_type=password', {
      metodo: 'POST', corpo: { email: email, password: password }
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      var m = (d && (d.error_description || d.msg || d.message)) || '';
      if (r.status === 400) throw new Error('Indirizzo o password non validi.');
      throw new Error('Accesso non riuscito' + (m ? ': ' + m : '.'));
    }
    salvaSessione(d);
  }

  async function rinnova() {
    if (!stato.sessione || !stato.sessione.refresh_token) return false;
    try {
      var r = await chiama('/auth/v1/token?grant_type=refresh_token', {
        metodo: 'POST', corpo: { refresh_token: stato.sessione.refresh_token }
      });
      if (!r.ok) return false;
      salvaSessione(await r.json());
      return true;
    } catch (e) {
      return false;   // senza rete: si tiene quello che c'è
    }
  }

  // Il gettone si chiede AL MOMENTO DELL'INVIO, mai prima: è la regola che
  // tiene in piedi la coda offline delle bozze. Un gettone messo in coda
  // insieme al pacchetto sarebbe scaduto al momento della spedizione.
  async function gettone() {
    if (!stato.sessione) return null;
    var restano = stato.sessione.scade_a - Date.now();
    if (restano < 60000) await rinnova();     // meno di un minuto: si rinnova
    return stato.sessione ? stato.sessione.access_token : null;
  }

  async function caricaProfilo() {
    var g = await gettone();
    var r = await chiama('/rest/v1/profili?select=id,email,ruolo,parco_id', { gettone: g });
    if (!r.ok) throw new Error('Profilo non leggibile (codice ' + r.status + ').');
    var righe = await r.json();
    if (!righe || !righe.length) {
      throw new Error('Nessun profilo associato a questo utente. Segnalalo all\'amministratore.');
    }
    stato.profilo = righe[0];
    return stato.profilo;
  }

  async function caricaParchi() {
    var g = await gettone();
    var r = await chiama('/rest/v1/parchi?select=parco_id,nome,sigla&order=nome.asc', { gettone: g });
    if (!r.ok) throw new Error('Elenco parchi non leggibile (codice ' + r.status + ').');
    stato.parchi = (await r.json()) || [];
    return stato.parchi;
  }

  // ── Aspetto ────────────────────────────────────────────────────────────
  function stile() {
    if (document.getElementById('accesso-stile')) return;
    var s = document.createElement('style');
    s.id = 'accesso-stile';
    s.textContent = [
      '#accesso-velo{position:fixed;inset:0;z-index:99999;background:#0f2419;',
      '  display:flex;align-items:center;justify-content:center;padding:16px;',
      '  font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}',
      '#accesso-scheda{background:#fff;border-radius:14px;padding:26px 22px;',
      '  width:100%;max-width:360px;box-shadow:0 10px 40px rgba(0,0,0,.35);}',
      '#accesso-scheda h2{margin:0 0 4px;font-size:20px;color:#14532d;}',
      '#accesso-scheda p.sott{margin:0 0 18px;font-size:13px;color:#6b7280;}',
      '#accesso-scheda label{display:block;font-size:13px;color:#374151;margin:12px 0 4px;}',
      '#accesso-scheda input,#accesso-scheda select{width:100%;box-sizing:border-box;',
      '  padding:11px 12px;border:1px solid #d1d5db;border-radius:9px;font-size:16px;}',
      '#accesso-scheda button{width:100%;margin-top:18px;padding:13px;border:0;',
      '  border-radius:9px;background:#15803d;color:#fff;font-size:16px;font-weight:600;}',
      '#accesso-scheda button:disabled{background:#9ca3af;}',
      '#accesso-msg{margin-top:14px;font-size:13px;min-height:18px;}',
      '#accesso-msg.ko{color:#b91c1c;} #accesso-msg.ok{color:#15803d;}',
      '#accesso-barra{position:sticky;top:0;z-index:9998;background:#14532d;color:#fff;',
      '  font-family:system-ui,sans-serif;font-size:13px;padding:7px 12px;',
      '  display:flex;gap:10px;align-items:center;flex-wrap:wrap;}',
      '#accesso-barra .parco{background:rgba(255,255,255,.16);padding:3px 9px;',
      '  border-radius:20px;cursor:pointer;}',
      '#accesso-barra .sp{margin-left:auto;}',
      '#accesso-barra button{background:transparent;border:1px solid rgba(255,255,255,.5);',
      '  color:#fff;border-radius:7px;padding:4px 10px;font-size:12px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function velo(html) {
    stile();
    var v = document.getElementById('accesso-velo');
    if (!v) {
      v = document.createElement('div');
      v.id = 'accesso-velo';
      document.body.appendChild(v);
    }
    v.innerHTML = '<div id="accesso-scheda">' + html + '</div>';
    return v;
  }

  function viaVelo() {
    var v = document.getElementById('accesso-velo');
    if (v) v.remove();
  }

  function messaggio(testo, esito) {
    var m = document.getElementById('accesso-msg');
    if (m) { m.textContent = testo || ''; m.className = esito || ''; }
  }

  function schermataLogin(avviso) {
    velo(
      '<h2>Analisi Albero</h2>' +
      '<p class="sott">Accesso riservato ai rilevatori.</p>' +
      '<label for="ac-mail">Indirizzo email</label>' +
      '<input id="ac-mail" type="email" autocomplete="username" autocapitalize="off" spellcheck="false">' +
      '<label for="ac-pwd">Password</label>' +
      '<input id="ac-pwd" type="password" autocomplete="current-password">' +
      '<button id="ac-entra">Entra</button>' +
      '<a href="nuova-password.html" style="display:block;margin-top:14px;font-size:13px;color:#6b7280;text-align:center;">Password dimenticata?</a>' +
      '<div id="accesso-msg" class="ko">' + (avviso || '') + '</div>'
    );
    var bott = document.getElementById('ac-entra');
    var mail = document.getElementById('ac-mail');
    var pwd  = document.getElementById('ac-pwd');

    async function prova() {
      var e = (mail.value || '').trim(), p = pwd.value || '';
      if (!e || !p) { messaggio('Indirizzo e password sono obbligatori.', 'ko'); return; }
      bott.disabled = true; messaggio('Verifica in corso…', '');
      try {
        await entra(e, p);
        await dopoIngresso();
      } catch (err) {
        messaggio(err.message || 'Accesso non riuscito.', 'ko');
        bott.disabled = false;
      }
    }
    bott.addEventListener('click', prova);
    pwd.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') prova(); });
    setTimeout(function () { mail.focus(); }, 60);
  }

  function schermataParco(elenco, cambio) {
    var opzioni = elenco.map(function (p) {
      return '<option value="' + p.parco_id + '">' + p.nome + ' (' + p.sigla + ')</option>';
    }).join('');
    velo(
      '<h2>Parco di lavoro</h2>' +
      '<p class="sott">I codici albero di questa sessione nasceranno con la sigla del parco scelto.</p>' +
      '<label for="ac-parco">Parco</label>' +
      '<select id="ac-parco">' + opzioni + '</select>' +
      '<button id="ac-ok">Conferma</button>' +
      '<div id="accesso-msg"></div>'
    );
    document.getElementById('ac-ok').addEventListener('click', function () {
      var id = document.getElementById('ac-parco').value;
      var scelto = elenco.filter(function (p) { return p.parco_id === id; })[0];
      if (!scelto) return;
      fissaParco(scelto);
      viaVelo();
      if (!cambio) pronti();
      else barra();
    });
  }

  function fissaParco(p) {
    stato.parco = p;
    try { sessionStorage.setItem(K_PARCO, JSON.stringify(p)); } catch (e) {}
  }

  function barra() {
    stile();
    var b = document.getElementById('accesso-barra');
    if (!b) {
      b = document.createElement('div');
      b.id = 'accesso-barra';
      document.body.insertBefore(b, document.body.firstChild);
    }
    var chi = (stato.profilo && stato.profilo.email) || '—';
    var ruolo = (stato.profilo && stato.profilo.ruolo) || '';
    var p = stato.parco;
    // Il parco di lavoro sta SEMPRE sotto gli occhi. Un'impostazione che non si
    // vede è il tablet lasciato sul parco sbagliato: qui non può succedere in
    // silenzio, perché la sigla è scritta in cima a ogni schermata.
    b.innerHTML =
      '<span>' + chi + (ruolo ? ' · ' + ruolo : '') + '</span>' +
      (p ? '<span class="parco" id="ac-cambia" title="' +
           (ruolo === 'admin' ? 'Tocca per cambiare parco' : 'Parco assegnato') + '">' +
           p.nome + ' · ' + p.sigla + '</span>' : '') +
      '<span class="sp"></span><button id="ac-esci">Esci</button>';

    document.getElementById('ac-esci').addEventListener('click', function () {
      if (!confirm('Uscire? Le bozze già inviate restano sul server.')) return;
      dimentica();
      location.reload();
    });
    var c = document.getElementById('ac-cambia');
    if (c && ruolo === 'admin') {
      c.addEventListener('click', function () { schermataParco(stato.parchi, true); });
    }
  }

  // ── Il percorso dopo l'ingresso ────────────────────────────────────────
  async function dopoIngresso() {
    velo('<h2>Un momento…</h2><p class="sott">Lettura del profilo.</p><div id="accesso-msg"></div>');

    var prof = await caricaProfilo();

    // Il form non è per tutti: chi ha le credenziali per guardare l'app non
    // deve poter inviare rilievi. Questo è comunque solo il primo filtro —
    // quello che conta lo faranno le Edge Function.
    if (prof.ruolo !== 'tecnico' && prof.ruolo !== 'admin') {
      dimentica();
      schermataLogin('Questo accesso può consultare l\'app ma non eseguire rilievi.');
      return;
    }

    var parchi = await caricaParchi();
    if (!parchi.length) {
      dimentica();
      schermataLogin('Nessun parco associato a questo accesso.');
      return;
    }

    var senzaSigla = parchi.filter(function (p) { return !p.sigla; });
    if (senzaSigla.length) {
      dimentica();
      schermataLogin('Il parco "' + senzaSigla[0].nome + '" non ha una sigla: va assegnata prima di rilevare.');
      return;
    }

    // Parco già scelto in questa sessione: si riprende, ma resta visibile.
    var salvato = null;
    try { salvato = JSON.parse(sessionStorage.getItem(K_PARCO) || 'null'); } catch (e) {}
    if (salvato) {
      var ancora = parchi.filter(function (p) { return p.parco_id === salvato.parco_id; })[0];
      if (ancora) { fissaParco(ancora); viaVelo(); pronti(); return; }
    }

    if (parchi.length === 1) {           // un parco solo: nessuna domanda inutile
      fissaParco(parchi[0]);
      viaVelo();
      pronti();
      return;
    }
    schermataParco(parchi, false);       // più parchi: si sceglie, ogni sessione
  }

  function pronti() {
    barra();
    try {
      document.dispatchEvent(new CustomEvent('accesso-pronto', {
        detail: { sigla: stato.parco.sigla, parco_id: stato.parco.parco_id }
      }));
    } catch (e) {}
    try {
      console.log('[accesso] ' + stato.profilo.email + ' · ' + stato.profilo.ruolo +
                  ' · parco di lavoro ' + stato.parco.sigla);
    } catch (e) {}
  }

  // ── Avvio ──────────────────────────────────────────────────────────────
  async function avvia() {
    if (!baseUrl() || !SUPA_ANON) {
      velo('<h2>Configurazione incompleta</h2><p class="sott">In cima ad ' +
           'accesso.js vanno inseriti l\'indirizzo del progetto e la chiave ' +
           'pubblica (Project Settings → API).</p>');
      return;
    }
    if (leggiSessione()) {
      try { await dopoIngresso(); return; }
      catch (e) {
        // Senza rete non si può leggere il profilo: si resta fuori, ma lo si
        // dice chiaramente invece di mostrare un form che poi non spedisce.
        dimentica();
        schermataLogin('Sessione non verificabile: ' + (e.message || 'rete assente') + '');
        return;
      }
    }
    schermataLogin('');
  }

  // ── Ciò che gli altri add-on possono usare ─────────────────────────────
  window.accesso = {
    gettone: gettone,
    get sigla()  { return stato.parco ? stato.parco.sigla : null; },
    get parco()  { return stato.parco; },
    get utente() {
      return stato.profilo
        ? { id: stato.profilo.id, email: stato.profilo.email, ruolo: stato.profilo.ruolo }
        : null;
    },
    entrato: function () { return !!(stato.sessione && stato.parco); },
    esci: function () { dimentica(); location.reload(); }
  };

  // La chiamata originale, messa da parte prima che gli add-on la ritocchino.
  if (!window.__fetchNudo) window.__fetchNudo = window.fetch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
})();
