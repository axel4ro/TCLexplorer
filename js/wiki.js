/* Wiki — embedded in TCL Explorer (expects global showPage, setLang, currentLang from index) */
(function () {
  window.wikiData = {};
  let wikiSearchQuery = "";

  function tr(key, fallback) {
    return (window.translations && window.translations[key])
      || (window.fallbackTranslations && window.fallbackTranslations[key])
      || fallback;
  }

  function getBundledWikiData(lang) {
    return window.TCL_WIKI_DATA?.[lang] || null;
  }

  function wikiSectionTitle(name) {
    const key = String(name || "").toLowerCase();
    return tr("wiki_section_" + key, name.charAt(0).toUpperCase() + name.slice(1));
  }

  const WIKI_INTERNAL_ROUTES = {
    "Item_Upgrade_Requirements.html": "wiki-item-upgrade",
    "Items_Upgrade_Simulator.html": "wiki-blacksmith",
    "loot.html": "wiki-loot"
  };

  window.openWikiInternalPage = function (src, title, description) {
    const lang = window.currentLang || "en";
    const separator = String(src).includes("?") ? "&" : "?";
    const resolvedSrc = `${src}${separator}lang=${encodeURIComponent(lang)}&v=20260512-1`;
    const routeKey = WIKI_INTERNAL_ROUTES[String(src).split("?")[0]] || "";
    if (typeof window.openInternalPage === "function") {
      window.openInternalPage(resolvedSrc, title, {
        navId: "btn-wiki",
        routeKey,
        loadingTitle: "Loading <span>TCL Explorer</span>...",
        loadingSubtitle: "Opening Wiki page inside TCL Explorer.",
        waitForReadyMessage: true
      });
      return;
    }
    window.location.href = resolvedSrc;
  };

  window.wikiGoToPage = function (pageId) {
    if (typeof showPage === "function") showPage(pageId);
    if (window.location.hash.replace("#", "") !== pageId) {
      window.location.hash = pageId;
    }
  };

  function highlightText(text, query) {
    if (!query || !text) return text;
    const regex = new RegExp("(" + query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return String(text).replace(regex, '<span class="wiki-highlight">$1</span>');
  }

  // Deep links: #wiki/<section> or #wiki/<section>/<card>. Card slugs come from the English name at
  // the same position, so a shared link opens the same card in every language.
  function wikiSlug(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function wikiChildRoute(sectionName, name) {
    const names = function (section) {
      if (!section) return [];
      return section.categories ? Object.keys(section.categories) : (section.list || []).map(function (i) { return i.name; });
    };
    const index = names(window.wikiData?.[sectionName]).indexOf(name);
    const enName = index >= 0 ? names(window.TCL_WIKI_DATA?.en?.[sectionName])[index] : null;
    return "wiki/" + sectionName + "/" + wikiSlug(enName || name);
  }

  function setWikiRoute(route) {
    if (!route) return;
    const hash = "#" + route;
    if (window.location.hash === hash) return;
    lastHandledRouteHash = hash;
    history.replaceState(null, "", window.location.pathname + window.location.search + hash);
  }

  window.openWikiDeepLink = function (path) {
    const parts = String(path || "").split("/").filter(Boolean).map(wikiSlug);
    if (!parts.length) return;
    const sectionToggle = document.querySelector('#wikiContent [data-wiki-route="wiki/' + parts[0] + '"]');
    if (!sectionToggle) return;
    if (!sectionToggle.classList.contains("open")) sectionToggle.click();
    let target = sectionToggle;
    const child = parts[1] && document.querySelector('#wikiContent [data-wiki-route="wiki/' + parts[0] + "/" + parts[1] + '"]');
    if (child) {
      target = child;
      if (child.classList.contains("wiki-toggle") && !child.classList.contains("open")) child.click();
    }
    setWikiRoute(target.dataset.wikiRoute);
    // run after showPage(), whose scroll-to-top happens in rAF + setTimeout(0)
    setTimeout(function () {
      target.scrollIntoView({ block: "start" });
      target.classList.add("wiki-deeplink-flash");
      setTimeout(function () { target.classList.remove("wiki-deeplink-flash"); }, 2200);
    }, 150);
  };

  window.wikiSelectItem = function (el, event) {
    if (event && event.target.closest("button, a")) return;
    setWikiRoute(el.dataset.wikiRoute);
  };

  function applyPendingWikiDeepLink() {
    const path = window.__wikiPendingDeepLink;
    window.__wikiPendingDeepLink = null;
    if (path) window.openWikiDeepLink(path);
  }

  function escapeJsString(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r?\n/g, " ");
  }

  window.loadWiki = async function (lang, fallback) {
    const container = document.getElementById("wikiContent");
    if (!container) return;

    const bundledWiki = getBundledWikiData(lang);
    if (bundledWiki) {
      window.wikiData = bundledWiki;
      window.renderWiki(window.wikiData, false);
      applyPendingWikiDeepLink();
      return;
    }

    const englishWiki = getBundledWikiData("en");
    if (fallback && lang !== "en" && englishWiki) {
      window.wikiData = englishWiki;
      window.renderWiki(window.wikiData, false);
      applyPendingWikiDeepLink();
      return;
    }

    container.innerHTML = "<p>❌ " + tr("wiki_failed_load", "Failed to load Wiki data for lang:") + " " + lang + "</p>";
  };

  window.renderWiki = function (data, forceOpen) {
    const container = document.getElementById("wikiContent");
    if (!container) return;
    container.innerHTML = "";

    for (const [sectionName, sectionData] of Object.entries(data)) {
      if (!sectionData) continue;

      const sectionHasResults =
        (sectionData.list && sectionData.list.length > 0) ||
        (sectionData.categories && Object.keys(sectionData.categories).length > 0);

      container.innerHTML += `
      <div class="wiki-grid-item ${forceOpen && sectionHasResults ? "is-expanded" : ""}">
        <div class="card wiki-toggle ${forceOpen && sectionHasResults ? "open" : ""}" data-wiki-route="wiki/${sectionName}"
             onclick="toggleWikiSection('${sectionName}List', this)">
          <div class="wiki-toggle-header">
            <h2>📂 ${wikiSectionTitle(sectionName)}</h2>
            <span>${forceOpen && sectionHasResults ? "▼" : "▶"}</span>
          </div>
          <p>${highlightText(sectionData.info || "", wikiSearchQuery)}</p>
        </div>
        <div id="${sectionName}List" class="wiki-section-content" 
             style="display:${forceOpen && sectionHasResults ? "block" : "none"}"></div>
      </div>
    `;

      if (sectionName.toLowerCase() === "bonuses") {
        const wikiOpenedText = escapeJsString(tr("wiki_opened_from_explorer", "Opened from Wiki inside TCL Explorer."));
        const itemBonusTitle = escapeJsString(tr("wiki_special_item_bonus_title", "Items Bonus & Upgrade Requirements"));
        const blacksmithTitle = escapeJsString(tr("wiki_special_blacksmith_title", "Blacksmith - Upgrade Simulator %"));
        const dropTitle = escapeJsString(tr("wiki_special_drop_title", "Drop Chance %"));

        container.innerHTML += `
        <div class="wiki-grid-item">
          <div class="card wiki-link-card" onclick="openWikiInternalPage('Item_Upgrade_Requirements.html', '${itemBonusTitle}', '${wikiOpenedText}')">
            <div class="wiki-toggle-header">
              <h2>⚙️ ${tr("wiki_special_item_bonus_title", "Item Bonus & Upgrade")}</h2>
            </div>
            <p>${tr("wiki_special_item_bonus_desc", "View all bonuses and materials requirements needed to upgrade items.")}</p>
            <span class="wiki-link-card__icon">↗</span>
          </div>
        </div>
        <div class="wiki-grid-item">
          <div class="card wiki-link-card" onclick="openWikiInternalPage('Items_Upgrade_Simulator.html', '${blacksmithTitle}', '${wikiOpenedText}')">
            <div class="wiki-toggle-header">
              <h2>🔄 ${tr("wiki_special_blacksmith_title", "Blacksmith - Upgrade Simulator %")}</h2>
            </div>
            <p>${tr("wiki_special_blacksmith_desc", "Test your upgrade strategy and calculate expected results before risking your items.")}</p>
            <span class="wiki-link-card__icon">↗</span>
          </div>
        </div>
        <div class="wiki-grid-item">
          <div class="card wiki-link-card" onclick="openWikiInternalPage('loot.html', '${dropTitle}', '${wikiOpenedText}')">
            <div class="wiki-toggle-header">
              <h2>📊 ${tr("wiki_special_drop_title", "Drop Chance %")}</h2>
            </div>
            <p>${tr("wiki_special_drop_desc", "View all items and monsters — drop percentages and loot tables.")}</p>
            <span class="wiki-link-card__icon">↗</span>
          </div>
        </div>
    `;
      }

      const secDiv = document.getElementById(sectionName + "List");
      if (!secDiv) continue;

      if (sectionData.list) {
        sectionData.list.forEach(function (item) {
          let descHtml = "";

          if (item.desc) {
            const lines = item.desc.split("\n");
            descHtml =
              "<ul class='wiki-desc-list'>" +
              lines.map(function (line) {
                return "<li>" + highlightText(line, wikiSearchQuery) + "</li>";
              }).join("") +
              "</ul>";
          }

          if (item.categories) {
            let catHtml = "";
            for (const [catName, catData] of Object.entries(item.categories)) {
              const lines = catData.info.split("\n");
              const infoHtml =
                "<ul class='wiki-desc-list'>" +
                lines.map(function (line) {
                  return "<li>" + highlightText(line, wikiSearchQuery) + "</li>";
                }).join("") +
                "</ul>";

              const isOpen = wikiSearchQuery && catData.info.toLowerCase().includes(wikiSearchQuery);

              catHtml += `
              <div class="card wiki-toggle ${isOpen ? "open" : ""}" onclick="toggleWikiCategory('${item.name}-${catName}', this)">
                <div class="wiki-toggle-header">
                  <h3>${highlightText(catName, wikiSearchQuery)}</h3>
                  <span>${isOpen ? "▼" : "▶"}</span>
                </div>
                <div id="cat-${item.name}-${catName}" class="wiki-section-content" style="display:${isOpen ? "block" : "none"};">
                  ${infoHtml}
                </div>
              </div>
            `;
            }
            descHtml += catHtml;
          }

          secDiv.innerHTML += `
        <div class="card" data-wiki-route="${wikiChildRoute(sectionName, item.name)}" onclick="wikiSelectItem(this, event)">
          <h2>${highlightText(item.name, wikiSearchQuery)}</h2>
          ${descHtml}
          ${item.link ? (String(item.link).toLowerCase().endsWith(".html")
            ? `<button type="button" class="wiki-btn-link" onclick="openWikiInternalPage('${item.link}', '${String(item.name).replace(/'/g, "\\'")}', '${tr("wiki_opened_from_explorer", "Opened from Wiki inside TCL Explorer.").replace(/'/g, "\\'")}')">🌐 ${tr("wiki_view_in_tcl_explorer", "View in TCL Explorer")}</button>`
            : `<a href="${item.link}" class="wiki-btn-link" target="_blank" rel="noopener noreferrer">🌐 ${tr("wiki_view_in_tcl_explorer", "View in TCL Explorer")}</a>`) : ""}
          ${item.page ? `<button type="button" class="wiki-btn-link" onclick="wikiGoToPage('${item.page}')">🌐 ${tr("wiki_view_in_explorer", "View in Explorer")}</button>` : ""}
        </div>
      `;
        });
      }

      if (sectionData.categories) {
        for (const [catName, catData] of Object.entries(sectionData.categories)) {
          const catHasResults = catData.list && Object.keys(catData.list).length > 0;

          secDiv.innerHTML += `
          <div class="card wiki-toggle ${forceOpen && catHasResults ? "open" : ""}" data-wiki-route="${wikiChildRoute(sectionName, catName)}"
               onclick="toggleWikiCategory('${sectionName}-${catName}', this)">
            <div class="wiki-toggle-header">
              <h3>${highlightText(catName, wikiSearchQuery)}</h3>
              <span>${forceOpen && catHasResults ? "▼" : "▶"}</span>
            </div>
            <p>${highlightText(catData.info, wikiSearchQuery)}</p>
            <div id="cat-${sectionName}-${catName}" class="wiki-section-content" 
                 style="display:${forceOpen && catHasResults ? "block" : "none"}"></div>
          </div>
        `;

          const catDiv = document.getElementById("cat-" + sectionName + "-" + catName);
          if (catDiv) {
            for (const [bonus, values] of Object.entries(catData.list)) {
              catDiv.innerHTML +=
                "<p><b>" +
                highlightText(bonus, wikiSearchQuery) +
                ":</b> " +
                values.join(", ") +
                "</p>";
            }
          }
        }
      }
    }
  };

  window.toggleWikiSection = function (id, el) {
    const section = document.getElementById(id);
    if (!section) return;
    const gridItem = el.closest(".wiki-grid-item");
    const hasContent = !!(section.children.length || section.textContent.trim());
    const allGridItems = Array.from(document.querySelectorAll("#wikiContent > .wiki-grid-item"));
    allGridItems.forEach((item) => item.classList.remove("is-expanded", "is-row-companion"));
    if (section.style.display === "block") {
      section.style.display = "none";
      el.classList.remove("open");
      if (el.dataset.wikiRoute) setWikiRoute("wiki");
    } else {
      if (el.dataset.wikiRoute) setWikiRoute(el.dataset.wikiRoute);
      document.querySelectorAll("#wikiContent .wiki-grid-item .wiki-toggle.open").forEach((otherToggle) => {
        if (otherToggle === el) return;
        otherToggle.classList.remove("open");
        const otherGridItem = otherToggle.closest(".wiki-grid-item");
        if (otherGridItem) otherGridItem.classList.remove("is-expanded");
        const otherContent = otherGridItem?.querySelector(".wiki-section-content");
        if (otherContent) otherContent.style.display = "none";
      });
      section.style.display = "block";
      el.classList.add("open");
      if (gridItem && hasContent) {
        const gridIndex = allGridItems.indexOf(gridItem);
        if (gridIndex % 2 === 1) {
          const leftPair = allGridItems[gridIndex - 1];
          if (leftPair) leftPair.classList.add("is-row-companion");
        }
        gridItem.classList.add("is-expanded");
      }
    }
  };

  window.toggleWikiCategory = function (cat, el) {
    const section = document.getElementById("cat-" + cat);
    if (!section) return;
    const route = el.dataset.wikiRoute;
    if (section.style.display === "block") {
      section.style.display = "none";
      el.classList.remove("open");
      if (route) setWikiRoute(route.split("/").slice(0, 2).join("/"));
    } else {
      section.style.display = "block";
      el.classList.add("open");
      if (route) setWikiRoute(route);
    }
  };

  window.searchWiki = function () {
    const input = document.getElementById("wikiSearchInput");
    const query = (input && input.value ? input.value : "").toLowerCase();
    wikiSearchQuery = query;

    if (!query) {
      window.renderWiki(window.wikiData, false);
      return;
    }

    const filtered = {};
    const data = window.wikiData;

    for (const [sectionName, sectionData] of Object.entries(data)) {
      if (!sectionData) continue;

      if (sectionData.list) {
        const filteredList = sectionData.list
          .map(function (item) {
            let match = false;
            if (item.desc && item.desc.toLowerCase().includes(query)) match = true;
            if (item.name.toLowerCase().includes(query)) match = true;
            let matchedCategories = {};
            if (item.categories) {
              for (const [catName, catData] of Object.entries(item.categories)) {
                if (
                  catName.toLowerCase().includes(query) ||
                  catData.info.toLowerCase().includes(query)
                ) {
                  match = true;
                  matchedCategories[catName] = catData;
                }
              }
            }
            if (match) {
              return {
                ...item,
                categories:
                  Object.keys(matchedCategories).length > 0 ? matchedCategories : item.categories
              };
            }
            return null;
          })
          .filter(Boolean);

        if (
          sectionData.info.toLowerCase().includes(query) ||
          filteredList.length > 0
        ) {
          filtered[sectionName] = {
            info: sectionData.info,
            list: filteredList
          };
        }
      }

      if (sectionData.categories) {
        const categories = {};
        for (const [cat, obj] of Object.entries(sectionData.categories)) {
          const filteredList = Object.fromEntries(
            Object.entries(obj.list).filter(function ([bonus, values]) {
              return (
                bonus.toLowerCase().includes(query) ||
                values.some(function (v) {
                  return v.toString().toLowerCase().includes(query);
                })
              );
            })
          );

          if (
            cat.toLowerCase().includes(query) ||
            obj.info.toLowerCase().includes(query) ||
            Object.keys(filteredList).length > 0
          ) {
            categories[cat] = { info: obj.info, list: filteredList };
          }
        }

        if (
          sectionData.info.toLowerCase().includes(query) ||
          Object.keys(categories).length > 0
        ) {
          filtered[sectionName] = { info: sectionData.info, categories: categories };
        }
      }
    }

    window.renderWiki(filtered, true);
  };
})();
