const DEFAULT_SOURCE_URLS = [
  "https://axel4ro.github.io/TCLexplorer/",
  "https://axel4ro.github.io/TCLexplorer/weekly_events.json",
  "https://www.thecursedland.com/",
  "https://whitepaper.thecursedland.com/"
];

const TCL_EXPLORER_BASE = "https://axel4ro.github.io/TCLexplorer/";
const TCL_EXPLORER_PATHS = [
  "",
  "analytics.html",
  "CanIrunIt.html",
  "connect_xportal.html",
  "earn.html",
  "flow.html",
  "Game_Requirements.html",
  "Items_Upgrade_Simulator.html",
  "Item_Upgrade_Requirements.html",
  "live-loaded-chart.html",
  "loot.html",
  "NFTs.html",
  "signal.html",
  "TCL_apr_rewards_calculator.html",
  "TCL_trades.html",
  "TCL_transaction_simulator.html",
  "Technicals.html",
  "volume.html",
  "wiki.html",
  "weekly_events.json",
  "leaderboard.json",
  "data/drop.json",
  "data/items_data.json",
  "data/tcl-analytics.json",
  "lang/analytics.bundle.js",
  "lang/apr-rewards.bundle.js",
  "lang/blacksmith.bundle.js",
  "lang/can-i-run-it.bundle.js",
  "lang/claim-flow.bundle.js",
  "lang/common.bundle.js",
  "lang/dashboard.bundle.js",
  "lang/earn.bundle.js",
  "lang/events.bundle.js",
  "lang/exp-table.bundle.js",
  "lang/game-requirements.bundle.js",
  "lang/item-upgrade.bundle.js",
  "lang/loot.bundle.js",
  "lang/nfts.bundle.js",
  "lang/page-common.bundle.js",
  "lang/signal.bundle.js",
  "lang/tcl-trades.bundle.js",
  "lang/technicals.bundle.js",
  "lang/token.bundle.js",
  "lang/transaction-simulator.bundle.js",
  "lang/volume.bundle.js",
  "lang/web3.bundle.js",
  "lang/wiki-ui.bundle.js",
  "lang/wiki.bundle.js"
];

const DEFAULT_MODEL = "llama-3.1-8b-instant";
const MAX_QUESTION_CHARS = 1000;
const MAX_CONTEXT_CHARS = 5000;
const rateLimitBuckets = new Map();
const responseCache = new Map();
const CACHE_VERSION = "v9";
let cachedDropData = null;
let cachedDropDataTs = 0;
const DROP_DATA_CACHE_TTL_MS = 30 * 60 * 1000;
let cachedEventsData = null;
let cachedEventsDataTs = 0;
const EVENTS_DATA_CACHE_TTL_MS = 30 * 60 * 1000;
const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const RESPONSE_CACHE_TTL_MS = 60 * 60 * 1000;
const CF_CACHE_TTL_S = 3 * 60 * 60;
const SUPPORTED_LANGUAGES = {
  en: { name: "English", missing: "I do not know from the currently synced information." },
  ro: { name: "Romanian", missing: "Nu stiu din informatiile sincronizate in acest moment." },
  tr: { name: "Turkish", missing: "Şu anda senkronize edilen bilgilere göre bilmiyorum." },
  de: { name: "German", missing: "Das weiß ich anhand der aktuell synchronisierten Informationen nicht." },
  es: { name: "Spanish", missing: "No lo sé con la información sincronizada actualmente." },
  fr: { name: "French", missing: "Je ne sais pas avec les informations actuellement synchronisées." },
  it: { name: "Italian", missing: "Non lo so dalle informazioni sincronizzate al momento." },
  pl: { name: "Polish", missing: "Nie wiem tego na podstawie aktualnie zsynchronizowanych informacji." },
  pt: { name: "Portuguese", missing: "Não sei com base nas informações sincronizadas atualmente." }
};

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env || {}, ctx);
    } catch (error) {
      console.error("Worker error", error);
      if (shouldExposeError(request, env || {})) {
        return jsonResponse(request, env || {}, 500, {
          ok: false,
          error: error?.message || "Internal worker error"
        });
      }
      return jsonResponse(request, env || {}, 500, {
        ok: false,
        error: "Internal worker error"
      });
    }
  }
};

async function handleRequest(request, env, ctx) {
  if (request.method === "OPTIONS") return handleOptions(request, env);

  const cors = getCorsHeaders(request, env);
  if (!cors.allowed) {
    return jsonResponse(request, env, 403, {
      ok: false,
      error: "Origin is not allowed"
    });
  }

  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (path === "" || path === "/health") {
    return jsonResponse(request, env, 200, {
      ok: true,
      service: "tcl-ai-chat",
      endpoints: ["/chat", "/sync-sites"]
    });
  }

  if (path === "/chat") return handleChat(request, env, ctx);
  if (path === "/sync-sites") return handleSyncSites(request, env, ctx);

  return jsonResponse(request, env, 404, {
    ok: false,
    error: "Not found"
  });
}

function normalizePath(pathname) {
  const path = `/${String(pathname || "").replace(/^\/+/, "")}`;
  return path.replace(/\/+$/, "") === "/" ? "" : path.replace(/\/+$/, "");
}

function buildPublicSources(matches) {
  const byUrl = new Map();

  matches.forEach((match) => {
    const url = publicSourceUrl(match.source_url || "");
    if (!url) return;

    const source = {
      title: publicSourceTitle(match.title || "", url),
      url,
      rank: Number(match.rank || 0)
    };
    const existing = byUrl.get(url);

    if (!existing || source.rank > existing.rank) {
      byUrl.set(url, source);
    }
  });

  return [...byUrl.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5);
}

