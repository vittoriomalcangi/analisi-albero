// vra-bersaglio-guard.js
// ─────────────────────────────────────────────────────────────────────────
// Impedisce che un bersaglio compilato ma non spuntato scompaia in silenzio.
//
// IL PROBLEMA
// In `calcBersaglio` la spunta è l'interruttore: `if (chk('vraBPedOn') && W)`.
// Se scrivi 500 passaggi/giorno ma non spunti la voce, quel numero non entra
// nel calcolo, non compare nel dettaglio e non lascia traccia nel report — come
// se non l'avessi mai scritto. Poiché il bersaglio è la classe di esposizione
// PEGGIORE fra le voci attive, una voce dimenticata abbassa il rischio
// calcolato senza che nulla lo segnali.
//
// Secondo silenzio, più insidioso: pedoni e traffico richiedono anche la
// dimensione caratteristica W. Se W manca, quelle voci vengono scartate ANCHE
// SE SPUNTATE, sempre senza avviso.
//
// COSA FA QUESTO FILE
//   • segnala a schermo i numeri inseriti senza spunta;
//   • segnala le voci spuntate che verrebbero scartate per W mancante;
//   • BLOCCA la conclusione della VRA finché la situazione non è risolta
//     (spuntare la voce oppure cancellare il numero).
// Non modifica il calcolo: il comportamento della spunta come dichiarazione
// esplicita resta invariato: cambia solo che non può più essere silenzioso.
//
// Innesto: <script src="vra-bersaglio-guard.js"></script> in fondo ad
// Analisi_Albero.html, DOPO arete-vra-logic.js e dopo vra-sospendi.js.
// Nessun file esistente viene modificato.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // voce → [id spunta, id valore, etichetta, richiedeW]
  var VOCI = [
    ['vraBOccOn', 'vraBOccVal', 'Occupazione stabile di persone', false],
    ['vraBBeniOn', 'vraBBeniVal', 'Beni materiali', false],
    ['vraBPedOn', 'vraBPedVal', 'Passaggio pedoni / ciclisti', true],
    ['vraBTrafOn', 'vraBTrafVal', 'Traffico veicolare', true]
  ];

  var ROSSO = '#a33', AMBRA = '#e2c98a';

  function el(id) { return document.getElementById(id); }
  function chk(id) { var e = el(id); return !!(e && e.checked); }
  function num(id) {
    var e = el(id);
    if (!e) return null;
    var n = parseFloat(e.value);
    return isNaN(n) ? null : n;
  }

  // lastResult vive nello scope globale degli script classici: stesso accesso
  // difensivo usato da arete-vra-logic.js.
  function LR() { try { return lastResult; } catch (e) { return null; } }

  // Replica del calcolo di W in `datiMorfologici`, solo per capire se manca.
  function stimaW() {
    var esplicito = num('vraBW');
    if (esplicito) return esplicito;
    var r = LR() || {};
    var H = parseFloat(r.altezza_totale_m);
    var larg = parseFloat(r.larghezza_chioma_m);
    if (isNaN(larg) && r.raggi) {
      var s = 0, n = 0;
      ['N', 'S', 'E', 'O'].forEach(function (d) {
        var v = parseFloat(r.raggi[d]);
        if (!isNaN(v)) { s += v; n++; }
      });
      if (n) larg = 2 * (s / n);
    }
    if (isNaN(H) && isNaN(larg)) return null;
    if (isNaN(larg)) return H;
    if (isNaN(H)) return null;
    return (H + larg) / 2;
  }

  // ── Analisi dello stato ────────────────────────────────────────────────
  function problemi() {
    var dimenticate = [], scartate = [];
    var W = stimaW();
    VOCI.forEach(function (v) {
      var spunta = v[0], valore = v[1], etichetta = v[2], serveW = v[3];
      var n = num(valore);
      var attiva = chk(spunta);
      if (!attiva && n !== null && n > 0) dimenticate.push({ id: valore, chk: spunta, testo: etichetta, n: n });
      if (attiva && serveW && !W) scartate.push({ id: valore, testo: etichetta });
    });
    return { dimenticate: dimenticate, scartate: scartate, W: W };
  }

  // ── Avviso a schermo ───────────────────────────────────────────────────
  function aggiorna() {
    var panel = el('vraPanel');
    if (!panel || !panel.dataset.built) return;

    var p = problemi();
    evidenzia(p);

    var box = el('vraBersaglioAvviso');
    if (!p.dimenticate.length && !p.scartate.length) {
      if (box) box.parentNode.removeChild(box);
      return;
    }

    if (!box) {
      box = document.createElement('div');
      box.id = 'vraBersaglioAvviso';
      box.style.cssText = 'background:#fff6e0;border:1px solid ' + AMBRA +
        ';border-radius:8px;padding:10px 12px;margin:8px 0;font-size:13px;line-height:1.45';
      panel.insertBefore(box, panel.firstChild);
    }

    var html = '';
    if (p.dimenticate.length) {
      html += '<strong style="color:' + ROSSO + '">\u26a0\ufe0f Bersagli compilati ma non attivi</strong><br>' +
        'Questi numeri <strong>non entrano nel calcolo</strong> e non compariranno nel report:<ul style="margin:6px 0 0 18px;padding:0">';
      p.dimenticate.forEach(function (d) {
        html += '<li>' + d.testo + ' \u2014 valore inserito: <strong>' + d.n + '</strong></li>';
      });
      html += '</ul><div style="margin-top:6px">Metti la spunta alla voce, oppure cancella il numero se non deve contare.</div>';
    }
    if (p.scartate.length) {
      if (html) html += '<hr style="border:0;border-top:1px solid ' + AMBRA + ';margin:8px 0">';
      html += '<strong style="color:' + ROSSO + '">\u26a0\ufe0f Voci attive che verrebbero ignorate</strong><br>' +
        'Manca la dimensione caratteristica dell\u2019albero, necessaria a queste voci:<ul style="margin:6px 0 0 18px;padding:0">';
      p.scartate.forEach(function (s) { html += '<li>' + s.testo + '</li>'; });
      html += '</ul><div style="margin-top:6px">Compila il campo della dimensione caratteristica (W) nella sezione Bersaglio.</div>';
    }
    box.innerHTML = html;
  }

  function evidenzia(p) {
    VOCI.forEach(function (v) {
      var e = el(v[1]);
      if (e) { e.style.outline = ''; e.style.background = ''; }
    });
    p.dimenticate.forEach(function (d) {
      var e = el(d.id);
      if (e) { e.style.outline = '2px solid ' + ROSSO; e.style.background = '#fff2f2'; }
    });
  }

  // ── Blocco della conclusione ───────────────────────────────────────────
  function verificaPrimaDiChiudere() {
    var p = problemi();
    if (!p.dimenticate.length && !p.scartate.length) return true;
    aggiorna();
    var righe = p.dimenticate.map(function (d) { return '\u2022 ' + d.testo + ': ' + d.n; })
      .concat(p.scartate.map(function (s) { return '\u2022 ' + s.testo + ' (manca la dimensione W)'; }));
    alert('Non posso concludere la valutazione.\n\n' +
      'Questi bersagli non entrerebbero nel calcolo del rischio:\n\n' + righe.join('\n') +
      '\n\nSpunta la voce se deve contare, oppure cancella il numero.');
    var panel = el('vraPanel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return false;
  }

  function proteggiInvio() {
    if (typeof window.inviaAlFoglio !== 'function') return setTimeout(proteggiInvio, 400);
    if (window.inviaAlFoglio.__bersGuard) return;
    var _orig = window.inviaAlFoglio;
    window.inviaAlFoglio = function () {
      // Il blocco vale solo se la VRA è in gioco: un rilievo senza valutazione
      // non deve essere ostacolato.
      if (vraInGioco() && !verificaPrimaDiChiudere()) return;
      return _orig.apply(this, arguments);
    };
    window.inviaAlFoglio.__bersGuard = true;
  }

  function proteggiConcludi() {
    var b = el('vraConclBtn');
    if (!b || b.dataset.bersGuard) return setTimeout(proteggiConcludi, 600);
    b.dataset.bersGuard = '1';
    b.onclick = function () {
      if (!verificaPrimaDiChiudere()) return;
      if (window.vraSospendi && typeof window.vraSospendi.concludi === 'function') {
        window.vraSospendi.concludi();
      }
    };
  }

  // La VRA è "in gioco" se almeno un campo del pannello è stato compilato.
  function vraInGioco() {
    var panel = el('vraPanel');
    if (!panel || !panel.dataset.built) return false;
    var qualcosa = false;
    ['vraP_radice', 'vraP_colletto', 'vraP_fusto', 'vraP_rami'].forEach(function (id) {
      var e = el(id);
      if (e && e.value && e.value !== 'nv') qualcosa = true;
    });
    VOCI.forEach(function (v) { if (chk(v[0]) || num(v[1])) qualcosa = true; });
    return qualcosa;
  }

  // ── Aggancio ───────────────────────────────────────────────────────────
  function installa() {
    // Sorveglianza continua: i campi del pannello nascono al primo click e
    // cambiano struttura (blocco branca), quindi si ascolta a livello di
    // documento invece di legarsi ai singoli elementi.
    document.addEventListener('input', function (e) {
      if (e.target && /^vraB/.test(e.target.id || '')) setTimeout(aggiorna, 30);
    }, true);
    document.addEventListener('change', function (e) {
      if (e.target && /^vraB/.test(e.target.id || '')) setTimeout(aggiorna, 30);
    }, true);

    if (typeof window.vraTogglePanel === 'function' && !window.vraTogglePanel.__bersGuard) {
      var _tp = window.vraTogglePanel;
      window.vraTogglePanel = function () {
        var out = _tp.apply(this, arguments);
        setTimeout(aggiorna, 80);
        return out;
      };
      window.vraTogglePanel.__bersGuard = true;
    }

    proteggiInvio();
    proteggiConcludi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installa);
  } else {
    installa();
  }
  setTimeout(installa, 500);

  window.vraBersaglioGuard = { verifica: problemi, aggiorna: aggiorna };
})();
