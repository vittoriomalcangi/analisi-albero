// arete-vra-logic.js
// ─────────────────────────────────────────────────────────────────────────
// Modulo "Valutazione del Rischio Arboreo" (VRA) — Protocollo Areté® v4.0
// Estende Analisi_Albero.html con un pannello opzionale, riservato al tecnico
// abilitato, che compare sulla schermata risultati (dopo l'analisi morfologica).
// Riusa i dati già rilevati (DBH, altezza, inserzione, chioma, salute) e
// aggiunge Pericolosità (P), Bersaglio (B), Impulso (I), Valore e giudizio di
// rischio, propagandoli nei report (video, "Copia tutto", CSV, DOCX) e nel
// payload al foglio Google — ma SOLO se la VRA viene effettivamente compilata.
//
// Caricare DOPO analisi-albero-logic.js e dopo l'ultimo <script> inline:
//   <script src="arete-vra-logic.js"></script>
//
// Richiede 2 micro-inserimenti in analisi-albero-logic.js (vedi README in coda
// alla conversazione): un hook nel CSV e uno nel DOCX. Tutto il resto (schermata
// risultati, report testuale, payload) si aggancia da solo via monkey-patch.
//
// Riferimento: "Protocollo Areté® per la Valutazione del Rischio Arboreo
// [ver. 4.0] - ARBORETE® (http://www.protocolloarete.it)".
// ─────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var G = 9.81; // m/s²

  // ═══════════════════════════════════════════════════════════════════════
  // 1. DATI DI RIFERIMENTO DEL PROTOCOLLO (Allegati 2, 3, 4, 6)
  // ═══════════════════════════════════════════════════════════════════════

  // ── Tab. A6.1 — valore di rischio R per ogni terna (B, I, P) ─────────────
  // Memorizzato come denominatore D (R = 1:D). Sono riportate solo le celle con
  // D < 1.000.000 (le uniche che spostano la fascia di tollerabilità); tutte le
  // terne non elencate valgono "< 1:1M" → largamente accettabile (D = Infinity).
  // Trascritto cella per cella dalla Tab. A6.1; le poche differenze di rounding
  // del Montecarlo fra arrangiamenti (es. 2-1-4 = 1:10k vs 1-2-4 = 1:12k) sono
  // conservate esatte per combaciare col protocollo in caso di verifica.
  var RISK = {
    1: {
      1: { 1: 3, 2: 20, 3: 200, 4: 2000, 5: 20000, 6: 200000 },
      2: { 1: 20, 2: 100, 3: 1000, 4: 12000, 5: 130000 },
      3: { 1: 200, 2: 1000, 3: 12000, 4: 120000 },
      4: { 1: 2000, 2: 12000, 3: 120000 },
      5: { 1: 20000, 2: 120000 },
      6: { 1: 200000 }
    },
    2: {
      1: { 1: 20, 2: 100, 3: 1000, 4: 10000, 5: 120000 },
      2: { 1: 100, 2: 800, 3: 8000, 4: 80000, 5: 800000 },
      3: { 1: 1000, 2: 8000, 3: 80000, 4: 800000 },
      4: { 1: 12000, 2: 80000, 3: 800000 },
      5: { 1: 130000, 2: 800000 }
    },
    3: {
      1: { 1: 200, 2: 1000, 3: 12000, 4: 120000 },
      2: { 1: 1000, 2: 8000, 3: 80000, 4: 800000 },
      3: { 1: 12000, 2: 80000, 3: 800000 },
      4: { 1: 120000, 2: 800000 }
    },
    4: {
      1: { 1: 2000, 2: 12000, 3: 120000 },
      2: { 1: 12000, 2: 80000, 3: 800000 },
      3: { 1: 120000, 2: 800000 }
    },
    5: {
      1: { 1: 20000, 2: 120000 },
      2: { 1: 130000, 2: 800000 }
    },
    6: {
      1: { 1: 200000 }
    }
  };

  function riskDenominator(B, I, P) {
    var d = RISK[B] && RISK[B][I] && RISK[B][I][P];
    return (d == null) ? Infinity : d;
  }

  // ── Tab. A6.4 — fasce di Tollerabilità del Rischio (dal valore R = 1:D) ───
  function torBand(D) {
    if (D < 1000)     return 'INACCETTABILE';
    if (D < 10000)    return 'TUTELA';
    if (D < 20000)    return 'ACCORDO';
    if (D < 130000)   return 'ALARP_INT';
    if (D < 1000000)  return 'ALARP';
    return 'LARGAMENTE';
  }

  var TOR = {
    INACCETTABILE: {
      colore: '#c62828', label: 'Rischio inaccettabile',
      giudizio: 'Rischio inaccettabile',
      trattamento: 'Eliminazione del rischio mediante abbattimento o altro intervento tecnico-colturale (confinamento, ancoraggio, ecc.).'
    },
    TUTELA: {
      colore: '#e65100', label: 'Tollerabile solo con tutela specifica',
      giudizio: 'Tollerabile solo in regime di tutela specifica e se comunicato e accettato dai fruitori',
      trattamento: 'Riduzione del rischio condizionata. La conservazione dipende da un REGIME DI TUTELA SPECIFICA dell’albero (elevato valore estetico-ambientale o storico-testimoniale) che deve essere comunicato ai possibili fruitori. L’eliminazione è condizionata alla dimostrata assenza di ragionevoli alternative di riduzione.'
    },
    ACCORDO: {
      colore: '#f9a825', label: 'Tollerabile per accordo',
      giudizio: 'Tollerabile per accordo ma inaccettabile se imposto a terzi inconsapevoli',
      trattamento: 'Riduzione del rischio condizionata dal valore estetico-ambientale o affettivo. La conservazione dipende da un ACCORDO CONDIVISO fra gestore e fruitori dell’albero. Il gestore individua gli interventi di riduzione, tenuto conto del valore dell’esemplare.'
    },
    ALARP_INT: {
      colore: '#c0ca33', label: 'Tollerabile se ALARP (prossimo al limite)',
      giudizio: 'Tollerabile se ALARP, cioè ragionevolmente praticabile',
      trattamento: 'Controllo e riduzione del rischio. Poiché ci si trova vicino al limite superiore di tollerabilità (1:20.000), è necessario giustificare l’efficacia delle misure adottando un piano di monitoraggio intenso.'
    },
    ALARP: {
      colore: '#2f6b4f', label: 'Tollerabile in quanto ALARP',
      giudizio: 'Tollerabile in quanto ALARP, cioè ragionevolmente praticabile',
      trattamento: 'Controllo e riduzione del rischio. Il gestore confronta i benefici degli interventi di riduzione, finalizzati alla conservazione dell’albero, con il loro costo e con la perdita di benefici derivante dall’eventuale cedimento.'
    },
    LARGAMENTE: {
      colore: '#1565c0', label: 'Largamente accettabile',
      giudizio: 'Rischio largamente accettabile',
      trattamento: 'Revisione periodica del rischio.'
    }
  };

  // ── Codice Triage equivalente (Tab. A6.2), derivato dal valore R = 1:D ────
  function triageCode(D) {
    if (D < 2000)     return { code: 'VIOLA',   colore: '#7b2d8e', priorita: 'Emergenza — intervento immediato' };
    if (D < 10000)    return { code: 'ROSSO',   colore: '#c62828', priorita: 'Emergenza — VRA o intervento immediati' };
    if (D < 20000)    return { code: 'ARANCIO', colore: '#e65100', priorita: 'Urgenza — VRA da subito a 1 anno' };
    if (D < 200000)   return { code: 'GIALLO',  colore: '#f9a825', priorita: 'Moderata — VRA da 1 a 3 anni' };
    if (D <= 1000000) return { code: 'VERDE',   colore: '#2f6b4f', priorita: 'Bassa — VRA/Triage da 3 a 5 anni' };
    return { code: 'BLU', colore: '#1565c0', priorita: 'Differibile — VRA/Triage da 5 a 10 anni' };
  }

  // ── Allegato 2 — descrizione classi di Pericolo (VRA, Tab. A2.2) ──────────
  var PERICOLO = [
    { v: '1', label: '1 — Critico',        desc: 'Difetti molto gravi. Cedimento nell’anno tra 100% e 20% (molto elevata).' },
    { v: '2', label: '2 — Elevato',        desc: 'Difetti gravi. Cedimento tra 20% e 2% (elevata).' },
    { v: '3', label: '3 — Significativo',  desc: 'Difetti che aumentano moderatamente la pericolosità. Tra 2% e 0,2% (significativa).' },
    { v: '4', label: '4 — Incerto',        desc: 'Difetti non chiaramente definibili. Tra 0,2% e 0,02% (incerta). Massimo di incertezza sulle condizioni.' },
    { v: '5', label: '5 — Moderato',       desc: 'Difetti limitati. Tra 0,02% e 0,002% (moderata).' },
    { v: '6', label: '6 — Basso',          desc: 'Difetti tollerabili. Tra 0,002% e 0,0002% (bassa).' },
    { v: '7', label: '7 — Trascurabile',   desc: 'Difetti trascurabili o assenti. Pericolosità quasi nulla.' },
    { v: '0', label: '0 — Sospesa (indagine strumentale)', desc: 'Difetti non decifrabili con la sola analisi visiva: valutazione SOSPESA fino agli approfondimenti.' },
    { v: 'nv', label: '— Non valutata',    desc: 'Porzione non indagata: per essa il giudizio resta indefinito.' }
  ];
  var PARTI = [
    { id: 'radice',  label: 'Apparato radicale / zolla' },
    { id: 'colletto', label: 'Colletto' },
    { id: 'fusto',   label: 'Fusto / castello' },
    { id: 'rami',    label: 'Rami / branche' }
  ];

  // ── Classificazione da probabilità di occupazione p → classe 1..7 (Allegato 3)
  // Soglie: classe k per p in (0,2·10^-(k-1) ; 0,2·10^-(k-2)]; p>0,2 → classe 1.
  // Il valore mostrato in tabella è il bordo INFERIORE incluso della classe
  // (es. 600.000 € = classe 1, 60.000 € = classe 2): confine → classe più
  // rischiosa (numero più basso).
  var P_THRESHOLDS = [0.2, 0.02, 2e-3, 2e-4, 2e-5, 2e-6];
  function classFromP(p) {
    var c = 1;
    for (var i = 0; i < P_THRESHOLDS.length; i++) if (p < P_THRESHOLDS[i]) c++;
    return Math.min(c, 7);
  }

  // ── Allegato 4 — classi di Impulso (kgm/s), Tab. A4.1 ─────────────────────
  // Classe 1 = "oltre 10.000" (esclusiva); le altre col bordo inferiore incluso.
  function classFromImpulso(P) {
    if (P > 10000) return 1;
    if (P >= 1000) return 2;
    if (P >= 100)  return 3;
    if (P >= 50)   return 4;
    if (P >= 10)   return 5;
    if (P >= 5)    return 6;
    return 7;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. CONFIGURAZIONE ESPANDIBILE (parametri protocollo, editabili + localStorage)
  // ═══════════════════════════════════════════════════════════════════════
  var CFG_KEY = 'areteVraConfig_v1';
  var CFG_DEFAULT = {
    vasvu: 3000000,            // valore statistico vita umana (€) — Allegato 3
    F: 0.75,                   // coefficiente di forma
    rho: 900,                  // densità apparente del legno (kg/m³)
    Hb: 2,                     // altezza bersaglio riferita all'uomo (m)
    mu: 1.0,                   // attrito equiv. per il tempo d'arresto (riproduce Tab. A3.1)
    vPedone: 4,                // km/h
    // Categorie stradali → velocità di riferimento (km/h)
    strade: {
      vicinale: 30, comunale: 50, provinciale: 70, statale: 90, autostrada: 110
    },
    // Densità legno per specie (kg/m³) — sovrascrive rho di default se presente
    densitaSpecie: {},
    // ── Motore VALORE (proxy Areté-compatibile, Allegato 7) ──
    valore: {
      set: 'proxy Areté-compatibile v1',
      // pesi delle variabili della qualità ornamentale (sommano a 1)
      pesi: {
        dimensione: 0.22, altezza: 0.10, chioma: 0.13, posizioneSociale: 0.10,
        vincoli: 0.15, dimora: 0.05, localizzazione: 0.10, stadio: 0.05, salute: 0.10
      },
      sogliaModerato: 0.34,    // indice ≥ → almeno moderato
      sogliaElevato: 0.67,     // indice ≥ → elevato
      // funzione di trasferimento (proxy, chiaramente etichettata come stima)
      kEstetico: 8000,         // € per unità di indice ornamentale, a parità di scala
      coerenzaFitoclimatica: 1.0,
      prezzoCO2: 80,           // €/t CO2
      prezzoServiziExtra: 0.15 // quota aggiuntiva O2+PM sul valore ecologico
    }
  };
  var CFG = loadConfig();

  function loadConfig() {
    var c = JSON.parse(JSON.stringify(CFG_DEFAULT));
    try {
      var saved = window.localStorage.getItem(CFG_KEY);
      if (saved) deepMerge(c, JSON.parse(saved));
    } catch (e) { /* localStorage non disponibile: si usano i default */ }
    return c;
  }
  function saveConfig() {
    try { window.localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); return true; }
    catch (e) { return false; }
  }
  function deepMerge(dst, src) {
    for (var k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
        if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
        deepMerge(dst[k], src[k]);
      } else dst[k] = src[k];
    }
    return dst;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. ACCESSO SICURO ALLO STATO DEL RILIEVO (variabili globali di logic.js)
  // ═══════════════════════════════════════════════════════════════════════
  function LR()  { try { return lastResult; }  catch (e) { return null; } }
  function LDBH(){ try { return lastDbh; }     catch (e) { return null; } }
  function LSOG(){ try { return lastSoglia; }  catch (e) { return null; } }

  function datiMorfologici() {
    var r = LR() || {};
    var dbh = LDBH();
    var H = num(r.altezza_totale_m);
    var Hins = num(r.altezza_inserzione_chioma_m);
    var larg = num(r.larghezza_chioma_m);
    // (22/09/2026) Ripiego dalla regola unica della chioma (chioma-regola.js):
    // somma dei due diametri diviso due, zeri compresi. Se manca un raggio la
    // larghezza resta null — dichiarata, non ricostruita a metà.
    if (larg == null && r.raggi && window.chiomaRegola) {
      larg = window.chiomaRegola.larghezza(r.raggi);
    }
    var Wmedia = (H != null && larg != null) ? (H + larg) / 2 : (H != null ? H : null);
    var rho = CFG.rho;
    var sp = (document.getElementById('treeSpecies') || {}).value || '';
    if (sp && CFG.densitaSpecie[sp.trim()]) rho = CFG.densitaSpecie[sp.trim()];
    return { dbh: dbh, H: H, Hins: Hins, larg: larg, Wmedia: Wmedia, rho: rho };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. STATO VRA + RISULTATO CALCOLATO (esposto per gli export)
  // ═══════════════════════════════════════════════════════════════════════
  var vra = { completa: false, out: null };
  window.vraData = vra;

  // ═══════════════════════════════════════════════════════════════════════
  // 5. MOTORI DI CALCOLO
  // ═══════════════════════════════════════════════════════════════════════

  // ── IMPULSO (Allegato 4) ──
  function calcImpulso() {
    var m = datiMorfologici();
    var tipo = valEl('vraImpTipo') || 'albero';
    var F = CFG.F, rho = m.rho, Hb = CFG.Hb;
    var out = { tipo: tipo, F: F, rho: rho, Hb: Hb };
    if (tipo === 'albero') {
      var D = numEl('vraImpDbh', m.dbh);       // cm
      var H = numEl('vraImpH', m.H);           // m
      if (D == null || H == null || H <= Hb) return null;
      var M = Math.PI / 4 * Math.pow(D / 100, 2) * H * F * rho;      // kg
      var P = M * Math.sqrt(3 * G * (H - Hb));                        // kgm/s
      out.D = D; out.H = H; out.M = M; out.P = P;
    } else {
      var Dr = numEl('vraImpDram', null);      // cm, diametro all'inserzione
      var L = numEl('vraImpLram', null);       // m
      var Hi = numEl('vraImpHins', m.Hins);    // m, altezza inserzione
      if (Dr == null || L == null || Hi == null || Hi <= Hb) return null;
      var Mb = Math.PI / 4 * Math.pow(Dr / 100, 2) * L * F * rho;
      var Pb = Mb * Math.sqrt(2 * G * (Hi - Hb));
      out.D = Dr; out.L = L; out.Hins = Hi; out.M = Mb; out.P = Pb;
    }
    out.classe = classFromImpulso(out.P);
    return out;
  }

  // ── BERSAGLIO (Allegato 3) ──
  function calcBersaglio() {
    var m = datiMorfologici();
    var W = numEl('vraBW', m.Wmedia);   // dimensione caratteristica (m)
    var risultati = [];

    // Occupazione stabile (Tab. A3.4): p = tempo di permanenza / 24h
    if (chk('vraBOccOn')) {
      var val = numEl('vraBOccVal', 0), unit = valEl('vraBOccUnit') || 'h_day';
      var secDay = toSecondsPerDay(val, unit);
      var p = secDay / 86400;
      risultati.push(bersaglioItem('Occupazione stabile', p, val + ' ' + unitLabel(unit)));
    }
    // Beni materiali (Tab. A3.5): p = valore / VASVU
    if (chk('vraBBeniOn')) {
      var eur = numEl('vraBBeniVal', 0);
      var pb = eur / CFG.vasvu;
      risultati.push(bersaglioItem('Beni materiali', pb, fmtEur(eur)));
    }
    // Pedoni / ciclisti (Tab. A3.3): p = passaggi/giorno · (W/vPed) / 86400
    if (chk('vraBPedOn') && W) {
      var pass = passaggiGiorno('vraBPedVal', 'vraBPedUnit');
      var vPed = CFG.vPedone / 3.6;                 // m/s
      var tPed = W / vPed;
      var pp = pass * tPed / 86400;
      risultati.push(bersaglioItem('Pedoni / ciclisti', pp, Math.round(pass) + ' pass./giorno'));
    }
    // Traffico veicolare (Tab. A3.1): t = max(traversata, arresto); ×1,3 pers/veicolo
    if (chk('vraBTrafOn') && W) {
      var passV = passaggiGiorno('vraBTrafVal', 'vraBTrafUnit');
      var cat = valEl('vraBTrafCat') || 'comunale';
      var vV = (CFG.strade[cat] || 50) / 3.6;       // m/s
      var tTrav = W / vV, tStop = vV / (CFG.mu * G);
      var tExp = Math.max(tTrav, tStop);
      var pv = passV * 1.3 * tExp / 86400;
      risultati.push(bersaglioItem('Traffico (' + cat + ')', pv, Math.round(passV) + ' veic./giorno'));
    }

    if (!risultati.length) return null;
    // Bersaglio = classe di esposizione peggiore (classe più bassa)
    var peggiore = risultati.reduce(function (a, b) { return b.classe < a.classe ? b : a; });
    var n = Math.max(1, Math.round(numEl('vraBMolt', 1) || 1)); // bersagli multipli ×n
    return { classe: peggiore.classe, tipo: peggiore.tipo, dettaglio: risultati, molt: n, W: W };
  }
  function bersaglioItem(tipo, p, raw) {
    return { tipo: tipo, p: p, raw: raw, classe: classFromP(p) };
  }
  function toSecondsPerDay(v, unit) {
    switch (unit) {
      case 'h_day':   return v * 3600;
      case 'min_day': return v * 60;
      case 'min_week':return v * 60 / 7;
      case 'min_month':return v * 60 / 30;
      case 'min_year':return v * 60 / 365;
      default: return v * 3600;
    }
  }
  function unitLabel(u) {
    return { h_day: 'ore/giorno', min_day: 'min/giorno', min_week: 'min/sett.', min_month: 'min/mese', min_year: 'min/anno' }[u] || u;
  }
  function passaggiGiorno(valId, unitId) {
    var v = numEl(valId, 0), u = valEl(unitId) || 'day';
    switch (u) {
      case 'min':  return v * 1440;
      case 'hour': return v * 24;
      case 'day':  return v;
      case 'week': return v / 7;
      case 'month':return v / 30;
      case 'year': return v / 365;
      default: return v;
    }
  }

  // ── PERICOLO (Allegato 2) — worst-case fra le parti valutate ──
  function calcPericolo() {
    var classi = [], sospese = [], nonValutate = [], dettaglio = {};
    PARTI.forEach(function (parte) {
      var v = valEl('vraP_' + parte.id);
      dettaglio[parte.id] = v;
      if (v === '0') sospese.push(parte.label);
      else if (v === 'nv' || v == null || v === '') nonValutate.push(parte.label);
      else classi.push(parseInt(v, 10));
    });
    if (!classi.length) {
      return { classe: null, sospese: sospese, nonValutate: nonValutate, dettaglio: dettaglio,
               nota: 'Nessuna parte con giudizio numerico: valutazione del rischio SOSPESA/indefinita.' };
    }
    return {
      classe: Math.min.apply(null, classi),  // la parte più critica
      sospese: sospese, nonValutate: nonValutate, dettaglio: dettaglio
    };
  }

  // ── VALORE (Allegato 7) — indice qualità ornamentale 0..1 + classe + € proxy ──
  function calcValore() {
    var m = datiMorfologici();
    var v = CFG.valore, w = v.pesi;
    var circ = numEl('dbh', null); // circonferenza del rilievo (per la dimensione)
    var sub = {
      dimensione: clamp((m.dbh || 0) / 100, 0, 1),
      altezza: clamp((m.H || 0) / 30, 0, 1),
      chioma: clamp((m.larg || 0) / 20, 0, 1),
      posizioneSociale: mapScore('vraVPos', { dominante: 1, codominante: 0.7, dominata: 0.4, isolata: 1 }, 0.6),
      vincoli: mapScore('vraVVincoli', { monumentale: 1, tutela: 0.7, nessuno: 0.3 }, 0.3),
      dimora: mapScore('vraVDimora', { definitiva: 1, provvisoria: 0.4 }, 1),
      localizzazione: mapScore('vraVLoc', { pregio: 1, media: 0.6, scarsa: 0.3 }, 0.6),
      stadio: mapScore('vraVStadio', { adulto: 1, maturo: 0.85, giovane: 0.5, senescente: 0.4 }, 0.85),
      salute: saluteScore()
    };
    var index = 0, contrib = {};
    for (var k in w) { contrib[k] = w[k] * sub[k]; index += contrib[k]; }
    index = clamp(index, 0, 1);
    var classe = index >= v.sogliaElevato ? 'elevato' : (index >= v.sogliaModerato ? 'moderato' : 'basso');

    // Trasferimento in € (proxy, chiaramente etichettato come stima)
    var eurEstetico = Math.round(index * v.kEstetico * v.coerenzaFitoclimatica * (1 + (m.dbh || 0) / 100));
    var massa = (m.dbh && m.H) ? Math.PI / 4 * Math.pow(m.dbh / 100, 2) * m.H * CFG.F * m.rho : 0;
    var co2t = massa * 0.5 * 0.5 * 3.67 / 1000; // biomassa·(secco)·(C)·(CO2/C) in t
    var eurEco = Math.round(co2t * v.prezzoCO2 * (1 + v.prezzoServiziExtra));
    var override = numEl('vraVOverride', null);

    return {
      index: round2(index), classe: classe, sub: sub, contrib: contrib,
      eurEstetico: eurEstetico, eurEcologico: eurEco, eurTotale: eurEstetico + eurEco,
      override: override, set: v.set
    };
  }
  function saluteScore() {
    var s = (document.getElementById('saluteEsito') || {}).value || '';
    return s === 'sano' ? 1 : (s === 'anomalie' ? 0.5 : 0.6);
  }

  // ── RISCHIO — mette insieme B, I, P → R → fascia ToR → giudizio/trattamento ──
  function calcRischio(P, B, I, valore, aspettativa) {
    if (P == null || P.classe == null) {
      return { sospeso: true, motivo: P ? P.nota : 'Pericolosità non definita.' };
    }
    if (!B) return { sospeso: true, motivo: 'Nessun bersaglio definito.' };
    if (!I) return { sospeso: true, motivo: 'Impulso non calcolabile (mancano altezza/DBH o parametri branca).' };

    var D = riskDenominator(B.classe, I.classe, P.classe);
    var band = torBand(D);
    var tor = TOR[band];
    var trg = triageCode(D);
    var nota = modulazione(band, valore ? valore.classe : null, aspettativa);
    return {
      sospeso: false,
      B: B.classe, I: I.classe, P: P.classe,
      D: D, Rlabel: (D === Infinity ? '< 1:1.000.000' : '1:' + fmtDen(D)),
      band: band, giudizio: tor.giudizio, trattamento: tor.trattamento, colore: tor.colore,
      triage: trg, notaValore: nota, molt: B.molt || 1
    };
  }

  // Modulazione del trattamento con Valore (A6.5) e Aspettativa di vita (A6.6)
  function modulazione(band, valClasse, asp) {
    var note = [];
    var alto = (band === 'INACCETTABILE' || band === 'TUTELA' || band === 'ACCORDO');
    if (alto && valClasse === 'elevato') {
      note.push('Valore elevato: prima dell’abbattimento valutare confinamento (recinzione), cure colturali rigenerative e comunicazione dell’opportunità di accettare il rischio (Tab. A6.5).');
    } else if (alto && valClasse === 'moderato') {
      note.push('Valore moderato: valutare confinamento/condivisione del rischio come alternativa all’eliminazione (Tab. A6.5).');
    }
    if (asp === 'ridotta' && alto) {
      note.push('Aspettativa di vita ridotta: l’eliminazione del rischio è generalmente l’opzione ragionevole (Tab. A6.6).');
    } else if (asp === 'elevata' && (band === 'ALARP_INT' || band === 'ALARP')) {
      note.push('Aspettativa di vita elevata: privilegiare valutazione periodica e interventi colturali di conservazione (Tab. A6.6).');
    }
    return note.join(' ');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. HELPER GENERICI
  // ═══════════════════════════════════════════════════════════════════════
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
  function numEl(id, fb) { var e = document.getElementById(id); if (!e) return fb; var n = parseFloat(e.value); return isNaN(n) ? fb : n; }
  function valEl(id) { var e = document.getElementById(id); return e ? e.value : null; }
  function chk(id) { var e = document.getElementById(id); return !!(e && e.checked); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function round2(x) { return Math.round(x * 100) / 100; }
  function mapScore(id, map, dflt) { var v = valEl(id); return (v && map[v] != null) ? map[v] : dflt; }
  function fmtEur(n) { return (n == null || isNaN(n)) ? '—' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n); }
  function fmtDen(D) {
    if (D >= 1e6) return (D / 1e6) + 'M';
    if (D >= 1000) return (D / 1000) + 'k';
    return '' + D;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. UI — pannello VRA nella schermata risultati
  // ═══════════════════════════════════════════════════════════════════════
  function injectStyle() {
    if (document.getElementById('vraStyle')) return;
    var css = document.createElement('style');
    css.id = 'vraStyle';
    css.textContent =
      '.vra-open-btn{background:#143226;color:#fff;border:2px solid #143226;}' +
      '.vra-open-btn:active{background:#0d211a;}' +
      '.vra-panel{margin-top:6px;}' +
      '.vra-locknote{display:flex;gap:10px;background:#fdf3e3;border:1px solid #f0d29a;color:#7a3c08;border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.45;margin-bottom:14px;}' +
      '.vra-acc{border:1px solid var(--line);border-radius:12px;margin-bottom:12px;overflow:hidden;background:#fff;}' +
      '.vra-acc-head{width:100%;text-align:left;background:#fff;border:none;padding:15px 16px;font-family:var(--font);font-size:15.5px;font-weight:700;color:var(--ink);cursor:pointer;display:flex;align-items:center;gap:10px;justify-content:space-between;-webkit-tap-highlight-color:transparent;}' +
      '.vra-acc-head:active{background:var(--green-tint);}' +
      '.vra-acc-head .vra-chev{transition:transform .2s;color:var(--green);}' +
      '.vra-acc.open .vra-chev{transform:rotate(90deg);}' +
      '.vra-acc-body{display:none;padding:4px 16px 18px;border-top:1px solid var(--line-soft);}' +
      '.vra-acc.open .vra-acc-body{display:block;}' +
      '.vra-badge{font-size:12px;font-weight:700;color:#fff;border-radius:999px;padding:3px 9px;}' +
      '.vra-auto{background:var(--green-tint);border:1px solid var(--green-line);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--green-deep);margin-bottom:12px;line-height:1.4;}' +
      '.vra-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}' +
      '.vra-tgt{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;}' +
      '.vra-tgt .vra-tgt-h{display:flex;align-items:center;gap:9px;font-weight:700;font-size:14.5px;margin-bottom:8px;}' +
      '.vra-result{border-radius:14px;padding:16px;color:#fff;margin:8px 0 4px;}' +
      '.vra-result h3{margin:0 0 4px;font-size:15px;font-weight:700;opacity:.92;}' +
      '.vra-result .vra-r{font-size:30px;font-weight:700;line-height:1.1;}' +
      '.vra-result .vra-g{font-size:15px;font-weight:700;margin-top:6px;}' +
      '.vra-result .vra-t{font-size:13.5px;line-height:1.45;margin-top:10px;background:rgba(255,255,255,.16);border-radius:10px;padding:10px 12px;}' +
      '.vra-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}' +
      '.vra-chip{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px;font-weight:700;}' +
      '.vra-mini{font-size:12.5px;color:var(--ink-faint);margin-top:6px;line-height:1.4;}' +
      '.vra-idx-bar{height:10px;border-radius:6px;background:var(--green-tint-2);overflow:hidden;margin:6px 0;}' +
      '.vra-idx-fill{height:100%;background:var(--green);}';
    document.head.appendChild(css);
  }

  function optionList(list) {
    return list.map(function (o) { return '<option value="' + o.v + '">' + o.label + '</option>'; }).join('');
  }
  function acc(id, title, badgeId, body) {
    return '<div class="vra-acc" id="' + id + '">' +
      '<button type="button" class="vra-acc-head" onclick="window.vraToggleAcc(\'' + id + '\')">' +
        '<span>' + title + '</span>' +
        '<span style="display:flex;align-items:center;gap:10px;">' +
          (badgeId ? '<span class="vra-badge" id="' + badgeId + '" style="background:#9bbca9;">—</span>' : '') +
          '<span class="vra-chev">▶</span>' +
        '</span>' +
      '</button>' +
      '<div class="vra-acc-body">' + body + '</div></div>';
  }

  function buildPanel() {
    var m = datiMorfologici();
    var autoTxt = 'Dal rilievo: DBH ' + (m.dbh != null ? m.dbh + ' cm' : '—') +
      ' · Altezza ' + (m.H != null ? m.H + ' m' : '—') +
      ' · Inserzione ' + (m.Hins != null ? m.Hins + ' m' : '—') +
      ' · Dim. media ' + (m.Wmedia != null ? round2(m.Wmedia) + ' m' : '—') + '.';

    // A — Pericolosità
    var pBody = '<p class="help">Classe per ciascuna parte morfologica (Allegato 2). Il rischio usa la parte più critica.</p>';
    PARTI.forEach(function (parte) {
      pBody += '<div class="field"><label class="lbl">' + parte.label + '</label>' +
        '<select id="vraP_' + parte.id + '" onchange="window.vraLive()"><option value="nv">— non valutata</option>' +
        optionList(PERICOLO.filter(function (o) { return o.v !== 'nv'; })) + '</select></div>';
    });
    pBody += '<div class="vra-mini" id="vraPnote"></div>';

    // B — Bersaglio
    var bBody = '<p class="help">Attiva i bersagli presenti nell’area di caduta e inserisci il dato grezzo. Il bersaglio usa l’esposizione peggiore (Allegato 3).</p>' +
      '<div class="field"><label class="lbl">Dimensione caratteristica dell’albero <span class="opt">— (altezza+chioma)/2</span></label>' +
      '<div class="input-suffix"><input type="number" id="vraBW" step="0.1" value="' + (m.Wmedia != null ? round2(m.Wmedia) : '') + '" oninput="window.vraLive()"><span class="suffix">m</span></div></div>' +
      // occupazione
      '<div class="vra-tgt"><div class="vra-tgt-h"><input type="checkbox" id="vraBOccOn" onchange="window.vraLive()">Occupazione stabile di persone</div>' +
        '<div class="vra-row2"><div class="field" style="margin:0"><input type="number" id="vraBOccVal" placeholder="es. 3" step="0.1" oninput="window.vraLive()"></div>' +
        '<div class="field" style="margin:0"><select id="vraBOccUnit" onchange="window.vraLive()"><option value="h_day">ore/giorno</option><option value="min_day">min/giorno</option><option value="min_week">min/settimana</option><option value="min_month">min/mese</option><option value="min_year">min/anno</option></select></div></div></div>' +
      // beni
      '<div class="vra-tgt"><div class="vra-tgt-h"><input type="checkbox" id="vraBBeniOn" onchange="window.vraLive()">Beni materiali / manufatti</div>' +
        '<div class="field" style="margin:0"><div class="input-suffix"><input type="number" id="vraBBeniVal" placeholder="valore di ricostruzione" step="100" oninput="window.vraLive()"><span class="suffix">€</span></div></div></div>' +
      // pedoni
      '<div class="vra-tgt"><div class="vra-tgt-h"><input type="checkbox" id="vraBPedOn" onchange="window.vraLive()">Passaggio pedoni / ciclisti</div>' +
        '<div class="vra-row2"><div class="field" style="margin:0"><input type="number" id="vraBPedVal" placeholder="passaggi" step="1" oninput="window.vraLive()"></div>' +
        '<div class="field" style="margin:0"><select id="vraBPedUnit" onchange="window.vraLive()">' + optUnitTempo() + '</select></div></div></div>' +
      // traffico
      '<div class="vra-tgt"><div class="vra-tgt-h"><input type="checkbox" id="vraBTrafOn" onchange="window.vraLive()">Traffico veicolare</div>' +
        '<div class="field" style="margin:0 0 8px"><select id="vraBTrafCat" onchange="window.vraLive()">' + optStrade() + '</select></div>' +
        '<div class="vra-row2"><div class="field" style="margin:0"><input type="number" id="vraBTrafVal" placeholder="veicoli" step="1" oninput="window.vraLive()"></div>' +
        '<div class="field" style="margin:0"><select id="vraBTrafUnit" onchange="window.vraLive()">' + optUnitTempo() + '</select></div></div></div>' +
      '<div class="field" style="margin:8px 0 0"><label class="lbl">Bersagli multipli <span class="opt">— ×n persone/valore</span></label>' +
        '<input type="number" id="vraBMolt" value="1" min="1" step="1" oninput="window.vraLive()"></div>' +
      '<div class="vra-mini" id="vraBnote"></div>';

    // C — Impulso
    var iBody = '<div class="vra-auto">Calcolato dalla fisica (Allegato 4): F=' + CFG.F + ', ρ=' + CFG.rho + ' kg/m³, Hb=' + CFG.Hb + ' m. Nessun inserimento necessario per l’albero intero.</div>' +
      '<div class="field"><label class="lbl">Cosa può cadere</label><select id="vraImpTipo" onchange="window.vraImpTipoChange();window.vraLive()">' +
        '<option value="albero">Albero intero</option><option value="branca">Branca / ramo</option></select></div>' +
      '<div id="vraImpAlbero"><div class="vra-row2">' +
        '<div class="field"><label class="lbl">DBH</label><div class="input-suffix"><input type="number" id="vraImpDbh" step="0.1" value="' + (m.dbh != null ? m.dbh : '') + '" oninput="window.vraLive()"><span class="suffix">cm</span></div></div>' +
        '<div class="field"><label class="lbl">Altezza</label><div class="input-suffix"><input type="number" id="vraImpH" step="0.1" value="' + (m.H != null ? m.H : '') + '" oninput="window.vraLive()"><span class="suffix">m</span></div></div></div></div>' +
      '<div id="vraImpBranca" class="hidden"><div class="vra-row2">' +
        '<div class="field"><label class="lbl">Ø branca all’inserzione</label><div class="input-suffix"><input type="number" id="vraImpDram" step="0.1" oninput="window.vraLive()"><span class="suffix">cm</span></div></div>' +
        '<div class="field"><label class="lbl">Lunghezza branca</label><div class="input-suffix"><input type="number" id="vraImpLram" step="0.1" oninput="window.vraLive()"><span class="suffix">m</span></div></div></div>' +
        '<div class="field"><label class="lbl">Altezza d’inserzione</label><div class="input-suffix"><input type="number" id="vraImpHins" step="0.1" value="' + (m.Hins != null ? m.Hins : '') + '" oninput="window.vraLive()"><span class="suffix">m</span></div></div></div>' +
      '<div class="vra-mini" id="vraInote"></div>';

    // D — Valore
    var vBody = '<p class="help">Indice di qualità ornamentale 0–1 (Allegato 7, ' + CFG.valore.set + '). La classe basso/moderato/elevato alimenta le tabelle di trattamento; il valore in € è una stima proxy.</p>' +
      '<div class="vra-row2">' +
        '<div class="field"><label class="lbl">Posizione sociale</label><select id="vraVPos" onchange="window.vraLive()"><option value="dominante">Dominante</option><option value="codominante">Codominante</option><option value="dominata">Dominata</option><option value="isolata">Isolata</option></select></div>' +
        '<div class="field"><label class="lbl">Vincoli</label><select id="vraVVincoli" onchange="window.vraLive()"><option value="nessuno">Nessuno</option><option value="tutela">Tutela</option><option value="monumentale">Monumentale</option></select></div>' +
        '<div class="field"><label class="lbl">Dimora</label><select id="vraVDimora" onchange="window.vraLive()"><option value="definitiva">Definitiva</option><option value="provvisoria">Provvisoria</option></select></div>' +
        '<div class="field"><label class="lbl">Localizzazione</label><select id="vraVLoc" onchange="window.vraLive()"><option value="media">Contesto medio</option><option value="pregio">Contesto di pregio</option><option value="scarsa">Contesto scarso</option></select></div>' +
        '<div class="field"><label class="lbl">Stadio di sviluppo</label><select id="vraVStadio" onchange="window.vraLive()"><option value="adulto">Adulto</option><option value="maturo">Maturo</option><option value="giovane">Giovane</option><option value="senescente">Senescente</option></select></div>' +
        '<div class="field"><label class="lbl">Aspettativa di vita</label><select id="vraVAsp" onchange="window.vraLive()"><option value="media">Media</option><option value="elevata">Elevata</option><option value="ridotta">Ridotta</option></select></div>' +
      '</div>' +
      '<div class="field" style="margin-bottom:6px"><label class="lbl">Override valore €<span class="opt"> — facoltativo, scavalca la stima</span></label><div class="input-suffix"><input type="number" id="vraVOverride" step="100" placeholder="lascia vuoto per usare la stima" oninput="window.vraLive()"><span class="suffix">€</span></div></div>' +
      '<div class="vra-mini" id="vraVnote"></div>';

    // E — Rischio residuo
    var rBody = '<p class="help">Ipotizza le classi post-intervento per stimare il rischio residuo (Allegato 6).</p>' +
      '<div class="vra-row2">' +
        '<div class="field"><label class="lbl">Pericolo residuo (P′)</label><select id="vraResP" onchange="window.vraLive()"><option value="">= attuale</option>' + optionList(PERICOLO.filter(function (o) { return o.v !== 'nv' && o.v !== '0'; })) + '</select></div>' +
        '<div class="field"><label class="lbl">Bersaglio residuo (B′)</label><select id="vraResB" onchange="window.vraLive()"><option value="">= attuale</option>' + opt1to7() + '</select></div>' +
      '</div><div class="vra-mini" id="vraResNote"></div>';

    var panel =
      '<div class="vra-locknote"><span>⚠️</span><div><strong>Sezione riservata al tecnico abilitato.</strong> La Valutazione del Rischio Arboreo va compilata solo da un professionista abilitato e formato. Se sei l’operatore di installazione, chiudi pure e prosegui con l’export.</div></div>' +
      acc('vraAccP', 'A · Pericolosità (P)', 'vraBadgeP', pBody) +
      acc('vraAccB', 'B · Bersaglio (B)', 'vraBadgeB', bBody) +
      acc('vraAccI', 'C · Impulso (I) — automatico', 'vraBadgeI', iBody) +
      acc('vraAccV', 'D · Valore dell’albero', 'vraBadgeV', vBody) +
      acc('vraAccR', 'E · Rischio residuo (post-intervento)', null, rBody) +
      '<div id="vraOutBox"></div>' +
      '<button class="btn btn-primary" style="margin-top:12px" onclick="window.vraCalcola()">🛡️ Calcola / aggiorna il rischio</button>' +
      settingsBlock() +
      '<p class="vra-mini" style="margin-top:14px">Metodo: Protocollo Areté® per la Valutazione del Rischio Arboreo [ver. 4.0] – ARBORETE® (protocolloarete.it). Valore stimato con set “' + CFG.valore.set + '”.</p>';

    return panel;
  }

  function optUnitTempo() {
    return '<option value="day">al giorno</option><option value="hour">all’ora</option><option value="min">al minuto</option><option value="week">alla settimana</option><option value="month">al mese</option><option value="year">all’anno</option>';
  }
  function optStrade() {
    var s = CFG.strade, o = '';
    for (var k in s) o += '<option value="' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + ' (' + s[k] + ' km/h)</option>';
    return o;
  }
  function opt1to7() {
    var o = '';
    for (var i = 1; i <= 7; i++) o += '<option value="' + i + '">' + i + '</option>';
    return o;
  }
  function settingsBlock() {
    return '<div class="vra-acc" id="vraAccCfg" style="margin-top:12px"><button type="button" class="vra-acc-head" onclick="window.vraToggleAcc(\'vraAccCfg\')"><span>⚙️ Parametri VRA (espandibili)</span><span class="vra-chev">▶</span></button><div class="vra-acc-body">' +
      '<p class="help">Valori editabili, salvati su questo dispositivo. Il VASVU è aggiornabile ai sensi del §2.3 del Protocollo.</p>' +
      '<div class="vra-row2">' +
        '<div class="field"><label class="lbl">VASVU (€)</label><input type="number" id="vraCfgVasvu" value="' + CFG.vasvu + '" step="100000"></div>' +
        '<div class="field"><label class="lbl">Densità ρ (kg/m³)</label><input type="number" id="vraCfgRho" value="' + CFG.rho + '" step="10"></div>' +
        '<div class="field"><label class="lbl">Attrito arresto μ</label><input type="number" id="vraCfgMu" value="' + CFG.mu + '" step="0.05"></div>' +
        '<div class="field"><label class="lbl">€/t CO₂ (valore eco)</label><input type="number" id="vraCfgCo2" value="' + CFG.valore.prezzoCO2 + '" step="5"></div>' +
      '</div>' +
      '<button class="btn btn-ghost" onclick="window.vraSalvaCfg()">💾 Salva parametri</button>' +
      '<div class="vra-mini" id="vraCfgNote"></div>' +
      '</div></div>';
  }

  // ── Mount / reset del pannello sulla schermata risultati ──
  function mountVRAPanel() {
    injectStyle();
    var host = document.getElementById('resultsSection');
    if (!host) return;
    var actions = host.querySelector('.results-actions');
    if (!actions) return;

    // reset stato ad ogni nuova analisi
    vra.completa = false; vra.out = null;

    var existing = document.getElementById('vraBlock');
    if (existing) existing.parentNode.removeChild(existing);

    var block = document.createElement('div');
    block.id = 'vraBlock';
    block.innerHTML =
      '<button class="btn vra-open-btn" id="vraOpenBtn" style="margin-bottom:6px" onclick="window.vraTogglePanel()">🛡️ Valutazione del Rischio Arboreo (VRA)</button>' +
      '<div class="vra-panel hidden" id="vraPanel"></div>';
    // inserisci prima dei pulsanti di export (dopo "Mostra report")
    var firstBtn = actions.querySelector('.report-box') || actions.firstChild;
    actions.insertBefore(block, firstBtn);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. RENDER DEI RISULTATI + LIVE UPDATE
  // ═══════════════════════════════════════════════════════════════════════
  function runCalc() {
    var P = calcPericolo();
    var B = calcBersaglio();
    var I = calcImpulso();
    var V = calcValore();
    var asp = valEl('vraVAsp') || 'media';
    var R = calcRischio(P, B, I, V, asp);

    // rischio residuo
    var resP = valEl('vraResP'), resB = valEl('vraResB');
    var residuo = null;
    if (!R.sospeso && (resP || resB)) {
      var Pp = resP ? { classe: parseInt(resP, 10) } : { classe: P.classe };
      var Bp = resB ? { classe: parseInt(resB, 10), molt: B.molt } : B;
      residuo = calcRischio(Pp, Bp, I, V, asp);
    }
    vra.out = { P: P, B: B, I: I, V: V, asp: asp, R: R, residuo: residuo, quando: new Date() };
    vra.completa = !R.sospeso;
    return vra.out;
  }

  function badge(id, txt, colore) {
    var e = document.getElementById(id);
    if (e) { e.textContent = txt; e.style.background = colore || '#9bbca9'; }
  }

  function render() {
    var o = vra.out; if (!o) return;
    // badge sulle fisarmoniche
    badge('vraBadgeP', o.P.classe != null ? 'P' + o.P.classe : (o.P.sospese && o.P.sospese.length ? 'sospesa' : '—'), o.P.classe != null ? '#2f6b4f' : '#e65100');
    badge('vraBadgeB', o.B ? 'B' + o.B.classe : '—', o.B ? '#2f6b4f' : '#9bbca9');
    badge('vraBadgeI', o.I ? 'I' + o.I.classe : '—', o.I ? '#2f6b4f' : '#9bbca9');
    badge('vraBadgeV', o.V ? o.V.classe : '—', o.V ? '#2f6b4f' : '#9bbca9');

    // note di dettaglio
    setText('vraPnote', pericoloNote(o.P));
    setText('vraBnote', o.B ? bersaglioNote(o.B) : 'Nessun bersaglio attivo.');
    setText('vraInote', o.I ? impulsoNote(o.I) : 'Impulso non calcolabile: verifica DBH/altezza (o parametri branca) e che l’altezza superi Hb=' + CFG.Hb + ' m.');
    setText('vraVnote', valoreNote(o.V));
    setText('vraResNote', o.residuo ? ('Rischio residuo: ' + o.residuo.Rlabel + ' — ' + o.residuo.giudizio) : '');

    // box risultato finale
    var box = document.getElementById('vraOutBox');
    if (!box) return;
    var R = o.R;
    if (R.sospeso) {
      box.innerHTML = '<div class="vra-result" style="background:#6c7a72"><h3>Giudizio di rischio</h3><div class="vra-g">Valutazione sospesa</div><div class="vra-t">' + esc(R.motivo) + '</div></div>';
      return;
    }
    var multTxt = R.molt > 1 ? ' <span class="vra-chip">×' + R.molt + ' bersagli multipli</span>' : '';
    var html = '<div class="vra-result" style="background:' + R.colore + '">' +
      '<h3>Livello di rischio (terna B' + R.B + ' · I' + R.I + ' · P' + R.P + ')</h3>' +
      '<div class="vra-r">' + R.Rlabel + '</div>' +
      '<div class="vra-g">' + esc(R.giudizio) + '</div>' +
      '<div class="vra-t"><strong>Trattamento:</strong> ' + esc(R.trattamento) + (R.notaValore ? '<br><br>' + esc(R.notaValore) : '') + '</div>' +
      '</div>' +
      '<div class="vra-chips"><span class="vra-chip" style="border-color:' + R.triage.colore + ';color:' + R.triage.colore + '">Triage ' + R.triage.code + '</span>' +
      '<span class="vra-chip">' + esc(R.triage.priorita) + '</span>' + multTxt + '</div>';
    if (o.residuo && !o.residuo.sospeso) {
      html += '<div class="vra-chips"><span class="vra-chip" style="border-color:' + o.residuo.colore + ';color:' + o.residuo.colore + '">Residuo: ' + o.residuo.Rlabel + ' · ' + o.residuo.triage.code + '</span></div>';
    }
    box.innerHTML = html;
  }

  function pericoloNote(P) {
    if (P.classe == null) return P.nota || '';
    var t = 'Parte più critica → classe ' + P.classe + '.';
    if (P.sospese.length) t += ' Sospese (indagine strumentale): ' + P.sospese.join(', ') + '.';
    if (P.nonValutate.length) t += ' Non valutate: ' + P.nonValutate.join(', ') + ' — per esse il giudizio resta indefinito.';
    return t;
  }
  function bersaglioNote(B) {
    var parts = B.dettaglio.map(function (d) { return d.tipo + ' → B' + d.classe + ' (' + d.raw + ')'; });
    return 'Esposizione peggiore: ' + B.tipo + ' (B' + B.classe + '). ' + parts.join(' · ') + (B.molt > 1 ? ' · ×' + B.molt : '');
  }
  function impulsoNote(I) {
    return 'Massa ≈ ' + Math.round(I.M) + ' kg · Impulso ≈ ' + Math.round(I.P) + ' kgm/s → classe I' + I.classe + '.';
  }
  function valoreNote(V) {
    var eur = V.override != null ? V.override : V.eurTotale;
    return 'Indice ornamentale ' + V.index + ' → valore ' + V.classe.toUpperCase() +
      '. Stima economica ≈ ' + fmtEur(eur) + (V.override != null ? ' (override manuale)' : ' (estetico ' + fmtEur(V.eurEstetico) + ' + ecologico ' + fmtEur(V.eurEcologico) + ', proxy)') + '.';
  }
  function setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. FUNZIONI GLOBALI (chiamate dagli onclick del pannello)
  // ═══════════════════════════════════════════════════════════════════════
  window.vraTogglePanel = function () {
    var panel = document.getElementById('vraPanel');
    if (!panel) return;
    var hidden = panel.classList.contains('hidden');
    if (hidden && !panel.dataset.built) {
      panel.innerHTML = buildPanel();
      panel.dataset.built = '1';
      document.getElementById('vraAccP').classList.add('open');
    }
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  window.vraToggleAcc = function (id) { var e = document.getElementById(id); if (e) e.classList.toggle('open'); };
  window.vraImpTipoChange = function () {
    var branca = valEl('vraImpTipo') === 'branca';
    document.getElementById('vraImpAlbero').classList.toggle('hidden', branca);
    document.getElementById('vraImpBranca').classList.toggle('hidden', !branca);
  };
  window.vraCalcola = function () { runCalc(); render(); };
  // live update (debounced) mentre si compila
  var liveTimer = null;
  window.vraLive = function () { clearTimeout(liveTimer); liveTimer = setTimeout(function () { runCalc(); render(); }, 180); };
  window.vraSalvaCfg = function () {
    CFG.vasvu = numEl('vraCfgVasvu', CFG.vasvu);
    CFG.rho = numEl('vraCfgRho', CFG.rho);
    CFG.mu = numEl('vraCfgMu', CFG.mu);
    CFG.valore.prezzoCO2 = numEl('vraCfgCo2', CFG.valore.prezzoCO2);
    var ok = saveConfig();
    setText('vraCfgNote', ok ? '✓ Parametri salvati su questo dispositivo.' : '⚠️ Salvataggio non riuscito (localStorage non disponibile).');
    window.vraLive();
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 10. HOOK PER GLI EXPORT (usati da report testuale / CSV / DOCX / payload)
  // ═══════════════════════════════════════════════════════════════════════
  function esitoRighe() {
    // ritorna array [chiave, valore leggibile] per CSV/report
    if (!vra.completa || !vra.out) return [];
    var o = vra.out, R = o.R, V = o.V;
    var eur = V.override != null ? V.override : V.eurTotale;
    var rows = [
      ['vra_compilata', 'si'],
      ['vra_pericolo_classe', R.P],
      ['vra_pericolo_radice', o.P.dettaglio.radice],
      ['vra_pericolo_colletto', o.P.dettaglio.colletto],
      ['vra_pericolo_fusto', o.P.dettaglio.fusto],
      ['vra_pericolo_rami', o.P.dettaglio.rami],
      ['vra_bersaglio_classe', R.B],
      ['vra_bersaglio_tipo', o.B ? o.B.tipo : ''],
      ['vra_bersaglio_multiplo_n', o.B ? o.B.molt : 1],
      ['vra_impulso_classe', R.I],
      ['vra_impulso_kgm_s', o.I ? Math.round(o.I.P) : ''],
      ['vra_impulso_tipo', o.I ? o.I.tipo : ''],
      ['vra_rischio_R', R.Rlabel],
      ['vra_rischio_1su', R.D === Infinity ? '>1000000' : R.D],
      ['vra_giudizio', R.giudizio],
      ['vra_triage', R.triage.code],
      ['vra_trattamento', R.trattamento + (R.notaValore ? ' ' + R.notaValore : '')],
      ['vra_valore_indice_ornamentale', V.index],
      ['vra_valore_classe', V.classe],
      ['vra_valore_stima_eur', eur],
      ['vra_valore_set', V.set],
      ['vra_aspettativa_vita', o.asp],
      ['vra_rischio_residuo_R', o.residuo && !o.residuo.sospeso ? o.residuo.Rlabel : ''],
      ['vra_rischio_residuo_giudizio', o.residuo && !o.residuo.sospeso ? o.residuo.giudizio : '']
    ];
    return rows;
  }

  window.vraExtra = {
    // righe [chiave,valore] da appendere al CSV
    csvRows: function () { return esitoRighe(); },
    // righe da appendere al report testuale ("Copia tutto")
    reportLines: function () {
      if (!vra.completa || !vra.out) return [];
      var sep = '─'.repeat(40), o = vra.out, R = o.R, V = o.V;
      var eur = V.override != null ? V.override : V.eurTotale;
      var L = ['', 'VALUTAZIONE DEL RISCHIO ARBOREO (VRA)', sep,
        'Pericolosità (P):   classe ' + R.P + '  [radice=' + o.P.dettaglio.radice + ' colletto=' + o.P.dettaglio.colletto + ' fusto=' + o.P.dettaglio.fusto + ' rami=' + o.P.dettaglio.rami + ']',
        'Bersaglio (B):      classe ' + R.B + ' — ' + (o.B ? o.B.tipo : '—') + (o.B && o.B.molt > 1 ? ' (×' + o.B.molt + ')' : ''),
        'Impulso (I):        classe ' + R.I + ' — ' + (o.I ? Math.round(o.I.P) + ' kgm/s (' + o.I.tipo + ')' : '—'),
        '',
        'LIVELLO DI RISCHIO: ' + R.Rlabel + '   (Triage ' + R.triage.code + ')',
        'Giudizio:           ' + R.giudizio,
        'Trattamento:        ' + R.trattamento];
      if (R.notaValore) L.push('                    ' + R.notaValore);
      L.push('', 'Valore albero:      indice ornamentale ' + V.index + ' → ' + V.classe.toUpperCase() + ' · stima ≈ ' + fmtEur(eur) + (V.override != null ? ' (override)' : ' (proxy)'),
        'Aspettativa vita:   ' + o.asp);
      if (o.residuo && !o.residuo.sospeso) {
        L.push('Rischio residuo:    ' + o.residuo.Rlabel + ' — ' + o.residuo.giudizio);
      }
      L.push('Metodo:             Protocollo Areté® v4.0 – ARBORETE® (protocolloarete.it)');
      return L;
    },
    // elementi docx da inserire (richiede l'oggetto docx globale)
    docxChildren: function (docx) {
      if (!vra.completa || !vra.out || !docx) return [];
      var Paragraph = docx.Paragraph, TextRun = docx.TextRun, HeadingLevel = docx.HeadingLevel,
        Table = docx.Table, TableRow = docx.TableRow, TableCell = docx.TableCell,
        WidthType = docx.WidthType, BorderStyle = docx.BorderStyle, TableLayoutType = docx.TableLayoutType;
      // Larghezze in twip (DXA): A4 utile = 9026. Vedi nota in analisi-albero-logic.js.
      var TW_TOT = 9026, TW_LABEL = 3069, TW_VALUE = 5957;
      var GREEN = '2F6B4F', INK = '15211A', FAINT = '6A7A70';
      var o = vra.out, R = o.R, V = o.V;
      var eur = V.override != null ? V.override : V.eurTotale;
      function kv(l, v) {
        return new TableRow({ children: [
          new TableCell({ width: { size: TW_LABEL, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: l, bold: true, size: 20, color: FAINT })] })] }),
          new TableCell({ width: { size: TW_VALUE, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: (v == null || v === '') ? '—' : String(v), size: 20, color: INK })] })] })
        ] });
      }
      function tab(rows) {
        var b = { style: BorderStyle.SINGLE, size: 4, color: 'DDE5E0' };
        return new Table({ width: { size: TW_TOT, type: WidthType.DXA }, columnWidths: [TW_LABEL, TW_VALUE], layout: TableLayoutType.FIXED, borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b }, rows: rows });
      }
      function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 }, children: [new TextRun({ text: t, bold: true, color: GREEN, size: 24 })] }); }
      var ch = [h2('Valutazione del Rischio Arboreo (Protocollo Areté® v4.0)')];
      ch.push(tab([
        kv('Pericolosità (P)', 'classe ' + R.P + '  (radice ' + o.P.dettaglio.radice + ', colletto ' + o.P.dettaglio.colletto + ', fusto ' + o.P.dettaglio.fusto + ', rami ' + o.P.dettaglio.rami + ')'),
        kv('Bersaglio (B)', 'classe ' + R.B + ' — ' + (o.B ? o.B.tipo : '—') + (o.B && o.B.molt > 1 ? ' (×' + o.B.molt + ')' : '')),
        kv('Impulso (I)', 'classe ' + R.I + ' — ' + (o.I ? Math.round(o.I.P) + ' kgm/s (' + o.I.tipo + ')' : '—')),
        kv('Livello di rischio', R.Rlabel + '  ·  Triage ' + R.triage.code),
        kv('Giudizio', R.giudizio),
        kv('Valore albero', 'indice ' + V.index + ' → ' + V.classe + '  ·  ≈ ' + fmtEur(eur) + (V.override != null ? ' (override)' : ' (stima proxy)')),
        kv('Aspettativa di vita', o.asp),
        kv('Rischio residuo', o.residuo && !o.residuo.sospeso ? (o.residuo.Rlabel + ' — ' + o.residuo.giudizio) : '—')
      ]));
      ch.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: 'Trattamento prescritto', bold: true, color: GREEN, size: 20 })] }));
      ch.push(new Paragraph({ children: [new TextRun({ text: R.trattamento + (R.notaValore ? ' ' + R.notaValore : ''), size: 20, color: INK })] }));
      return ch;
    },
    // campi da fondere nel payload al foglio Google
    payload: function () {
      if (!vra.completa || !vra.out) return {};
      var o = vra.out, R = o.R, V = o.V;
      var eur = V.override != null ? V.override : V.eurTotale;
      return {
        vra_compilata: true,
        vra_pericolo_classe: R.P,
        vra_pericolo_radice: o.P.dettaglio.radice,
        vra_pericolo_colletto: o.P.dettaglio.colletto,
        vra_pericolo_fusto: o.P.dettaglio.fusto,
        vra_pericolo_rami: o.P.dettaglio.rami,
        vra_bersaglio_classe: R.B,
        vra_bersaglio_tipo: o.B ? o.B.tipo : '',
        vra_bersaglio_multiplo_n: o.B ? o.B.molt : 1,
        vra_impulso_classe: R.I,
        vra_impulso_kgm_s: o.I ? Math.round(o.I.P) : '',
        vra_impulso_tipo: o.I ? o.I.tipo : '',
        vra_rischio_R: R.Rlabel,
        vra_rischio_1su: R.D === Infinity ? '>1000000' : R.D,
        vra_giudizio: R.giudizio,
        vra_triage: R.triage.code,
        vra_trattamento: R.trattamento + (R.notaValore ? ' ' + R.notaValore : ''),
        vra_valore_indice_ornamentale: V.index,
        vra_valore_classe: V.classe,
        vra_valore_stima_eur: eur,
        vra_valore_set: V.set,
        vra_aspettativa_vita: o.asp,
        vra_rischio_residuo_R: o.residuo && !o.residuo.sospeso ? o.residuo.Rlabel : '',
        vra_rischio_residuo_giudizio: o.residuo && !o.residuo.sospeso ? o.residuo.giudizio : ''
      };
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // 11. MONKEY-PATCH delle funzioni esistenti (senza toccare i file originali)
  // ═══════════════════════════════════════════════════════════════════════
  function patchAll() {
    // showResults → dopo aver mostrato i risultati, monta il pannello VRA
    if (typeof window.showResults === 'function' && !window.showResults.__vra) {
      var _sr = window.showResults;
      window.showResults = function () { var r = _sr.apply(this, arguments); try { mountVRAPanel(); } catch (e) { console.warn('VRA mount:', e); } return r; };
      window.showResults.__vra = true;
    }
    // buildReportText → appende la sezione VRA se compilata
    if (typeof window.buildReportText === 'function' && !window.buildReportText.__vra) {
      var _bt = window.buildReportText;
      window.buildReportText = function () {
        var t = _bt.apply(this, arguments);
        try { var extra = window.vraExtra.reportLines(); if (extra.length) t += '\n' + extra.join('\n'); } catch (e) {}
        return t;
      };
      window.buildReportText.__vra = true;
    }
    // buildRilievoPayload → fonde i campi VRA nel payload
    if (typeof window.buildRilievoPayload === 'function' && !window.buildRilievoPayload.__vra) {
      var _bp = window.buildRilievoPayload;
      window.buildRilievoPayload = function () {
        var o = _bp.apply(this, arguments);
        try { Object.assign(o, window.vraExtra.payload()); } catch (e) {}
        return o;
      };
      window.buildRilievoPayload.__vra = true;
    }
  }

  // Le patch vanno applicate dopo che gli altri script hanno definito le funzioni.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchAll);
  } else {
    patchAll();
  }
  // ritenta poco dopo, nel caso l'inline script si definisca più tardi
  setTimeout(patchAll, 300);

})();