function publicSourceUrl(value) {
  if (!value) return "";
  if (value.startsWith("player_qa://")) return "";

  try {
    const url = new URL(value);

    if (url.hostname === "whitepaper.thecursedland.com") {
      if (url.pathname.startsWith("/~gitbook/")) return "";
      if (url.pathname.endsWith(".md")) {
        url.pathname = url.pathname === "/the-cursed-land.md"
          ? "/"
          : url.pathname.replace(/\.md$/i, "");
      }
    }

    if (url.hostname === "axel4ro.github.io" && url.pathname === "/TCLexplorer/weekly_events.json") {
      return "https://axel4ro.github.io/TCLexplorer/#events";
    }
    if (url.hostname === "axel4ro.github.io" && url.pathname === "/TCLexplorer/data/drop.json") {
      return "https://axel4ro.github.io/TCLexplorer/loot.html";
    }
    if (url.hostname === "axel4ro.github.io" && url.pathname === "/TCLexplorer/data/items_data.json") {
      return "https://axel4ro.github.io/TCLexplorer/#wiki";
    }
    if (url.hostname === "axel4ro.github.io" && url.pathname === "/TCLexplorer/data/tcl-analytics.json") {
      return "https://axel4ro.github.io/TCLexplorer/analytics.html";
    }
    if (url.hostname === "axel4ro.github.io" && url.pathname === "/TCLexplorer/leaderboard.json") {
      return "https://axel4ro.github.io/TCLexplorer/";
    }
    if (url.hostname === "axel4ro.github.io" && /\/TCLexplorer\/lang\/.+\.bundle\.js$/i.test(url.pathname)) {
      const BUNDLE_PAGES = {
        "events": "#events",
        "wiki": "#wiki",
        "wiki-ui": "#wiki",
        "loot": "loot.html",
        "earn": "earn.html",
        "analytics": "analytics.html",
        "signal": "signal.html",
        "volume": "volume.html",
        "technicals": "Technicals.html",
        "tcl-trades": "TCL_trades.html",
        "transaction-simulator": "TCL_transaction_simulator.html",
        "nfts": "NFTs.html",
        "blacksmith": "Items_Upgrade_Simulator.html",
        "game-requirements": "Game_Requirements.html",
        "item-upgrade": "Item_Upgrade_Requirements.html",
        "can-i-run-it": "CanIrunIt.html",
        "apr-rewards": "TCL_apr_rewards_calculator.html",
        "web3": "connect_xportal.html",
        "token": "TCL_trades.html"
      };
      const name = (url.pathname.match(/\/lang\/([^/]+)\.bundle\.js$/i) || [])[1]?.toLowerCase();
      const page = name && BUNDLE_PAGES[name];
      if (!page) return "";
      return page.startsWith("#")
        ? `https://axel4ro.github.io/TCLexplorer/${page}`
        : `https://axel4ro.github.io/TCLexplorer/${page}`;
    }

    if (/\.(json|png|jpe?g|gif|webp|svg|ico)$/i.test(url.pathname)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function publicSourceTitle(title, url) {
  if (url === "https://whitepaper.thecursedland.com/") {
    return "The Cursed Land | Whitepaper";
  }
  if (url === "https://axel4ro.github.io/TCLexplorer/#events") {
    return "TCLexplorer Events";
  }
  if (url === "https://axel4ro.github.io/TCLexplorer/#wiki") {
    return "TCLexplorer Wiki";
  }

  if (/\.bundle(\.js)?$/i.test(title) && /axel4ro\.github\.io\/TCLexplorer\//i.test(url)) {
    const page = (url.match(/\/TCLexplorer\/([^/#]+\.html?)(?:[#?]|$)/i) || [])[1];
    if (page) {
      const clean = page
        .replace(/\.html?$/i, "")
        .replace(/^TCL_/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      return `${clean} | TCL Explorer`;
    }
    return "TCL Explorer";
  }

  return title || url;
}

function buildActions(question, language, sources = []) {
  const actions = [];
  const add = (title, url, kind = "secondary") => {
    if (actions.some((a) => a.url === url || a.title === title)) return;
    actions.push({ title, url, kind });
  };
  const t = (map) => map[language] || map.en;

  if (isEventsIntent(question)) {
    add(t({ en: "Open Events", ro: "Deschide Evenimente", tr: "Etkinlikleri Aç", de: "Events öffnen", es: "Abrir Eventos", fr: "Ouvrir les événements", it: "Apri Eventi", pl: "Otwórz Wydarzenia", pt: "Abrir Eventos" }), "https://axel4ro.github.io/TCLexplorer/#events", "primary");
  }
  if (/\b(wiki|iteme?|items?\b|obiecte?|blacksmith|upgrade|plusat)\b/i.test(question)) {
    add(t({ en: "Open Wiki", ro: "Deschide Wiki", tr: "Wiki'yi Aç", de: "Wiki öffnen", es: "Abrir Wiki", fr: "Ouvrir Wiki", it: "Apri Wiki", pl: "Otwórz Wiki", pt: "Abrir Wiki" }), "https://axel4ro.github.io/TCLexplorer/#wiki", "primary");
  }
  if (/\b(loot|drop|drops?|clam|moonlight|cufere?|scoici|chest|treasure)\b/i.test(question)) {
    add(t({ en: "Open Loot", ro: "Deschide Loot", tr: "Loot'u Aç", de: "Loot öffnen", es: "Abrir Loot", fr: "Ouvrir Loot", it: "Apri Loot", pl: "Otwórz Loot", pt: "Abrir Loot" }), "https://axel4ro.github.io/TCLexplorer/loot.html", "primary");
    add(t({ en: "Open Events", ro: "Deschide Evenimente", tr: "Etkinlikleri Aç", de: "Events öffnen", es: "Abrir Eventos", fr: "Ouvrir les événements", it: "Apri Eventi", pl: "Otwórz Wydarzenia", pt: "Abrir Eventos" }), "https://axel4ro.github.io/TCLexplorer/#events");
  }
  if (isRequirementsIntent(question)) {
    add(t({ en: "Can I Run It", ro: "Pot Rula Jocul", tr: "Çalıştırabilir miyim", de: "Kann ich es spielen", es: "¿Puedo correrlo?", fr: "Puis-je le lancer", it: "Posso eseguirlo", pl: "Czy uruchomię grę", pt: "Consigo rodar" }), "https://axel4ro.github.io/TCLexplorer/CanIrunIt.html", "primary");
    add(t({ en: "Game Requirements", ro: "Cerințe Sistem", tr: "Oyun Gereksinimleri", de: "Systemanforderungen", es: "Requisitos del juego", fr: "Config. requise", it: "Requisiti di sistema", pl: "Wymagania systemowe", pt: "Requisitos do jogo" }), "https://axel4ro.github.io/TCLexplorer/Game_Requirements.html");
  }
  if (isBuyTokenIntent(question) || isTokenInfoIntent(question)) {
    add("xExchange", "https://xexchange.com/", "primary");
    add("xPortal", "https://xportal.com/");
  }
  if (/\b(nfts?)\b/i.test(question)) {
    add(t({ en: "Open NFTs", ro: "Deschide NFT-uri", tr: "NFT'leri Aç", de: "NFTs öffnen", es: "Abrir NFTs", fr: "Ouvrir NFTs", it: "Apri NFTs", pl: "Otwórz NFTs", pt: "Abrir NFTs" }), "https://axel4ro.github.io/TCLexplorer/NFTs.html", "primary");
  }
  if (/\b(earn|staking|apr\b|reward|recompens|castig|câștig|creator|referral|afiliat|bani|procent|percent|comision|commission|program.creator|creator.program)\b/i.test(question)) {
    add(t({ en: "Open Earn", ro: "Deschide Earn", tr: "Earn'i Aç", de: "Earn öffnen", es: "Abrir Earn", fr: "Ouvrir Earn", it: "Apri Earn", pl: "Otwórz Earn", pt: "Abrir Earn" }), "https://axel4ro.github.io/TCLexplorer/earn.html", "primary");
  }
  if (/\b(xportal|portofel|wallet|connect|conectare|web3)\b/i.test(question) && !isBuyTokenIntent(question)) {
    add(t({ en: "Connect xPortal", ro: "Conectează xPortal", tr: "xPortal Bağla", de: "xPortal verbinden", es: "Conectar xPortal", fr: "Connecter xPortal", it: "Connetti xPortal", pl: "Połącz xPortal", pt: "Conectar xPortal" }), "https://axel4ro.github.io/TCLexplorer/connect_xportal.html");
  }
  if (/\b(analytics|statistic|statistici)\b/i.test(question)) {
    add(t({ en: "Open Analytics", ro: "Deschide Analytics", tr: "Analitikleri Aç", de: "Analytics öffnen", es: "Abrir Analytics", fr: "Ouvrir Analytics", it: "Apri Analytics", pl: "Otwórz Analytics", pt: "Abrir Analytics" }), "https://axel4ro.github.io/TCLexplorer/analytics.html");
  }
  if (/\b(technicals?|technical.analysis|analiz[aă].tehnic)\b/i.test(question)) {
    add(t({ en: "Open Technicals", ro: "Analiză Tehnică", tr: "Teknik Analiz", de: "Technicals öffnen", es: "Análisis técnico", fr: "Analyse technique", it: "Analisi tecnica", pl: "Analiza techniczna", pt: "Análise técnica" }), "https://axel4ro.github.io/TCLexplorer/Technicals.html");
  }
  if (/\b(trade[sd]?|tranzact|volum\b|volume\b)\b/i.test(question) && !isBuyTokenIntent(question)) {
    add(t({ en: "TCL Trades", ro: "Tranzacții TCL", tr: "TCL İşlemleri", de: "TCL Trades", es: "Trades TCL", fr: "Trades TCL", it: "Trade TCL", pl: "Transakcje TCL", pt: "Trades TCL" }), "https://axel4ro.github.io/TCLexplorer/TCL_trades.html");
  }

  return actions.slice(0, 4);
}

function guidedPageResponse(question, language, actions) {
  if (!isBroadEventsIntent(question)) return "";
  if (!actions.some((action) => action.url === "https://axel4ro.github.io/TCLexplorer/#events")) return "";

  const responses = {
    en: "For events, the clearest view is the live TCLexplorer Events page. It shows the full schedule, your local times, and the current event status.",
    ro: "Pentru evenimente, cel mai clar este sa deschizi pagina live din TCLexplorer. Acolo vezi programul complet, orele in fusul tau local si statusul evenimentelor in timp real.",
    tr: "Etkinlikler için en net yer TCLexplorer'daki canlı Events sayfasıdır. Tam programı, yerel saatlerini ve etkinlik durumunu orada görebilirsin.",
    de: "Für Events ist die Live-Events-Seite in TCLexplorer am klarsten. Dort siehst du den kompletten Zeitplan, deine lokale Zeit und den aktuellen Status.",
    es: "Para los eventos, la vista más clara es la página live de Events en TCLexplorer. Allí ves el calendario completo, tus horarios locales y el estado actual.",
    fr: "Pour les événements, la vue la plus claire est la page Events live de TCLexplorer. Elle affiche le planning complet, tes heures locales et le statut actuel.",
    it: "Per gli eventi, la vista più chiara è la pagina live Events di TCLexplorer. Lì vedi il programma completo, gli orari locali e lo stato attuale.",
    pl: "Dla wydarzeń najczytelniejsza jest strona live Events w TCLexplorer. Pokazuje pełny harmonogram, lokalny czas i aktualny status.",
    pt: "Para eventos, a visualização mais clara é a página live Events no TCLexplorer. Lá você vê o calendário completo, horários locais e status atual."
  };

  return responses[language] || responses.en;
}

function isEventsIntent(question) {
  return /\b(events?|event|weekly|schedule|calendar|eveniment\w*|saptamanal|săptămânal)\b/i.test(question) ||
    /\b(program(ul)?)\b/i.test(question) && !/\b(creator|referral|afiliat|earn|staking|reward)\b/i.test(question);
}

function isBroadEventsIntent(question) {
  const text = String(question || "").trim().toLowerCase();
  if (!isEventsIntent(text)) return false;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|luni|marti|marți|miercuri|joi|vineri|sambata|sâmbătă|duminica|duminică|today|azi|acum|now|next|urmator|următor|forge|experience|clam|moonlight|crystal|drop)\b/i.test(text)) {
    return false;
  }
  return text.split(/\s+/).length <= 8 || /\b(what events|events list|ce evenimente|lista.*evenimente)\b/i.test(text);
}

function isRequirementsIntent(question) {
  return /\b(game.?req|system.?req|can.?i.?run|pot.?rula|hardware|pc.?spec|minimum.?req|cerinte.?joc|cerinte.?sistem|configuratie|configurație|specificat|specs?)\b/i.test(question)
    || /\b(requirements?|cerinte|cerință|cerințe)\b/i.test(question) && !/\b(item|upgrade|wiki|plus)\b/i.test(question);
}

function isBuyTokenIntent(question) {
  const q = String(question || "").toLowerCase();
  return /\b(buy|cumpara|cumpăr|purchase|achizit|unde cumpar|how to get|how to buy|get tcl|exchange|swap|schimb|sell|vinde)\b/i.test(q)
    && /\b(tcl|token)\b/i.test(q);
}

function isTokenInfoIntent(question) {
  const q = String(question || "").toLowerCase();
  return /\b(ce.?este.?tcl|what.?is.?tcl|about.?tcl|despre.?tcl|tcl.?token|token.?tcl|tcl.?coin|crypto.?tcl|tcl.?price|pret.?tcl|preț.?tcl)\b/i.test(q);
}

function guidedTokenResponse(question, language) {
  if (!isBuyTokenIntent(question)) return "";
  const msgs = {
    en: "TCL can be bought on xExchange (MultiversX) using EGLD or USDC — xExchange is the recommended option. In the xPortal app, tap the globe icon at the bottom right to open xExchange and swap for TCL.",
    ro: "TCL se poate cumpăra pe xExchange (MultiversX) cu EGLD sau USDC — xExchange este varianta recomandată. În aplicația xPortal, apasă iconița glob din dreapta jos pentru a deschide xExchange și face swap pe TCL.",
    tr: "TCL, xExchange (MultiversX) üzerinden EGLD veya USDC ile satın alınabilir — xExchange önerilen seçenektir. xPortal uygulamasında sağ alttaki küre ikonuna tıklayarak xExchange'i açıp TCL için swap yapabilirsiniz.",
    de: "TCL kann auf xExchange (MultiversX) mit EGLD oder USDC gekauft werden — xExchange ist die empfohlene Option. In der xPortal-App kannst du das Globus-Symbol rechts unten antippen, um xExchange zu öffnen und TCL zu swappen.",
    es: "TCL se puede comprar en xExchange (MultiversX) usando EGLD o USDC — xExchange es la opción recomendada. En la app xPortal, toca el ícono del globo abajo a la derecha para abrir xExchange y hacer swap por TCL.",
    fr: "TCL peut être acheté sur xExchange (MultiversX) avec EGLD ou USDC — xExchange est l'option recommandée. Dans l'app xPortal, appuie sur l'icône globe en bas à droite pour ouvrir xExchange et faire un swap pour TCL.",
    it: "TCL può essere acquistato su xExchange (MultiversX) usando EGLD o USDC — xExchange è l'opzione consigliata. Nell'app xPortal, tocca l'icona del globo in basso a destra per aprire xExchange e fare swap per TCL.",
    pl: "TCL można kupić na xExchange (MultiversX) za EGLD lub USDC — xExchange jest rekomendowaną opcją. W aplikacji xPortal dotknij ikony globusa w prawym dolnym rogu, aby otworzyć xExchange i wymienić na TCL.",
    pt: "TCL pode ser comprado no xExchange (MultiversX) usando EGLD ou USDC — xExchange é a opção recomendada. No app xPortal, toque no ícone de globo no canto inferior direito para abrir o xExchange e trocar por TCL."
  };
  return msgs[language] || msgs.en;
}

function resolveQuestionWithHistory(question, history) {
  if (!history.length) return question;
  const words = question.trim().split(/\s+/).length;
  const hasContextPronoun = /\b(el|ea|it|acesta|aceasta|asta|ăsta|ala|ăla|acela|aceea|dânsul|dânsa|lui|ei|this|that|they|them|its)\b/i.test(question);
  const isVeryShort = words <= 4;
  if (!hasContextPronoun && !isVeryShort) return question;
  const lastUser = [...history].reverse().find((h) => h.role === "user");
  if (lastUser) return `${lastUser.content} ${question}`.trim();
  return question;
}

function isLootContentsIntent(question) {
  const q = String(question || "").toLowerCase();
  return (
    /\b(contine|contains|inside|ce.*in|what.*in|what.*inside|drops?|drop)\b/i.test(q) &&
    /\b(chest|clam|moonlight|cufar|comori|treasure|box|crystal|gold.*chest|christmas|spider|flower)\b/i.test(q)
  );
}

function detectChestFromQuestion(question) {
  const q = String(question || "").toLowerCase();
  if (/spider/i.test(q)) return 1775;
  if (/gold.*\+|gold.*plus|gold.*chest.*\+/i.test(q)) return 1773;
  if (/christmas/i.test(q)) return 1509;
  if (/flower/i.test(q)) return 1212;
  if (/crystal/i.test(q)) return 1213;
  if (/clam/i.test(q)) return 1517;
  if (/gold.*(chest|cufar|comori)/i.test(q) || /(chest|cufar|comori).*gold/i.test(q)) return 1422;
  if (/moonlight/i.test(q)) return 1211;
  return null;
}

async function fetchDropData() {
  const now = Date.now();
  if (cachedDropData && now - cachedDropDataTs < DROP_DATA_CACHE_TTL_MS) return cachedDropData;
  try {
    const resp = await fetch("https://axel4ro.github.io/TCLexplorer/data/drop.json",
      { cf: { cacheTtl: 1800, cacheEverything: true } });
    if (!resp.ok) return null;
    cachedDropData = await resp.json();
    cachedDropDataTs = now;
    return cachedDropData;
  } catch {
    return null;
  }
}

async function fetchEventsData() {
  const now = Date.now();
  if (cachedEventsData && now - cachedEventsDataTs < EVENTS_DATA_CACHE_TTL_MS) return cachedEventsData;
  try {
    const resp = await fetch("https://axel4ro.github.io/TCLexplorer/weekly_events.json",
      { cf: { cacheTtl: 1800, cacheEverything: true } });
    if (!resp.ok) return null;
    cachedEventsData = await resp.json();
    cachedEventsDataTs = now;
    return cachedEventsData;
  } catch {
    return null;
  }
}

function buildEventStatusContext(eventsData, clientTimeIso, utcOffsetMinutes) {
  if (!eventsData || !clientTimeIso) return "";
  try {
    const now = new Date(clientTimeIso);
    const offset = Number(utcOffsetMinutes) || 0;
    const localMs = now.getTime() + offset * 60000;
    const localNow = new Date(localMs);

    // Events use UTC times; day index: 0=Monday..6=Sunday (matching event-notifications.js)
    const todayIndex = (now.getUTCDay() + 6) % 7;
    const todayKey = WEEK_DAYS[todayIndex];

    const absOff = Math.abs(offset);
    const sign = offset >= 0 ? "+" : "-";
    const offsetStr = `UTC${sign}${Math.floor(absOff / 60)}${absOff % 60 ? ":" + String(absOff % 60).padStart(2, "0") : ""}`;
    const localTimeStr = `${WEEK_DAYS[todayIndex]} ${String(localNow.getUTCHours()).padStart(2, "0")}:${String(localNow.getUTCMinutes()).padStart(2, "0")} ${offsetStr}`;

    const lines = [`Player current local time: ${localTimeStr}`];
    const allLines = [];

    // Process all days to find today's events and next occurrences
    for (let d = 0; d < 7; d++) {
      const dayIdx = (todayIndex + d) % 7;
      const dayKey = WEEK_DAYS[dayIdx];
      const dayEvents = eventsData[dayKey] || [];
      for (const ev of dayEvents) {
        const [sH, sM] = ev.start.split(":").map(Number);
        const [eH, eM] = ev.end.split(":").map(Number);
        const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, sH, sM));
        const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, eH, eM));
        const localStart = new Date(startUtc.getTime() + offset * 60000);
        const localEnd = new Date(endUtc.getTime() + offset * 60000);
        const lsStr = `${String(localStart.getUTCHours()).padStart(2, "0")}:${String(localStart.getUTCMinutes()).padStart(2, "0")}`;
        const leStr = `${String(localEnd.getUTCHours()).padStart(2, "0")}:${String(localEnd.getUTCMinutes()).padStart(2, "0")}`;

        let status;
        if (now < startUtc) {
          const mins = Math.round((startUtc - now) / 60000);
          const h = Math.floor(mins / 60), m = mins % 60;
          status = d === 0
            ? `upcoming today in ${h > 0 ? h + "h " : ""}${m > 0 ? m + "m" : ""}`.trim()
            : `next on ${dayKey} in ${d} day${d > 1 ? "s" : ""}`;
        } else if (now >= startUtc && now < endUtc) {
          const mLeft = Math.round((endUtc - now) / 60000);
          status = `ACTIVE NOW — ends in ${mLeft} min`;
        } else if (d === 0) {
          continue; // already ended today, skip — will appear as "next" from d>0 iteration
        } else {
          continue;
        }

        allLines.push(`${ev.name}: ${d === 0 ? "today" : dayKey} local ${lsStr}-${leStr} [${status}]`);
      }
    }

    if (allLines.length) lines.push("Event schedule:", ...allLines);
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function guidedLootContentsResponse(question, language) {
  if (!isLootContentsIntent(question)) return "";
  const itemId = detectChestFromQuestion(question);
  if (!itemId) return "";

  const data = await fetchDropData();
  if (!data) return "";

  const itemMap = {};
  (data.itemTemplates || []).forEach((i) => { itemMap[i.id] = i.name; });
  const ltMap = {};
  (data.lootTables || []).forEach((lt) => { ltMap[lt.id] = lt; });

  const chestName = itemMap[itemId];
  const ltId = DROP_JSON_MANUAL_LOOT[itemId];
  const lt = ltMap[ltId];
  if (!chestName || !lt) return "";

  const sorted = [...(lt.items || [])].sort((a, b) => a.chance - b.chance);
  let prev = 0;
  const contents = sorted.map((it) => {
    const rate = Math.round((it.chance - prev) * 100) / 100;
    prev = it.chance;
    const name = itemMap[it.item] || `item#${it.item}`;
    return `${name} (${rate}%)`;
  }).filter(Boolean);

  const intro = {
    en: `${chestName} can contain:`,
    ro: `${chestName} poate conține:`,
    tr: `${chestName} şunları içerebilir:`,
    de: `${chestName} kann enthalten:`,
    es: `${chestName} puede contener:`,
    fr: `${chestName} peut contenir :`,
    it: `${chestName} può contenere:`,
    pl: `${chestName} może zawierać:`,
    pt: `${chestName} pode conter:`
  };

  return `${intro[language] || intro.en} ${contents.join(", ")}.`;
}

function handleOptions(request, env) {
  const cors = getCorsHeaders(request, env);
  return new Response(null, {
    status: cors.allowed ? 204 : 403,
    headers: cors.headers
  });
}

async function handleChat(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  assertRequiredEnv(env, [
    "GROQ_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ALLOWED_ORIGIN"
  ]);

  const rate = checkRateLimit(request, env);
  if (!rate.ok) {
    return jsonResponse(request, env, 429, {
      ok: false,
      error: "Rate limit exceeded. Please wait before asking again.",
      retryAfterSeconds: rate.retryAfterSeconds
    }, {
      "Retry-After": String(rate.retryAfterSeconds)
    });
  }

  const body = await readJson(request);
  const question = String(body.message || body.question || "").trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) {
    return jsonResponse(request, env, 400, {
      ok: false,
      error: "Missing message"
    });
  }

  // Parse player time info for event-aware answers
  const clientTimeIso = typeof body.clientTime === "string" ? body.clientTime : "";
  const utcOffsetMinutes = Number(body.utcOffsetMinutes) || 0;

  // Parse and sanitize conversation history (last 6 messages from frontend)
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history = rawHistory
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.length > 0)
    .slice(-6)
    .map((h) => ({ role: h.role, content: String(h.content).slice(0, 600) }));

  // Resolve pronouns/short follow-up questions using conversation context
  const resolvedQuestion = resolveQuestionWithHistory(question, history);
  const usedContext = resolvedQuestion !== question;

  const language = normalizeLanguage(body.language || detectLanguage(question));

  // Cache key: use resolvedQuestion so answers benefit future players who ask directly
  // But skip cache entirely if response depends on context (too specific to this conversation)
  const cacheKey = `${CACHE_VERSION}:${language}:${normalizeQuestionForCache(usedContext ? resolvedQuestion : question)}`;
  if (!usedContext) {
    const memCached = getCachedAnswer(cacheKey);
    if (memCached) return jsonResponse(request, env, 200, memCached);

    const cacheHash = await sha256Hex(cacheKey);
    const cfCached = await getCfCachedAnswer(cacheHash);
    if (cfCached) {
      setCachedAnswer(cacheKey, cfCached);
      return jsonResponse(request, env, 200, cfCached);
    }
  }

  const matches = await searchKnowledge(env, resolvedQuestion);
  const sources = buildPublicSources(matches);
  const actions = buildActions(resolvedQuestion, language, sources);

  // When the question is a follow-up (used context), skip rigid guided page/token responses
  // and let the LLM answer naturally using history. Only loot contents remains (fact-based).
  const guided = (usedContext ? "" : guidedPageResponse(resolvedQuestion, language, actions)) ||
    (usedContext ? "" : guidedTokenResponse(resolvedQuestion, language)) ||
    await guidedLootContentsResponse(resolvedQuestion, language);
  if (guided) {
    const payload = { ok: true, answer: guided, sources, actions, language };
    if (!usedContext) setCachedAnswer(cacheKey, payload);
    ctx.waitUntil(logChat(env, request, { question: resolvedQuestion, answer: guided, language, matched_sources: sources }));
    return jsonResponse(request, env, 200, payload);
  }

  if (!matches.length) {
    const answer = missingKnowledgeAnswer(language);
    const payload = { ok: true, answer, sources: [], actions, language };
    ctx.waitUntil(logChat(env, request, { question: resolvedQuestion, answer, language, matched_sources: sources }));
    return jsonResponse(request, env, 200, payload);
  }

  // Build live event context if question is event/time-sensitive
  const needsEventContext = clientTimeIso && (
    isEventsIntent(resolvedQuestion) ||
    /\b(moonlight|clam|crystal|treasure|cufar|forge|experience|fishing|crystals.frenzy|cand|când|azi|astazi|azi|acum|now|today|active|activ|urmeaza|urmează|next)\b/i.test(resolvedQuestion)
  );
  const eventContext = needsEventContext
    ? await fetchEventsData().then((data) => buildEventStatusContext(data, clientTimeIso, utcOffsetMinutes))
    : "";
  // Never cache time-sensitive event responses
  const usesEventContext = eventContext.length > 0;

  let answer;
  try {
    answer = await generateAnswer(env, resolvedQuestion, matches, language, history, eventContext);
  } catch (e) {
    if (e?.code === "GEMINI_QUOTA") {
      return jsonResponse(request, env, 200, {
        ok: true,
        answer: serviceUnavailableAnswer(language),
        sources,
        actions,
        language
      });
    }
    throw e;
  }

  const payload = { ok: true, answer, sources, actions, language };
  const isMissingAnswer = answer === missingKnowledgeAnswer(language);
  if (!isMissingAnswer && !usedContext && !usesEventContext) {
    // Only cache non-context-dependent, non-time-sensitive answers (reusable by other players)
    const cacheHash = await sha256Hex(cacheKey);
    setCachedAnswer(cacheKey, payload);
    ctx.waitUntil(Promise.all([
      putCfCachedAnswer(cacheHash, payload),
      logChat(env, request, { question: resolvedQuestion, answer, language, matched_sources: sources }),
      storePlayerQA(env, resolvedQuestion, answer)
    ]));
  } else {
    ctx.waitUntil(logChat(env, request, { question: resolvedQuestion, answer, language, matched_sources: sources }));
  }
  return jsonResponse(request, env, 200, payload);
}

async function handleSyncSites(request, env, ctx) {
  if (request.method !== "POST") {
    return jsonResponse(request, env, 405, { ok: false, error: "Method not allowed" });
  }

  assertRequiredEnv(env, [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SYNC_SECRET"
  ]);

  if (!isAuthorizedSyncRequest(request, env)) {
    return jsonResponse(request, env, 401, {
      ok: false,
      error: "Missing or invalid sync secret"
    });
  }

  const url = new URL(request.url);
  const body = await readJson(request).catch(() => ({}));
  const sourceUrls = resolveSourceUrls(env, body.urls);
  if (!sourceUrls.length) {
    return jsonResponse(request, env, 400, {
      ok: false,
      error: "No valid source URLs configured"
    });
  }

  const maxPagesPerSite = clampInt(env.SYNC_MAX_PAGES_PER_SITE, 1, 16, 8);
  const maxTotalPages = clampInt(env.SYNC_MAX_TOTAL_PAGES, 1, 36, 18);
  const maxChunks = clampInt(env.SYNC_MAX_CHUNKS, 1, 500, 300);
  const chunkSize = clampInt(env.SYNC_CHUNK_SIZE, 600, 2200, 1400);
  const chunkOverlap = clampInt(env.SYNC_CHUNK_OVERLAP, 80, 500, 220);
  const batchSize = clampInt(body.batchSize || url.searchParams.get("batchSize") || env.SYNC_BATCH_SIZE, 1, 18, 12);
  const cursor = clampInt(body.cursor || url.searchParams.get("cursor"), 0, sourceUrls.length, 0);
  const batchUrls = sourceUrls.slice(cursor, cursor + batchSize);
  const nextCursor = cursor + batchUrls.length < sourceUrls.length ? cursor + batchUrls.length : null;
  const sourcePrefixes = sourceUrls.map(sourcePrefixForUrl);

  const shouldReset = cursor === 0 && body.reset !== false && url.searchParams.get("reset") !== "false";
  const deactivated = shouldReset
    ? await supabaseRpc(env, "ai_deactivate_knowledge_sources", {
      source_prefixes: sourcePrefixes
    })
    : 0;

  const pages = [];
  const skipped = [];
  for (const sourceUrl of batchUrls) {
    const remainingPageBudget = maxTotalPages - pages.length;
    if (remainingPageBudget <= 0) {
      skipped.push({ url: sourceUrl, reason: "sync page budget reached" });
      continue;
    }

    const crawl = await crawlSite(sourceUrl, {
      maxPages: Math.min(maxPagesPerSite, remainingPageBudget),
      followLinks: shouldFollowLinks(sourceUrl)
    });
    pages.push(...crawl.pages);
    skipped.push(...crawl.skipped);
  }

  const records = [];
  for (const page of pages) {
    const chunks = chunkText(page.text, chunkSize, chunkOverlap);
    for (const chunk of chunks) {
      if (records.length >= maxChunks) break;
      const safeChunk = sanitizeForStorage(chunk);
      if (!safeChunk) continue;
      records.push({
        source_url: page.url,
        title: sanitizeForStorage(page.title || ""),
        chunk: safeChunk,
        content_hash: await sha256Hex(`${page.url}\n${safeChunk}`),
        active: true
      });
    }
    if (records.length >= maxChunks) break;
  }

  const uniqueRecords = dedupeKnowledgeRecords(records);
  await upsertKnowledgeChunks(env, uniqueRecords);

  return jsonResponse(request, env, 200, {
    ok: true,
    sourceUrls: batchUrls,
    totalSources: sourceUrls.length,
    cursor,
    nextCursor,
    done: nextCursor === null,
    reset: shouldReset,
    pagesFetched: pages.length,
    chunksUpserted: uniqueRecords.length,
    duplicateChunksSkipped: records.length - uniqueRecords.length,
    deactivatedChunks: Number(deactivated || 0),
    skipped: skipped.slice(0, 25)
  });
}

async function searchKnowledge(env, question) {
  const matchCount = clampInt(env.RAG_MATCH_COUNT, 1, 12, 5);
  const queryText = expandKnowledgeQuery(question);
  const rows = await supabaseRpc(env, "ai_match_knowledge_chunks", {
    query_text: queryText,
    match_count: Math.min(14, matchCount * 2)
  });

  return Array.isArray(rows)
    ? rerankKnowledge(question, rows.filter((row) => row && row.chunk), matchCount)
    : [];
}

function expandKnowledgeQuery(question) {
  const text = String(question || "").trim();
  const normalized = text.toLowerCase();
  const asksIdentity = /\b(what\s+is|what's|tell\s+me\s+about|ce\s+este|ce-i|despre)\b/i.test(normalized);
  const mentionsTcl = /the\s+cursed\s+land|\btcl\b/i.test(normalized);

  if (asksIdentity && mentionsTcl) {
    return `${text} overview MMORPG game Web2 Web3 AI cross-platform whitepaper`;
  }

  if (isEventsIntent(text)) {
    return `${text} weekly events evenimente saptamanale events_title events_desc events_local_time Item Drop Experience Fishing Clam Moonlight Treasure Forge Boost Crystals Frenzy`;
  }

  if (/\b(contine|contains|inside|ce.*in|what.*in|what.*inside)\b/i.test(normalized) &&
      /\b(chest|clam|moonlight|cufar|comori|treasure|box|crystal)\b/i.test(normalized)) {
    return `${text} contains drop loot items reward`;
  }

  if (/\b(moonlight|clam|treasure.?chest|cufar.?lunar|cufar.?comori|chest.?content|what.*chest|what.*drop)\b/i.test(text)) {
    return `${text} loot drop chest contents reward items moonlight clam treasure`;
  }

  if (isBuyTokenIntent(text) || isTokenInfoIntent(text)) {
    return `${text} TCL token MultiversX xExchange xPortal EGLD USDC buy purchase`;
  }

  if (isRequirementsIntent(text)) {
    return `${text} system requirements minimum PC hardware specs can i run game requirements`;
  }

  if (/\b(earn|staking|apr\b|reward|recompens|castig|câștig|creator|referral|afiliat|bani|procent|percent|comision|commission)\b/i.test(text)) {
    return `${text} earn staking APR rewards creator program referral affiliate commission percent TCL`;
  }

  return text;
}

function rerankKnowledge(question, rows, limit) {
  const queryTokens = tokenizeForSearch(question);
  const legalIntent = /\b(privacy|terms|conditions|eula|legal|policy|gdpr|data|delete|account)\b/i.test(question);
  const perUrlCount = new Map();

  return rows
    .filter((row) => {
      if (legalIntent) return true;
      return !/\b(eula|privacy|terms|conditions|policy)\b/i.test(`${row.title || ""} ${row.source_url || ""}`);
    })
    .map((row) => {
      const title = row.title || "";
      const url = row.source_url || "";
      const haystack = `${title} ${row.chunk || ""}`;
      const haystackTokens = new Set(tokenizeForSearch(haystack));
      const titleTokens = new Set(tokenizeForSearch(title));
      let overlap = 0;
      let titleOverlap = 0;

      queryTokens.forEach((token) => {
        if (haystackTokens.has(token)) overlap += 1;
        if (titleTokens.has(token)) titleOverlap += 1;
      });

      let score = Number(row.rank || 0) + overlap * 0.12 + titleOverlap * 0.18;
      if (/whitepaper\.thecursedland\.com/i.test(url)) score += 0.08;
      if (/axel4ro\.github\.io\/TCLexplorer/i.test(url)) score += 0.04;
      if (isEventsIntent(question) && /weekly_events\.json|events\.bundle\.js/i.test(url)) score += 0.75;
      if (/\b(contine|contains|inside|ce.*in|what.*in|what.*inside)\b/i.test(question) &&
          /\b(chest|clam|moonlight|cufar|comori|treasure|box|crystal)\b/i.test(question) &&
          /\/data\/drop\.json/i.test(url)) score += 0.80;
      if (!legalIntent && /\b(eula|privacy|terms|conditions|policy)\b/i.test(`${title} ${url}`)) score -= 0.45;
      if (/^player_qa:\/\//i.test(url)) score -= 0.20;

      return { ...row, rank: Number(score.toFixed(6)) };
    })
    .sort((a, b) => b.rank - a.rank)
    .filter((row) => {
      const key = row.source_url || row.id;
      const current = perUrlCount.get(key) || 0;
      if (current >= 2) return false;
      perUrlCount.set(key, current + 1);
      return true;
    })
    .slice(0, limit);
}

function tokenizeForSearch(value) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "are", "you", "what", "when",
    "where", "which", "how", "why", "does", "can", "is", "a", "an", "of", "to", "in",
    "cum", "care", "unde", "cand", "când", "cat", "cât", "cati", "câti", "cate",
    "câte", "este", "sunt", "pentru", "despre", "din", "sau", "mai", "pot"
  ]);

  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9ăâîșşțţ]+/i)
    .filter((token) => token.length >= 3 && !stop.has(token));
}

