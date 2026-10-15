// ============================================================================
// PARCO IoT — add-on `foto-report.js`  —  v1 (03/08/2026)
// ============================================================================
// Rimette le fotografie nei report generati DOPO una ricarica della pagina.
//
// IL PROBLEMA
// Le immagini di un rilievo vivono nella memoria della pagina. La bozza di una
// VRA viaggia sul server portando solo i valori — le foto no, sarebbero
// megabyte a ogni sospensione. Quando si ricarica la pagina per riprendere la
// bozza, quella memoria è vuota: il documento Word usciva senza immagini, con
// un avviso che dichiarava l'assenza. Corretto come comportamento, ma povero
// come risultato — una valutazione di rischio senza le sue fotografie perde
// metà del suo valore di prova.
//
// LA SOLUZIONE
// Dal 03/08/2026 `archivio` conserva TUTTE le foto del rilievo e sa
// restituirle. Qui si va a riprenderle quando servono: se la memoria è vuota e
// l'albero ha foto archiviate, il report le usa come se fossero lì.
//
// PERCHÉ NON SI SCARICANO DA SOLE ALL'APERTURA
// Sarebbero centinaia di KB scaricati su rete mobile senza che nessuno li
// abbia chiesti. Si scaricano al primo clic su "Report" — un attimo di attesa
// dichiarato, invece di consumo silenzioso.
//
// PERCHÉ UN ADD-ON E NON UNA MODIFICA
// Il documento chiama la funzione globale `raccogliFotoRilievo()`. Basta
// avvolgerla: se restituisce foto, non si tocca niente; se torna vuota, si
// restituiscono quelle recuperate. `analisi-albero-logic.js` resta intatto.
//
// SI PRENDONO SOLO LE FOTO DELL'ULTIMO RILIEVO
// La cartella di un albero accumula le campagne di anni. `archivio` marca con
// `ultimo` quelle scattate entro un quarto d'ora dalla più recente: sono
// quelle di una stessa sessione. Un report non deve mescolare le foto di oggi
// con quelle di due anni fa senza dirlo.
//
// ⚠ CARICARE DOPO `codice-parco-prefisso.js` (serve il lasciapassare del
//   login) e dopo `archivio-foto.js`.
//     <script src="foto-report.js"></script>
// ============================================================================

