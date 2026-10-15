// ============================================================================
// PARCO IoT — add-on `chioma-regola.js`  —  v1 (22/09/2026)
// ============================================================================
// La regola della chioma, scritta IN UN POSTO SOLO.
//
// Prima di questo file la stessa regola era scritta quattro volte (form con le
// foto, form a misure manuali, VRA, ripresa delle VRA sospese), e tutte e
// quattro sbagliavano allo stesso modo: scartavano i raggi a zero prima di fare
// la media. Con Est 5 m e Ovest 0 m (Nord e Sud 3 m) la larghezza usciva 7,3 m
// invece di 5,5 m, e la simmetria usciva «regolare» invece di «molto
// asimmetrica». Chi usa la chioma chiama queste funzioni e non ne ha una sua.
//
// LA REGOLA
//   • Zero è una misura valida: «da questo lato non c'è chioma».
//   • Il vuoto non esiste nei dati nuovi. Nel modo a misure manuali un campo
//     vuoto vale zero (il campo parte già con 0 scritto dentro); nel modo con
//     le foto un raggio non stimato ferma l'analisi, perché lì il vuoto non lo
//     sceglie una persona, lo produce un guasto.
//   • Larghezza = media dei due diametri = ((N + S) + (E + O)) / 2.
//   • Simmetria per asse: si confronta Nord con Sud ed Est con Ovest.
//
// I dati VECCHI possono avere raggi vuoti: per quelli `larghezza` restituisce
// null, cioè «non calcolabile», e non inventa niente.
//
// Deve essere caricato PRIMA di `analisi-albero-logic.js`.
// ============================================================================
(function () {
  'use strict';

  var DIREZIONI = ['N', 'E', 'S', 'O'];
  var NOMI = { N: 'Nord', E: 'Est', S: 'Sud', O: 'Ovest' };

  // Un numero finito, oppure null. Accetta anche la virgola decimale.
  // Vuoto, testo e NaN diventano null: qui NON si decide che il vuoto è zero,
  // lo decide chi chiama.
  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = (typeof v === 'number') ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function normalizza(r) {
    r = r || {};
    return { N: numero(r.N), E: numero(r.E), S: numero(r.S), O: numero(r.O) };
  }

  // Le direzioni senza un valore, in ordine N, E, S, O.
  function mancanti(r) {
    var n = normalizza(r);
    return DIREZIONI.filter(function (d) { return n[d] == null; });
  }

  // Larghezza della chioma in metri, un decimale. null se manca anche un solo
  // raggio: con un asse incompleto il numero sarebbe inventato a metà.
  function larghezza(r) {
    var n = normalizza(r);
    if (n.N == null || n.E == null || n.S == null || n.O == null) return null;
    return Math.round(((n.N + n.S) + (n.E + n.O)) / 2 * 10) / 10;
  }

  // Simmetria per asse, con le stesse soglie di prima (20% e 40%).
  // Un asse con entrambi i raggi a zero non dice nulla e si salta; un asse con
  // un lato a zero e l'altro no è il massimo dell'asimmetria (differenza 100%).
  function simmetria(r) {
    var n = normalizza(r);
    var esito = 'regolare';
    function asse(a, b) {
      if (a == null || b == null) return;
      var max = Math.max(a, b);
      if (max <= 0) return;
      var diff = Math.abs(a - b) / max;
      if (diff > 0.4) esito = 'molto_asimmetrica';
      else if (diff > 0.2 && esito === 'regolare') esito = 'moderatamente_asimmetrica';
    }
    asse(n.N, n.S);
    asse(n.E, n.O);
    return esito;
  }

  function nome(d) { return NOMI[d] || d; }

  window.chiomaRegola = {
    versione: 'chioma-regola v1 (22/09/2026)',
    numero: numero,
    mancanti: mancanti,
    larghezza: larghezza,
    simmetria: simmetria,
    nome: nome
  };
})();