async function generateAnswer(env, question, matches, language, history = [], eventContext = "") {
  const model = String(env.GROQ_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const context = buildContext(matches);
  const systemText = `You are Companion, a friendly AI assistant for The Cursed Land players on TCLexplorer. Be natural and conversational — for yes/no questions start with "Da" or "Nu" (or "Yes"/"No" in English), then give the answer. Use conversation history to understand follow-up questions and refer back to what was discussed. Answer ONLY from the RAG context provided. If context lacks the answer, say you don't know in a natural way. Never invent stats, rates, dates, or mechanics. Reply in ${languageName(language)}. Plain text only, no markdown, no raw URLs. Keep answers concise. When live event status is provided, use it to tell the player if the event is active, upcoming, or when the next occurrence is — always in their local time.`;

  const parts = [`Player language: ${language}`];
  if (eventContext) {
    parts.push("", "Live event status (use this for time-aware answers):", eventContext);
  }
  parts.push("", "RAG context:", context, "", "Player question:", question);
  const prompt = parts.join("\n");

  // Include last 4 history messages for natural conversation context
  const historyMessages = history.slice(-4).map((h) => ({
    role: h.role,
    content: h.content
  }));

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemText },
        ...historyMessages,
        { role: "user", content: prompt }
      ],
      temperature: 0.25,
      max_tokens: 260
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    if (response.status === 429) {
      const err = new Error("Groq quota exceeded");
      err.code = "GEMINI_QUOTA";
      throw err;
    }
    throw new Error(`Groq API HTTP ${response.status}: ${details.slice(0, 300)}`);
  }

  const payload = await response.json();
  const text = (payload.choices || [])
    .map((choice) => choice?.message?.content || "")
    .join("\n")
    .trim();

  return cleanGeneratedAnswer(text, language);
}

