(function () {
  const SOURCE_TEXT = new WeakMap();
  const RENDERED_TEXT = new WeakMap();
  const SOURCE_ATTR = new WeakMap();
  const TEXT_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const ATTRS = ["placeholder", "title", "aria-label", "alt", "value"];
  let currentLang = normalizeLang(new URLSearchParams(location.search).get("lang") || localStorage.getItem("lang") || navigator.language || "en");
  let observer = null;
  let isApplying = false;
  let sourceTitle = document.title;

  function normalizeLang(lang) {
    const raw = String(lang || "en").toLowerCase();
    const supported = ["en", "ro", "tr", "de", "es", "fr", "it", "pl", "pt"];
    if (supported.includes(raw)) return raw;
    const base = raw.split("-")[0];
    return supported.includes(base) ? base : "en";
  }

  function getDict(lang) {
    return window.TCL_PAGE_I18N?.[lang] || {};
  }

  function translateSource(source, lang) {
    if (!source || lang === "en") return source;
    return getDict(lang)[source] || source;
  }

  function translateTextNode(node, lang) {
    const raw = node.nodeValue || "";
    const trimmed = raw.trim();
    if (!trimmed || !/[A-Za-z]/.test(trimmed)) return;

    const lastRendered = RENDERED_TEXT.get(node);
    if (!SOURCE_TEXT.has(node) || (lastRendered && trimmed !== lastRendered)) {
      SOURCE_TEXT.set(node, trimmed);
    }
    const source = SOURCE_TEXT.get(node);
    const translated = translateSource(source, lang);
    if (translated === source && lang !== "en") return;

    const nextValue = raw.replace(trimmed, translated);
    if (nextValue !== raw) node.nodeValue = nextValue;
    RENDERED_TEXT.set(node, translated);
  }

  function getAttrSources(element) {
    let map = SOURCE_ATTR.get(element);
    if (!map) {
      map = {};
      SOURCE_ATTR.set(element, map);
    }
    return map;
  }

  function translateAttributes(element, lang) {
    const sources = getAttrSources(element);
    for (const attr of ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      const raw = element.getAttribute(attr);
      if (!raw || !/[A-Za-z]/.test(raw)) continue;
      if (!sources[attr]) sources[attr] = raw.trim();
      const translated = translateSource(sources[attr], lang);
      if (translated !== raw) element.setAttribute(attr, translated);
    }
  }

  function walk(root, lang) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root, lang);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && TEXT_SKIP.has(root.tagName)) return;

    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root, lang);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && TEXT_SKIP.has(node.tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, lang);
      else if (node.nodeType === Node.ELEMENT_NODE) translateAttributes(node, lang);
      node = walker.nextNode();
    }
  }

  function apply(lang) {
    currentLang = normalizeLang(lang || currentLang);
    document.documentElement.lang = currentLang;
    if (!document.body) return;

    isApplying = true;
    if (!sourceTitle) sourceTitle = document.title;
    document.title = translateSource(sourceTitle, currentLang);
    walk(document.body, currentLang);
    isApplying = false;
  }

  function setupObserver() {
    if (!document.body || observer) return;
    observer = new MutationObserver((mutations) => {
      if (isApplying) return;
      isApplying = true;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => walk(node, currentLang));
        } else if (mutation.type === "attributes") {
          translateAttributes(mutation.target, currentLang);
        } else if (mutation.type === "characterData") {
          translateTextNode(mutation.target, currentLang);
        }
      }
      isApplying = false;
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    });
  }

  window.applyPageTranslations = function (lang) {
    apply(lang);
  };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "tcl:set-lang") return;
    currentLang = normalizeLang(data.lang);
    localStorage.setItem("lang", currentLang);
    apply(currentLang);
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== "lang" || !event.newValue) return;
    currentLang = normalizeLang(event.newValue);
    apply(currentLang);
  });

  document.addEventListener("DOMContentLoaded", () => {
    currentLang = normalizeLang(new URLSearchParams(location.search).get("lang") || localStorage.getItem("lang") || currentLang);
    setupObserver();
    apply(currentLang);
  });
})();