(function () {
  'use strict';

  var URL_DEFAULT = 'https://sldotadtisgekovgvsqr.supabase.co/functions/v1/archivio';
  var K_URL = 'archivioUrl';

  var VERDE = '#2f6b4f', FAINT = '#6a7a70', ROSSO = '#a4472f';

  // Foto recuperate: { treeId: 'Q12', voci: [{file: Blob, label: '...'}] }
  var deposito = null;
  var inCorso = false;

  function getUrl() {
    try {
      var u = localStorage.getItem(K_URL);
      if (u && /^https?:\/\//.test(u)) return u.trim();
    } catch (e) {}
    return URL_DEFAULT;
  }

  function codiceAlbero() {
    var el = document.getElementById('treeCode');
    return el ? el.value.trim() : '';
  }

  // Le foto davvero in memoria, chiedendole alla funzione ORIGINALE: se
  // chiedessimo a quella avvolta ci risponderebbe con le nostre e gireremmo
  // in tondo.
  var raccogliOriginale = null;
  function fotoInMemoria() {
    try {
      var f = raccogliOriginale ? raccogliOriginale() : [];
      return (f && f.length) ? f : [];
    } catch (e) { return []; }
  }

  // ── Riga di stato ──────────────────────────────────────────────────────
  // Accanto a quella dei report, mai al posto suo.
  function riga() {
    var el = document.getElementById('fotoReportStatus');
    if (el) return el;
    var dopo = document.getElementById('csvStatus');
    if (!dopo || !dopo.parentNode) return null;
    el = document.createElement('div');
    el.id = 'fotoReportStatus';
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

  // ── Il recupero ────────────────────────────────────────────────────────
  function leggibile(etichetta) {
    if (!etichetta) return 'Foto archiviata';
    var s = etichetta.replace(/-/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1) + ' (da archivio)';
  }

  async function recupera(codice) {
    // Il codice parte nudo: il prefisso del parco e il lasciapassare del login
    // li aggiunge `codice-parco-prefisso.js`, che è l'unico punto in cui
    // quelle due regole vivono.
    var r = await fetch(getUrl() + '?action=foto&tree_id=' + encodeURIComponent(codice));
    if (r.status === 401) throw new Error('sessione scaduta: rifare il login');
    var d = await r.json().catch(function () { return null; });
    if (!r.ok || !d || !d.ok) {
      throw new Error((d && d.errore) ? d.errore : 'archivio non raggiungibile');
    }

    var voci = (d.foto || []).filter(function (f) { return f.ultimo && f.url; });
    if (!voci.length) return [];

    // Ordine di lettura: dalla più vecchia alla più recente, cioè l'ordine in
    // cui sono state scattate durante il rilievo.
    voci.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });

    var out = [];
    for (var i = 0; i < voci.length; i++) {
      stato('\u23f3 Recupero foto ' + (i + 1) + ' di ' + voci.length + ' dall\u2019archivio\u2026');
      try {
        // Chiamata NUDA: il collegamento temporaneo è già autorizzato per
        // conto suo, e aggiungerci il lasciapassare del login lo farebbe
        // rifiutare dal magazzino.
        var f = window.__fetchNudo || window.fetch;
        var img = await f(voci[i].url);
        if (!img.ok) continue;
        var blob = await img.blob();
        out.push({ file: blob, label: leggibile(voci[i].etichetta) });
      } catch (e) { /* una foto persa non deve fermare le altre */ }
    }
    return out;
  }

  async function preparaSeServe() {
    if (fotoInMemoria().length) return true;      // ci sono già: non serve niente

    var codice = codiceAlbero();
    if (!codice) return true;                     // nessun albero: si prosegue

    if (deposito && deposito.treeId === codice) return true;   // già recuperate

    try {
      var voci = await recupera(codice);
      deposito = { treeId: codice, voci: voci };
      if (voci.length) {
        stato('\u2713 ' + voci.length + ' foto recuperate dall\u2019archivio e inserite nel report.', 'ok');
      } else {
        stato('Nessuna foto archiviata per questo albero: il report ne uscir\u00e0 senza.', null);
      }
    } catch (e) {
      deposito = { treeId: codice, voci: [] };
      stato('\u26a0 Foto non recuperate (' + (e.message || 'errore') +
            '). Il report viene generato lo stesso, senza immagini.', 'err');
    }
    return true;
  }

  // ── L'avvolgimento della raccolta foto ─────────────────────────────────
  function avvolgi() {
    if (typeof window.raccogliFotoRilievo !== 'function') return false;
    if (window.raccogliFotoRilievo.__recupero) return true;

    raccogliOriginale = window.raccogliFotoRilievo;

    window.raccogliFotoRilievo = function () {
      var vere = [];
      try { vere = raccogliOriginale.apply(this, arguments) || []; } catch (e) { vere = []; }
      if (vere.length) return vere;               // memoria piena: comanda lei
      if (deposito && deposito.treeId === codiceAlbero() && deposito.voci.length) {
        return deposito.voci.slice();
      }
      return vere;
    };
    window.raccogliFotoRilievo.__recupero = true;
    return true;
  }

  // ── L'intercettazione dei pulsanti ─────────────────────────────────────
  // In fase di cattura, cioè PRIMA del gestore originale: si ferma il clic, si
  // recuperano le foto, poi si ripete il clic e stavolta lo si lascia passare.
  function intercetta(idPulsante) {
    var btn = document.getElementById(idPulsante);
    if (!btn || btn.__recuperoFoto) return;
    btn.__recuperoFoto = true;

    btn.addEventListener('click', function (ev) {
      if (inCorso) return;                        // è il clic ripetuto da noi
      if (fotoInMemoria().length) return;         // niente da recuperare
      if (deposito && deposito.treeId === codiceAlbero()) return;  // già fatto

      ev.preventDefault();
      ev.stopImmediatePropagation();

      inCorso = true;
      var testo = btn.textContent;
      btn.disabled = true;
      btn.textContent = '\u23f3 Recupero foto\u2026';

      preparaSeServe().then(function () {
        btn.disabled = false;
        btn.textContent = testo;
        inCorso = false;
        btn.click();                              // ora il gestore originale può lavorare
      });
    }, true);
  }

  // ── Avvio ──────────────────────────────────────────────────────────────
  function installa() {
    if (!avvolgi()) return setTimeout(installa, 400);
    intercetta('btnDocx');
    intercetta('btnCsv');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installa);
  } else {
    installa();
  }
  setTimeout(installa, 600);   // rete di sicurezza, come gli altri add-on

  // Esposto per diagnosi da console.
  window.fotoReport = {
    versione: 'foto-report v1 (03/08/2026)',
    deposito: function () {
      return deposito
        ? { albero: deposito.treeId, recuperate: deposito.voci.length }
        : null;
    },
    recuperaOra: function () { deposito = null; return preparaSeServe(); }
  };
})();