function cleanGeneratedAnswer(answer, language) {
  const text = String(answer || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return missingKnowledgeAnswer(language);

  const incompleteTail = /\b(and|or|but|with|from|for|to|of|by|in|is|are|the|a|an|si|sau|cu|din|pentru|este|sunt|un|o)$/i;
  const lastPunctuation = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  const tail = lastPunctuation >= 0 ? text.slice(lastPunctuation + 1).trim() : text;

  if (lastPunctuation > 30 && (tail.length <= 36 || incompleteTail.test(text))) {
    return text.slice(0, lastPunctuation + 1).trim();
  }

  if (!/[.!?]$/.test(text)) return `${text}.`;
  return text;
}

function buildContext(matches) {
  let used = 0;
  const blocks = [];

  for (const [index, match] of matches.entries()) {
    const block = [
      `[${index + 1}] ${match.title || "Untitled"}`,
      `URL: ${publicSourceUrl(match.source_url || "") || match.source_url || ""}`,
      String(match.chunk || "").trim()
    ].join("\n");

    if (used + block.length > MAX_CONTEXT_CHARS) break;
    used += block.length;
    blocks.push(block);
  }

  return blocks.join("\n\n---\n\n");
}

async function logChat(env, request, row) {
  try {
    const ip = getClientIp(request);
    const ipHash = await sha256Hex(`${env.IP_HASH_SALT || ""}:${ip}`);
    await supabaseInsert(env, "ai_chat_logs", {
      ip_hash: ipHash,
      question: row.question.slice(0, MAX_QUESTION_CHARS),
      answer: row.answer.slice(0, 8000),
      matched_sources: row.matched_sources,
      language: row.language
    });
  } catch (error) {
    console.warn("Chat log failed", error?.message || error);
  }
}

async function storePlayerQA(env, question, answer) {
  try {
    const qa = sanitizeForStorage(`Q: ${question}\nA: ${answer}`);
    if (!qa) return;
    const hash = await sha256Hex(`playerqa:${normalizeQuestionForCache(question)}`);
    await upsertKnowledgeChunks(env, [{
      source_url: "player_qa://chat",
      title: "Player Q&A",
      chunk: qa,
      content_hash: hash,
      active: true
    }]);
  } catch (error) {
    console.warn("storePlayerQA failed", error?.message || error);
  }
}

async function crawlSite(sourceUrl, options = {}) {
  const maxPages = options.maxPages || 24;
  const followLinks = options.followLinks !== false;
  const seed = new URL(sourceUrl);
  const queue = [normalizeCrawlUrl(seed.href)];
  const seen = new Set();
  const pages = [];
  const skipped = [];

  while (queue.length && pages.length < maxPages) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    let response;
    try {
      response = await fetch(current, {
        headers: {
          "Accept": "text/html,application/json,text/plain;q=0.8,*/*;q=0.2",
          "User-Agent": "TCLexplorer RAG sync bot"
        }
      });
    } catch (error) {
      skipped.push({ url: current, reason: error?.message || "fetch failed" });
      continue;
    }

    if (!response.ok) {
      skipped.push({ url: current, reason: `HTTP ${response.status}` });
      continue;
    }

    const contentType = response.headers.get("Content-Type") || "";
    const raw = await response.text();
    const title = extractTitle(raw, current);
    const isJson = contentType.includes("application/json") || /\.json($|\?)/i.test(current);
    const isHtml = contentType.includes("text/html") || /\.html?($|\?)/i.test(current) || current.endsWith("/");
    const isPlain = contentType.includes("text/plain") || /\.txt($|\?)/i.test(current) || /\.md($|\?)/i.test(current);
    const isScript = contentType.includes("javascript") || /\.m?js($|\?)/i.test(current);

    if (isHtml) {
      if (followLinks) {
        const links = extractLinks(raw, current, seed);
        for (const link of links) {
          if (!seen.has(link) && !queue.includes(link) && pages.length + queue.length < maxPages * 2) {
            queue.push(link);
          }
        }
      }
      const text = htmlToText(raw);
      if (text.length >= 80) pages.push({ url: current, title, text });
      continue;
    }

    if (isJson) {
      const text = /\/data\/drop\.json/i.test(current) ? dropJsonToSearchText(raw) : jsonToSearchText(raw);
      if (text.length >= 40) pages.push({ url: current, title, text });
      continue;
    }

    if (isScript) {
      const text = scriptToSearchText(raw);
      if (text.length >= 40) pages.push({ url: current, title, text });
      continue;
    }

    if (isPlain) {
      const text = normalizeWhitespace(raw);
      if (text.length >= 40) pages.push({ url: current, title, text });
      continue;
    }

    skipped.push({ url: current, reason: `unsupported content type ${contentType || "unknown"}` });
  }

  return { pages, skipped };
}

