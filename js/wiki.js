/* Wiki — embedded in TCL Explorer (expects global showPage, setLang, currentLang from index) */
(function () {
  const WIKI_BASE_URL = "https://axel4ro.github.io/TCLexplorer/lang";

  window.wikiData = {};
  let wikiSearchQuery = "";

  window.openWikiInternalPage = function (src, title, description) {
    if (typeof window.openInternalPage === "function") {
      window.openInternalPage(src, title, {
        navId: "btn-wiki"
      });
      return;
    }
    window.location.href = src;
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

  window.loadWiki = async function (lang, fallback) {
    const container = document.getElementById("wikiContent");
    if (!container) return;
    try {
      const res = await fetch(WIKI_BASE_URL + "/wiki_" + lang + ".json?t=" + Date.now());
      if (!res.ok) throw new Error("HTTP " + res.status);
      window.wikiData = await res.json();
      window.renderWiki(window.wikiData, false);
    } catch (e) {
      console.error("Wiki load error", e);
      if (fallback && lang !== "en" && typeof setLang === "function") {
        setLang("en");
      } else {
        container.innerHTML = "<p>❌ Failed to load Wiki data for lang: " + lang + "</p>";
      }
    }
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
      <div class="card wiki-toggle ${forceOpen && sectionHasResults ? "open" : ""}" 
           onclick="toggleWikiSection('${sectionName}List', this)">
        <div class="wiki-toggle-header">
          <h2>📂 ${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)}</h2>
          <span>${forceOpen && sectionHasResults ? "▼" : "▶"}</span>
        </div>
        <p>${highlightText(sectionData.info || "", wikiSearchQuery)}</p>
      </div>
      <div id="${sectionName}List" class="wiki-section-content" 
           style="display:${forceOpen && sectionHasResults ? "block" : "none"}"></div>
    `;

      if (sectionName.toLowerCase() === "classes") {
        container.innerHTML += `
        <div class="card wiki-link-card" onclick="openWikiInternalPage('Item_Upgrade_Requirements.html', 'Items Bonus & Upgrade Requirements', 'Opened from Wiki inside TCL Explorer.')">
            <div class="wiki-toggle-header">
                <h2>⚙️ Item Bonus &amp; Upgrade </h2>
                <span>▶</span>
            </div>
            <p>View all Bonuses and materials requirements needed to upgrade items.</p>
        </div>
        <div class="card wiki-link-card" onclick="openWikiInternalPage('Items_Upgrade_Simulator.html', 'Blacksmith - Upgrade Simulator %', 'Test upgrade strategy without leaving the dashboard.')">
            <div class="wiki-toggle-header">
                <h2>🔄 Blacksmith - Upgrade Simulator %</h2>
                <span>▶</span>
            </div>
            <p>Test your upgrade strategy and calculate expected results before risking your items.</p>
        </div>
        <div class="card wiki-link-card" onclick="openWikiInternalPage('loot.html', 'Drop Chance %', 'View loot tables and drop percentages inside TCL Explorer.')">
            <div class="wiki-toggle-header">
                <h2>📊 Drop Chance %</h2>
                <span>▶</span>
            </div>
            <p>View all Items and Monsters — drop percentages and loot tables.</p>
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
        <div class="card">
          <h2>${highlightText(item.name, wikiSearchQuery)}</h2>
          ${descHtml}
          ${item.link ? (String(item.link).toLowerCase().endsWith(".html")
            ? `<button type="button" class="wiki-btn-link" onclick="openWikiInternalPage('${item.link}', '${String(item.name).replace(/'/g, "\\'")}', 'Opened from Wiki inside TCL Explorer.')">🌐 View in TCL Explorer</button>`
            : `<a href="${item.link}" class="wiki-btn-link" target="_blank" rel="noopener noreferrer">🌐 View in TCL Explorer</a>`) : ""}
          ${item.page ? `<button type="button" class="wiki-btn-link" onclick="wikiGoToPage('${item.page}')">🌐 View in Explorer</button>` : ""}
        </div>
      `;
        });
      }

      if (sectionData.categories) {
        for (const [catName, catData] of Object.entries(sectionData.categories)) {
          const catHasResults = catData.list && Object.keys(catData.list).length > 0;

          secDiv.innerHTML += `
          <div class="card wiki-toggle ${forceOpen && catHasResults ? "open" : ""}" 
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
    if (section.style.display === "block") {
      section.style.display = "none";
      el.classList.remove("open");
    } else {
      section.style.display = "block";
      el.classList.add("open");
    }
  };

  window.toggleWikiCategory = function (cat, el) {
    const section = document.getElementById("cat-" + cat);
    if (!section) return;
    if (section.style.display === "block") {
      section.style.display = "none";
      el.classList.remove("open");
    } else {
      section.style.display = "block";
      el.classList.add("open");
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
