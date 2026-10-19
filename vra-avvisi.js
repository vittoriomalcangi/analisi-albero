// vra-avvisi.js                                                  (19/10/2026)
// ─────────────────────────────────────────────────────────────────────────
// Due difetti del modulo VRA, corretti senza toccare nessun file esistente.
//
// 1) UNA VRA SOSPESA SPARIVA DAL REPORT IN SILENZIO
//    Con «Branca / ramo» l'impulso richiede tre dati (Ø all'inserzione,
//    lunghezza, altezza d'inserzione) e un'altezza sopra la soglia Hb. Se
//    mancano, la VRA risulta «sospesa»: lo schermo lo diceva, ma CSV, Word,
//    «Copia tutto» e l'invio al database la OMETTEVANO senza una parola. Chi
//    scarica il report non ha modo di accorgersi che la VRA non c'è.
//    Qui: avviso a schermo col MOTIVO (e col dato che manca), riga esplicita
//    nel report («VRA NON INCLUSA»), e una conferma prima di scaricare il
//    report o di inviare.
//
// 2) «CONCLUDI VRA» ERA SEMPRE PREMIBILE
//    Il pulsante serve solo a chiudere una bozza RIPRESA, ma il modulo lo
//    mette in ogni valutazione. Premuto in una VRA normale rispondeva
//    «Nessuna VRA ripresa in corso», incomprensibile per chi non aveva ripreso
//    niente. Qui: nascosto finché non c'è una ripresa (c'è il riquadro «Stai
//    completando la VRA di…»); se viene premuto lo stesso, spiega cosa fare.
//
// COSA NON FA
//   • non cambia nessun calcolo e nessun risultato della VRA;
//   • non cambia il contenuto dell'invio al database (`payload`): una VRA
//     sospesa continua a non essere inviata, ma adesso lo si SA prima;
//   • non dice niente se la VRA non è stata avviata (pannello mai aperto, nessun
//     dato inserito): un rilievo senza VRA resta un rilievo senza VRA;
//   • non blocca mai il lavoro per un suo difetto: ogni punto è in try/catch e,
//     se qualcosa non va, la pagina si comporta come prima.
//
// Innesto: <script src="vra-avvisi.js"></script> in Analisi_Albero.html, DOPO
// vra-bersaglio-guard.js e PRIMA di archivio-foto.js (che va caricato per
// ultimo). Per spegnerlo basta togliere quella riga.
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var VERSIONE = 'vra-avvisi v1 (19/10/2026)';

  var PERICOLI = ['radice', 'colletto', 'fusto', 'rami'];
  var BERSAGLI = ['vraBOccOn', 'vraBBeniOn', 'vraBPedOn', 'vraBTrafOn'];
  var ROSSO = '#a33';

  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? String(e.value == null ? '' : e.value).trim() : ''; }
  function num(id) {
    var s = val(id).replace(',', '.');
    if (s === '') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function chk(id) { var e = el(id); return !!(e && e.checked); }
  // lastResult / lastDbh vivono nello scope globale degli script classici:
  // stesso accesso difensivo usato da arete-vra-logic.js.
  function LR() { try { return lastResult; } catch (e) { return null; } }
  function LDBH() { try { return lastDbh; } catch (e) { return null; } }
  function fmt(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }

  // ── La VRA è stata AVVIATA? ────────────────────────────────────────────
  // Solo se il pannello è stato aperto E qualcuno ci ha scritto qualcosa.
  // Altrimenti nessun avviso: nessuno si aspetta una VRA da un rilievo che non
  // l'ha cominciata.
  function avviata() {
    if (!el('vraImpTipo')) return false;
    var i;
    for (i = 0; i < PERICOLI.length; i++) {
      var v = val('vraP_' + PERICOLI[i]);
      if (v !== '' && v !== 'nv') return true;
    }
    for (i = 0; i < BERSAGLI.length; i++) if (chk(BERSAGLI[i])) return true;
    if (val('vraImpTipo') === 'branca' && (val('vraImpDram') || val('vraImpLram') || val('vraImpHins'))) return true;
    return false;
  }

  // ── Perché è sospesa: il dato che manca, nominato ──────────────────────
  function leggiHb() {
    var n = el('vraInote');
    var m = n ? /Hb\s*=\s*([0-9]+(?:[.,][0-9]+)?)/.exec(n.textContent || '') : null;
    return m ? parseFloat(m[1].replace(',', '.')) : 2;
  }

  function motivoImpulso() {
    var tipo = val('vraImpTipo') || 'albero';
    var Hb = leggiHb();
    var r = LR() || {};
    if (tipo === 'branca') {
      var mancano = [];
      if (num('vraImpDram') == null) mancano.push('il diametro della branca all’inserzione');
      if (num('vraImpLram') == null) mancano.push('la lunghezza della branca');
      var hi = num('vraImpHins');
      if (hi == null && r.altezza_inserzione_chioma_m != null && !isNaN(parseFloat(r.altezza_inserzione_chioma_m))) {
        hi = parseFloat(r.altezza_inserzione_chioma_m);   // lo stesso ripiego che usa il calcolo
      }
      if (hi == null) mancano.push('l’altezza d’inserzione della branca');
      if (mancano.length) return 'impulso della branca non calcolabile: manca ' + mancano.join(', ') + '.';
      if (hi <= Hb) {
        return 'impulso della branca non calcolabile: l’altezza d’inserzione (' + fmt(hi) + ' m) deve superare ' +
          fmt(Hb) + ' m; sotto questa soglia il modello non calcola un impulso.';
      }
      return 'impulso della branca non calcolabile: dati insufficienti.';
    }
    var D = num('vraImpDbh'); if (D == null) D = LDBH();
    var H = num('vraImpH'); if (H == null && r.altezza_totale_m != null) H = parseFloat(r.altezza_totale_m);
    var m2 = [];
    if (D == null || isNaN(D)) m2.push('il DBH');
    if (H == null || isNaN(H)) m2.push('l’altezza dell’albero');
    if (m2.length) return 'impulso dell’albero non calcolabile: manca ' + m2.join(' e ') + '.';
    if (H <= Hb) return 'impulso dell’albero non calcolabile: l’altezza (' + fmt(H) + ' m) deve superare ' + fmt(Hb) + ' m.';
    return 'impulso non calcolabile: dati insufficienti.';
  }

  function motivo() {
    var d = window.vraData, o = d && d.out, R = o && o.R;
    var base = R && R.motivo ? String(R.motivo) : 'dati insufficienti';
    if (/Impulso non calcolabile/i.test(base)) {
      try { return motivoImpulso(); } catch (e) { /* si tiene il motivo originale */ }
    }
    return base;
  }

  function stato() {
    var d = window.vraData;
    var completa = !!(d && d.completa);
    var av = avviata();
    var sospesa = av && !completa;
    return { avviata: av, completa: completa, sospesa: sospesa, motivo: sospesa ? motivo() : '' };
  }

  // ── Avviso a schermo ───────────────────────────────────────────────────
  function aggiornaAvviso(st) {
    var host = el('vraBlock');
    if (!host) return;
    var b = el('vraAvvisoSospesa');
    if (!st.sospesa) { if (b && b.parentNode) b.parentNode.removeChild(b); return; }
    var testo = '⚠️ La VRA è SOSPESA e NON entrerà nel report né nell’invio. Motivo: ' + st.motivo +
      ' Completa i dati, oppure usa “Sospendi VRA” per riprenderla dopo.';
    if (!b) {
      b = document.createElement('div');
      b.id = 'vraAvvisoSospesa';
      b.setAttribute('role', 'alert');
      b.style.cssText = 'background:#fdeceb;border:1px solid ' + ROSSO + ';color:#7a1f1f;border-radius:8px;' +
        'padding:8px 10px;margin:0 0 8px;font-size:13px;line-height:1.4';
      var panel = el('vraPanel');
      host.insertBefore(b, panel && panel.parentNode === host ? panel : host.firstChild);
    }
    if (b.textContent !== testo) b.textContent = testo;
  }

  // ── «Concludi VRA»: solo quando c'è una ripresa ────────────────────────
  // Il riquadro «Stai completando la VRA di…» esiste solo durante una ripresa.
  function ripresaInCorso() { return !!el('vraBanner'); }
  function aggiornaConcludi() {
    var btn = el('vraConclBtn');
    if (!btn) return;
    var voluto = ripresaInCorso() ? '' : 'none';
    if (btn.style.display !== voluto) btn.style.display = voluto;
  }

  function messaggioConcludi() {
    var box = el('vraSospStatus');
    var testo = 'Questa VRA non è una ripresa: si salva con “Invia al foglio”. Se è incompleta, usa “Sospendi VRA”.';
    if (box) { box.textContent = testo; box.style.color = ROSSO; } else { try { window.alert(testo); } catch (e) {} }
  }

  // ── Conferma prima di scaricare il report o di inviare ─────────────────
  // In fase di CATTURA sul documento: arriva prima dei gestori dei pulsanti,
  // quindi non occorre sostituire niente di ciò che altri file hanno agganciato.
  function ciclo() {
    try { var st = stato(); aggiornaAvviso(st); aggiornaConcludi(); } catch (e) { /* mai bloccare la pagina */ }
  }

  document.addEventListener('click', function (e) {
    try {
      var t = e.target && e.target.closest ? e.target.closest('#vraConclBtn, #btnCsv, #btnDocx, #btnInvia') : null;
      if (!t) return;

      if (t.id === 'vraConclBtn') {
        if (ripresaInCorso()) return;                 // ripresa vera: ci pensa il modulo
        e.preventDefault(); e.stopImmediatePropagation();
        messaggioConcludi();
        return;
      }
      // Durante una ripresa l'invio normale è già bloccato dal modulo VRA.
      if (t.id === 'btnInvia' && ripresaInCorso()) return;

      try { if (typeof window.vraCalcola === 'function') window.vraCalcola(); } catch (er) { /* pannello non pronto */ }
      var st = stato();
      aggiornaAvviso(st);
      if (!st.sospesa) return;

      var dove = t.id === 'btnInvia' ? 'nell’invio al foglio' : 'nel report';
      var ok = window.confirm('La VRA è SOSPESA e NON sarà inclusa ' + dove + '.\n\nMotivo: ' + st.motivo +
        '\n\nPremi OK per procedere lo stesso, oppure Annulla per tornare alla VRA.');
      if (!ok) {
        e.preventDefault(); e.stopImmediatePropagation();
        var b = el('vraAvvisoSospesa');
        if (b && b.scrollIntoView) { try { b.scrollIntoView({ block: 'center' }); } catch (er2) {} }
      }
    } catch (err) { /* se questo file ha un difetto, la pagina fa come prima */ }
  }, true);

  // ── La dichiarazione dentro i documenti ────────────────────────────────
  function installa() {
    if (!window.vraExtra) return setTimeout(installa, 400);
    if (window.vraExtra.__vraAvvisi) return;
    window.vraExtra.__vraAvvisi = true;

    var _csv = window.vraExtra.csvRows;
    window.vraExtra.csvRows = function () {
      var r = [];
      try { r = _csv.apply(this, arguments) || []; } catch (e) {}
      try {
        var s = stato();
        if (s.sospesa) {
          r.push(['vra_compilata', 'no (sospesa)']);
          r.push(['vra_non_inclusa_motivo', s.motivo]);
        }
      } catch (e) {}
      return r;
    };

    var _lin = window.vraExtra.reportLines;
    window.vraExtra.reportLines = function () {
      var L = [];
      try { L = _lin.apply(this, arguments) || []; } catch (e) {}
      try {
        var s = stato();
        if (s.sospesa) {
          var sep = '─'.repeat(40);
          L = L.concat(['', 'VRA NON INCLUSA', sep,
            'La valutazione del rischio (VRA) è stata avviata ma è SOSPESA:',
            'non compare in questo documento.',
            'Motivo: ' + s.motivo]);
        }
      } catch (e) {}
      return L;
    };

    var _dcx = window.vraExtra.docxChildren;
    window.vraExtra.docxChildren = function (docx) {
      var ch = [];
      try { ch = _dcx.apply(this, arguments) || []; } catch (e) {}
      try {
        var s = stato();
        if (s.sospesa && docx) {
          var P = docx.Paragraph, T = docx.TextRun, H = docx.HeadingLevel;
          ch = ch.concat([
            new P({ heading: H.HEADING_2, spacing: { before: 300, after: 100 },
              children: [new T({ text: 'VRA non inclusa', bold: true, color: '8A1F1F' })] }),
            new P({ children: [new T({ text: 'La valutazione del rischio arboreo (VRA) è stata avviata ma è SOSPESA: non compare in questo documento.', size: 20 })] }),
            new P({ children: [new T({ text: 'Motivo: ' + s.motivo, size: 20 })] })
          ]);
        }
      } catch (e) {}
      return ch;
    };
  }

  // ── Tenere aggiornati avviso e pulsante ────────────────────────────────
  // I risultati della VRA si ridisegnano a ogni modifica dei campi: quel
  // ridisegno è il segnale. Il controllo è leggero e non scrive se non cambia.
  var osservatoreAvviato = false;
  function avviaOsservatore() {
    if (!osservatoreAvviato && document.body) {
      osservatoreAvviato = true;
      var t = null;
      var richiama = function () { clearTimeout(t); t = setTimeout(ciclo, 60); };
      try { new MutationObserver(richiama).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    }
    ['vraLive', 'vraCalcola', 'vraImpTipoChange', 'vraTogglePanel'].forEach(function (nome) {
      var f = window[nome];
      if (typeof f !== 'function' || f.__vraAvvisi) return;
      var g = function () { var r = f.apply(this, arguments); setTimeout(ciclo, 260); return r; };
      g.__vraAvvisi = true;
      window[nome] = g;
    });
    setTimeout(ciclo, 400);
    setTimeout(ciclo, 1500);
  }

  function parti() {
    installa();
    avviaOsservatore();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', parti);
  else parti();
  // Rete di sicurezza, come per gli altri add-on: le funzioni della VRA si
  // definiscono nei loro file, che possono arrivare dopo.
  setTimeout(function () { avviaOsservatore(); installa(); }, 700);

  // Esposto per diagnosi da console e per le prove automatiche.
  window.vraAvvisi = { versione: VERSIONE, stato: stato, motivo: motivo, avviata: avviata };
})();