function extractLinks(html, currentUrl, seedUrl) {
  const links = new Set();
  const attrRegex = /\b(?:href|src|data-src)=["']([^"']+)["']/gi;
  const quotedPathRegex = /["']([^"']+\.(?:html?|json|txt|md)(?:\?[^"']*)?)["']/gi;

  for (const regex of [attrRegex, quotedPathRegex]) {
    let match;
    while ((match = regex.exec(html))) {
      const normalized = normalizeCandidateUrl(match[1], currentUrl, seedUrl);
      if (normalized) links.add(normalized);
    }
  }

  return [...links];
}

function normalizeCandidateUrl(value, currentUrl, seedUrl) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return "";
  if (/^(javascript|data|blob):/i.test(raw)) return "";

  let url;
  try {
    url = new URL(raw, currentUrl);
  } catch {
    return "";
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (!belongsToSeed(url, seedUrl)) return "";
  if (isIgnoredAssetPath(url.pathname)) return "";
  return normalizeCrawlUrl(url.href);
}

function belongsToSeed(url, seedUrl) {
  if (url.origin !== seedUrl.origin) return false;
  const seedPath = seedUrl.pathname.endsWith("/")
    ? seedUrl.pathname
    : seedUrl.pathname.replace(/[^/]*$/, "");
  return seedPath === "/" || url.pathname.startsWith(seedPath);
}

function normalizeCrawlUrl(value) {
  const url = new URL(value);
  url.hash = "";
  if (/^utm_|^fbclid$|^gclid$/i.test(url.searchParams.keys().next().value || "")) {
    url.search = "";
  }
  return url.href;
}

function isIgnoredAssetPath(pathname) {
  return /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|woff2?|ttf|otf|zip|rar|7z|exe|dmg|mp4|mov|webm|mp3|wav|pdf)$/i.test(pathname);
}

function extractTitle(raw, url) {
  const titleMatch = String(raw || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return decodeHtmlEntities(titleMatch[1]).trim().slice(0, 180);

  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? last.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") : parsed.hostname;
  } catch {
    return "";
  }
}

function htmlToText(html) {
  const withoutNoise = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(?:p|div|section|article|header|footer|nav|li|h[1-6]|tr|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(decodeHtmlEntities(withoutNoise));
}

// Chest item → loot table ID for its contents (from MANUAL_LOOT in loot.html)
const DROP_JSON_MANUAL_LOOT = {
  1517: 228,  // Clam
  1211: 51,   // Moonlight Treasure Chest
  1213: 53,   // Crystals Chest
  1422: 168,  // Gold Treasure Chest
  1212: 52,   // Flowers Chest
  1509: 262,  // Christmas Chest
  1773: 295,  // Gold Treasure Chest+
  1775: 326   // Spider Queen Box
};

const DROP_JSON_EXCLUDED_MOBS = new Set([99, 100, 121, 117, 118, 120, 115, 116, 113, 114, 119, 122]);

function dropJsonToSearchText(raw) {
  try {
    const data = JSON.parse(raw);
    const itemMap = {};
    const mobMap = {};
    (data.itemTemplates || []).forEach((i) => { itemMap[i.id] = i.name; });
    (data.mobTemplates || []).forEach((m) => { mobMap[m.id] = m.name; });
    const ltMap = {};
    (data.lootTables || []).forEach((lt) => { ltMap[lt.id] = lt; });

    const lines = [];

    // 1. Chest / item contents from MANUAL_LOOT
    for (const [itemIdStr, ltId] of Object.entries(DROP_JSON_MANUAL_LOOT)) {
      const itemId = Number(itemIdStr);
      const itemName = itemMap[itemId];
      const lt = ltMap[ltId];
      if (!itemName || !lt) continue;

      const sorted = [...(lt.items || [])].sort((a, b) => a.chance - b.chance);
      let prev = 0;
      const contents = sorted.map((it) => {
        const rate = Math.round((it.chance - prev) * 100) / 100;
        prev = it.chance;
        const name = itemMap[it.item] || `item${it.item}`;
        return `${name} (${rate}%)`;
      }).filter((s) => s).join(", ");
      lines.push(`${itemName} contains: ${contents}`);
    }

    // 2. Mob drops — one line per mob listing notable drops
    const mobLoot = data.mobLoot || {};
    for (const [mobIdStr, drops] of Object.entries(mobLoot)) {
      const mobId = Number(mobIdStr);
      if (DROP_JSON_EXCLUDED_MOBS.has(mobId)) continue;
      const mobName = mobMap[mobId];
      if (!mobName) continue;
      const validDrops = (Array.isArray(drops) ? drops : []).filter((d) => d.dropChance > 0);
      if (!validDrops.length) continue;

      const dropTexts = [];
      for (const d of validDrops) {
        const lt = ltMap[d.lootTable];
        if (!lt) continue;
        if (lt.items.length === 1) {
          const name = itemMap[lt.items[0].item];
          if (name) dropTexts.push(`${name} (${d.dropChance}%)`);
        } else {
          const sorted = [...lt.items].sort((a, b) => a.chance - b.chance);
          let prev = 0;
          for (const it of sorted) {
            const tableRate = Math.round((it.chance - prev) * 100) / 100;
            prev = it.chance;
            if (tableRate > 0) {
              const name = itemMap[it.item];
              if (name) {
                const effective = Math.round(tableRate * d.dropChance / 100 * 100) / 100;
                dropTexts.push(`${name} (${effective}%)`);
              }
            }
          }
        }
      }

      if (dropTexts.length) {
        lines.push(`${mobName} drops: ${dropTexts.slice(0, 20).join(", ")}`);
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

function jsonToSearchText(raw) {
  try {
    const parsed = JSON.parse(raw);
    const lines = [];
    flattenJson(parsed, lines);
    return normalizeWhitespace(lines.join("\n"));
  } catch {
    return normalizeWhitespace(raw);
  }
}

function scriptToSearchText(raw) {
  const text = String(raw || "")
    .replace(/window\.[A-Z0-9_]+\s*=\s*window\.[A-Z0-9_]+\s*\|\|\s*\{\};?/gi, " ")
    .replace(/\(function[\s\S]*?\}\)\(/, " ")
    .replace(/\);\s*$/, " ")
    .replace(/["'`{}[\]();,:]/g, " ")
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => {
      const cp = parseInt(code, 16);
      return (cp >= 0x20 && cp !== 0x7f) ? String.fromCharCode(cp) : " ";
    });

  return normalizeWhitespace(decodeHtmlEntities(text));
}

function sanitizeForStorage(text) {
  const s = String(text || "").replace(/\u0000/g, "");
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new TextEncoder().encode(s));
  } catch {
    return s;
  }
}

function flattenJson(value, lines, prefix = "") {
  if (value == null) return;

  if (Array.isArray(value)) {
    value.slice(0, 250).forEach((item, index) => {
      flattenJson(item, lines, prefix ? `${prefix} ${index + 1}` : String(index + 1));
    });
    return;
  }

  if (typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      flattenJson(item, lines, prefix ? `${prefix} ${key}` : key);
    });
    return;
  }

  const text = String(value).trim();
  if (text) lines.push(prefix ? `${prefix}: ${text}` : text);
}

function chunkText(text, size = 1400, overlap = 220) {
  const normalized = normalizeWhitespace(text);
  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const space = normalized.lastIndexOf(" ", end);
      if (space > start + Math.floor(size * 0.6)) end = space;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= 80) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
  };

  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return entity;
  });
}

async function upsertKnowledgeChunks(env, records) {
  if (!records.length) return;

  const batches = chunkArray(records, 100);
  for (const batch of batches) {
    const response = await fetch(`${supabaseBaseUrl(env)}/rest/v1/ai_knowledge_chunks?on_conflict=content_hash`, {
      method: "POST",
      headers: supabaseHeaders(env, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(batch)
    });

    if (!response.ok) {
      throw new Error(`Supabase upsert HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }
}

function dedupeKnowledgeRecords(records) {
  const byHash = new Map();

  records.forEach((record) => {
    if (!record?.content_hash) return;
    if (!byHash.has(record.content_hash)) {
      byHash.set(record.content_hash, record);
    }
  });

  return [...byHash.values()];
}

async function supabaseRpc(env, functionName, body) {
  const response = await fetch(`${supabaseBaseUrl(env)}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: supabaseHeaders(env),
    body: JSON.stringify(body || {})
  });

  if (!response.ok) {
    throw new Error(`Supabase RPC ${functionName} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseInsert(env, table, row) {
  const response = await fetch(`${supabaseBaseUrl(env)}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseHeaders(env, "return=minimal"),
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    throw new Error(`Supabase insert ${table} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

function supabaseBaseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function supabaseHeaders(env, prefer = "") {
  const headers = {
    "Content-Type": "application/json",
    "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function resolveSourceUrls(env, bodyUrls) {
  const configured = Array.isArray(bodyUrls) && bodyUrls.length
    ? bodyUrls
    : String(env.SOURCE_URLS || DEFAULT_SOURCE_URLS.join(",")).split(",");

  return [...new Set(configured
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "ADD_THIRD_SITE_HERE")
    .flatMap(expandSourceUrl)
    .filter((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    }))];
}

function expandSourceUrl(value) {
  if (isTclExplorerRoot(value)) {
    return TCL_EXPLORER_PATHS.map((path) => new URL(path, TCL_EXPLORER_BASE).href);
  }

  return [value];
}

function isTclExplorerRoot(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://axel4ro.github.io"
      && (url.pathname === "/TCLexplorer" || url.pathname === "/TCLexplorer/" || url.pathname === "/TCLexplorer/index.html");
  } catch {
    return false;
  }
}

function isTclExplorerUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://axel4ro.github.io" && url.pathname.startsWith("/TCLexplorer/");
  } catch {
    return false;
  }
}

function shouldFollowLinks(sourceUrl) {
  return !isTclExplorerUrl(sourceUrl);
}

function sourcePrefixForUrl(value) {
  const url = new URL(value);
  if (url.pathname && url.pathname !== "/" && /\.[a-z0-9]+$/i.test(url.pathname)) {
    return `${url.origin}${url.pathname}`;
  }
  const path = url.pathname && url.pathname !== "/"
    ? url.pathname.replace(/\/?$/, "/")
    : "/";
  return `${url.origin}${path}`;
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const originAllowed = !origin
    || allowedOrigins.includes("*")
    || allowedOrigins.includes(origin);

  const allowOrigin = origin && originAllowed
    ? origin
    : allowedOrigins.includes("*")
      ? "*"
      : allowedOrigins[0] || "";

  return {
    allowed: originAllowed,
    headers: {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Sync-Secret",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  };
}

function jsonResponse(request, env, status, payload, extraHeaders = {}) {
  const cors = getCorsHeaders(request, env);
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...cors.headers,
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  if (text.length > 20_000) throw new Error("Request body too large");
  return JSON.parse(text);
}

function checkRateLimit(request, env) {
  const windowMs = clampInt(env.RATE_LIMIT_WINDOW_SECONDS, 10, 3600, 60) * 1000;
  const max = clampInt(env.RATE_LIMIT_MAX, 1, 100, 12);
  const key = getClientIp(request);
  const now = Date.now();
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    cleanupRateLimitBuckets(now);
    return { ok: true };
  }

  if (current.count >= max) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;
  return { ok: true };
}

function cleanupRateLimitBuckets(now) {
  if (rateLimitBuckets.size < 5000) return;
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function normalizeQuestionForCache(question) {
  return String(question || "")
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:'"()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getCfCachedAnswer(hash) {
  try {
    const resp = await caches.default.match(new Request(`https://tcl-ai-cache.internal/a/${hash}`));
    if (!resp) return null;
    return await resp.json();
  } catch { return null; }
}

async function putCfCachedAnswer(hash, payload) {
  try {
    await caches.default.put(
      new Request(`https://tcl-ai-cache.internal/a/${hash}`),
      new Response(JSON.stringify(payload), {
        headers: { "Cache-Control": `public, max-age=${CF_CACHE_TTL_S}` }
      })
    );
  } catch {}
}

function getCachedAnswer(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCachedAnswer(key, payload) {
  const now = Date.now();
  if (responseCache.size >= 1000) {
    for (const [k, v] of responseCache.entries()) {
      if (v.expiresAt <= now) responseCache.delete(k);
      if (responseCache.size < 800) break;
    }
  }
  responseCache.set(key, { payload, expiresAt: now + RESPONSE_CACHE_TTL_MS });
}

function isAuthorizedSyncRequest(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const header = request.headers.get("X-Sync-Secret") || "";
  const supplied = bearer || header;
  return Boolean(supplied && env.SYNC_SECRET && supplied === env.SYNC_SECRET);
}

function shouldExposeError(request, env) {
  try {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);
    if (path !== "/sync-sites" && path !== "/chat") return false;
    if (String(env.DEBUG_ERRORS || "").toLowerCase() === "true") return true;
    return isAuthorizedSyncRequest(request, env);
  } catch {
    return false;
  }
}

function detectLanguage(question) {
  const text = String(question || "").toLowerCase();
  const knownLanguage = detectKnownLanguage(text);
  if (knownLanguage) return knownLanguage;
  if (/[ăâîșşțţ]/i.test(text)) return "ro";
  const roWords = [
    "cum",
    "care",
    "unde",
    "cat",
    "cati",
    "cate",
    "este",
    "sunt",
    "pot",
    "vreau",
    "pentru",
    "despre",
    "joc",
    "recompense"
  ];
  return roWords.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text)) ? "ro" : "en";
}

function normalizeLanguage(value) {
  const language = String(value || "en").toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES[language] ? language : "en";
}

function detectKnownLanguage(text) {
  const hints = [
    ["ro", /[ăâîșşțţ]/i, ["cum", "care", "unde", "cat", "cati", "cate", "este", "sunt", "pentru", "despre", "joc", "recompense"]],
    ["tr", /[çğıöşü]/i, ["nasil", "nedir", "oyun", "etkinlik", "ganimet", "yukselt", "hakkinda"]],
    ["de", /[äöüß]/i, ["wie", "was", "wo", "spiel", "ereignis", "belohnung"]],
    ["es", /[áéíóúñ¿¡]/i, ["como", "que", "donde", "juego", "eventos", "recompensas"]],
    ["fr", /[àâçéèêëîïôùûüÿœ]/i, ["comment", "quoi", "jeu", "evenements", "recompenses"]],
    ["it", /[àèéìòù]/i, ["come", "cosa", "dove", "gioco", "eventi", "ricompense"]],
    ["pl", /[ąćęłńóśźż]/i, ["jak", "gdzie", "gra", "wydarzenia", "nagrody"]],
    ["pt", /[ãõáâàçéêíóôú]/i, ["onde", "jogo", "eventos", "recompensas"]]
  ];

  for (const [language, chars, words] of hints) {
    if (chars.test(text)) return language;
    if (words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text))) return language;
  }

  return "";
}

function languageName(language) {
  const normalized = normalizeLanguage(language);
  return `${SUPPORTED_LANGUAGES[normalized].name} (${normalized})`;
}

function missingKnowledgeAnswer(language) {
  return SUPPORTED_LANGUAGES[normalizeLanguage(language)].missing;
}

function serviceUnavailableAnswer(language) {
  const msgs = {
    en: "The AI service is temporarily at capacity. Please try again in a few minutes.",
    ro: "Serviciul AI este temporar suprasolicitat. Încearcă din nou în câteva minute.",
    tr: "AI servisi geçici olarak kapasitede. Birkaç dakika sonra tekrar deneyin.",
    de: "Der KI-Dienst ist vorübergehend ausgelastet. Bitte versuche es in ein paar Minuten erneut.",
    es: "El servicio de IA está temporalmente saturado. Inténtalo de nuevo en unos minutos.",
    fr: "Le service IA est temporairement saturé. Réessaie dans quelques minutes.",
    it: "Il servizio AI è temporaneamente a piena capacità. Riprova tra qualche minuto.",
    pl: "Usługa AI jest tymczasowo przeciążona. Spróbuj ponownie za kilka minut.",
    pt: "O serviço de IA está temporariamente sobrecarregado. Tente novamente em alguns minutos."
  };
  return msgs[normalizeLanguage(language)] || msgs.en;
}

function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    || "unknown";
}

function assertRequiredEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
