(function () {
  const SETTINGS_KEY = "tclClaimReminderSettings";
  const EVENT_SETTINGS_KEY = "tclEventNotificationSettings";
  const DEFAULT_EARLY_DAYS = 7;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_LOCAL_WINDOW_MS = 24 * DAY_MS;
  const STATUS_TICK_MS = 60 * 1000;
  const STATS_POLL_INTERVAL_MS = 5 * 60 * 1000;

  const copy = {
    en: {
      pageTitle: "Claim Reminder",
      pageIntro: "Keep automatic claim days on a separate notification track from weekly events.",
      panelTitle: "Staking claim notifications",
      checking: "Checking notification support...",
      unsupported: "This browser cannot receive claim reminders.",
      denied: "Notifications are blocked. Enable them from browser settings for this site.",
      ready: "Enter remaining days, then save the reminder on this device.",
      enabledPush: "Active on this device. You will receive a notification {earlyAlert} and on the final day.",
      enabledLocal: "Local reminder saved. You will receive a notification {earlyAlert} and on the final day.",
      serverMissing: "Cloudflare push is not configured yet. Local reminders only.",
      busy: "Updating claim reminder...",
      saved: "Claim reminder saved.",
      disabled: "Claim reminder disabled.",
      save: "Save / Update",
      test: "Test",
      disable: "Disable",
      labelLabel: "Reminder name",
      labelPlaceholder: "Automatic claim",
      daysLabel: "Days remaining",
      earlyLabel: "Early alert",
      earlySuffix: "days before",
      summaryEmpty: "No claim reminder is active.",
      summaryActive: "{days} days left",
      summaryExpired: "0 days left",
      expiresAt: "Ends around {date}",
      nextAlert: "Next alert: {date}",
      noFutureAlert: "No future alert scheduled.",
      summaryLabel: "Status",
      enabledTitle: "Claim reminder enabled",
      enabledBody: "You will receive claim reminders on this device.",
      testTitle: "TCL claim reminder test",
      testBody: "Claim reminders are working on this device.",
      invalidDays: "Enter at least 1 day.",
      invalidEarly: "Early alert must be at least 1 day.",
      reminderCountUnit: "Reminders",
      reminderCountMeta: "Live",
      reminderCountError: "Unavailable",
      earlyAlertOne: "1 day before",
      earlyAlertMany: "{days} days before",
      localEarlyTitle: "Claim reminder: {days} days left",
      localEarlyBody: "{label} expires soon.",
      localFinalTitle: "Claim reminder: last day",
      localFinalBody: "{label} is on its final day."
    },
    ro: {
      pageTitle: "Claim Reminder",
      pageIntro: "Tine zilele pentru revendicare automata separat de notificarile pentru evenimente.",
      panelTitle: "Notificari staking claim",
      checking: "Verific suportul pentru notificari...",
      unsupported: "Browserul acesta nu poate primi reminder-e pentru claim.",
      denied: "Notificarile sunt blocate. Activeaza-le din setarile browserului pentru site.",
      ready: "Introdu zilele ramase, apoi salveaza reminder-ul pe acest device.",
      enabledPush: "Activ pe acest device. Vei primi notificare cu {earlyAlert} si in ultima zi.",
      enabledLocal: "Reminder local salvat. Vei primi notificare cu {earlyAlert} si in ultima zi.",
      serverMissing: "Cloudflare push nu este configurat inca. Doar reminder local.",
      busy: "Actualizez claim reminder...",
      saved: "Claim reminder salvat.",
      disabled: "Claim reminder oprit.",
      save: "Salveaza / Update",
      test: "Test",
      disable: "Opreste",
      labelLabel: "Nume reminder",
      labelPlaceholder: "Revendicare automata",
      daysLabel: "Zile ramase",
      earlyLabel: "Alerta devreme",
      earlySuffix: "zile inainte",
      summaryEmpty: "Nu este activ niciun claim reminder.",
      summaryActive: "Mai ai {days} zile",
      summaryExpired: "0 zile ramase",
      expiresAt: "Se termina aproximativ pe {date}",
      nextAlert: "Urmatoarea alerta: {date}",
      noFutureAlert: "Nu exista alerta viitoare programata.",
      summaryLabel: "Status",
      enabledTitle: "Claim reminder activat",
      enabledBody: "Vei primi reminder-e pentru claim pe acest device.",
      testTitle: "Test claim reminder TCL",
      testBody: "Reminder-ele pentru claim functioneaza pe acest device.",
      invalidDays: "Introdu cel putin 1 zi.",
      invalidEarly: "Alerta devreme trebuie sa fie de cel putin 1 zi.",
      reminderCountUnit: "Remindere",
      reminderCountMeta: "Live",
      reminderCountError: "Indisponibil",
      earlyAlertOne: "1 zi inainte",
      earlyAlertMany: "{days} zile inainte",
      localEarlyTitle: "Reminder claim: mai ai {days} zile",
      localEarlyBody: "{label} expira in curand.",
      localFinalTitle: "Reminder claim: ultima zi",
      localFinalBody: "{label} este in ultima zi."
    },
    tr: {
      pageTitle: "Claim Hatirlatici",
      pageIntro: "Otomatik claim gunlerini haftalik etkinliklerden ayri bir bildirim kanalinda tut.",
      panelTitle: "Staking claim bildirimleri",
      checking: "Bildirim destegi kontrol ediliyor...",
      unsupported: "Bu tarayici claim hatirlaticilari alamaz.",
      denied: "Bildirimler engellenmis. Bu site icin tarayici ayarlarindan etkinlestir.",
      ready: "Kalan gunleri gir, sonra bu cihazda hatirlaticiyi kaydet.",
      enabledPush: "Bu cihazda aktif. {earlyAlert} ve son gunde bildirim alacaksin.",
      enabledLocal: "Yerel hatirlatici kaydedildi. {earlyAlert} ve son gunde bildirim alacaksin.",
      serverMissing: "Cloudflare push henuz yapilandirilmadi. Sadece yerel hatirlaticilar.",
      busy: "Claim hatirlaticisi guncelleniyor...",
      saved: "Claim hatirlaticisi kaydedildi.",
      disabled: "Claim hatirlaticisi kapatildi.",
      save: "Kaydet / Guncelle",
      test: "Test",
      disable: "Kapat",
      labelLabel: "Hatirlatici adi",
      labelPlaceholder: "Otomatik claim",
      daysLabel: "Kalan gun",
      earlyLabel: "Erken uyari",
      earlySuffix: "gun once",
      summaryEmpty: "Aktif claim hatirlaticisi yok.",
      summaryActive: "{days} gun kaldi",
      summaryExpired: "0 gun kaldi",
      expiresAt: "{date} civarinda biter",
      nextAlert: "Sonraki uyari: {date}",
      noFutureAlert: "Planlanmis gelecek uyari yok.",
      summaryLabel: "Durum",
      enabledTitle: "Claim hatirlaticisi aktif",
      enabledBody: "Bu cihazda claim hatirlaticilari alacaksin.",
      testTitle: "TCL claim hatirlatici testi",
      testBody: "Claim hatirlaticilari bu cihazda calisiyor.",
      invalidDays: "En az 1 gun gir.",
      invalidEarly: "Erken uyari en az 1 gun olmali.",
      earlyAlertOne: "1 gun once",
      earlyAlertMany: "{days} gun once",
      localEarlyTitle: "Claim hatirlaticisi: {days} gun kaldi",
      localEarlyBody: "{label} yakinda sona erecek.",
      localFinalTitle: "Claim hatirlaticisi: son gun",
      localFinalBody: "{label} son gununde."
    },
    de: {
      pageTitle: "Claim-Erinnerung",
      pageIntro: "Halte automatische Claim-Tage getrennt von den wochentlichen Event-Benachrichtigungen.",
      panelTitle: "Staking-Claim-Benachrichtigungen",
      checking: "Benachrichtigungsunterstutzung wird gepruft...",
      unsupported: "Dieser Browser kann keine Claim-Erinnerungen empfangen.",
      denied: "Benachrichtigungen sind blockiert. Aktiviere sie in den Browser-Einstellungen fur diese Website.",
      ready: "Gib die verbleibenden Tage ein und speichere die Erinnerung auf diesem Gerat.",
      enabledPush: "Auf diesem Gerat aktiv. Du erhaltst eine Benachrichtigung {earlyAlert} und am letzten Tag.",
      enabledLocal: "Lokale Erinnerung gespeichert. Du erhaltst eine Benachrichtigung {earlyAlert} und am letzten Tag.",
      serverMissing: "Cloudflare Push ist noch nicht konfiguriert. Nur lokale Erinnerungen.",
      busy: "Claim-Erinnerung wird aktualisiert...",
      saved: "Claim-Erinnerung gespeichert.",
      disabled: "Claim-Erinnerung deaktiviert.",
      save: "Speichern / Aktualisieren",
      test: "Test",
      disable: "Deaktivieren",
      labelLabel: "Name der Erinnerung",
      labelPlaceholder: "Automatischer Claim",
      daysLabel: "Verbleibende Tage",
      earlyLabel: "Fruhe Warnung",
      earlySuffix: "Tage vorher",
      summaryEmpty: "Keine Claim-Erinnerung ist aktiv.",
      summaryActive: "{days} Tage verbleibend",
      summaryExpired: "0 Tage verbleibend",
      expiresAt: "Endet etwa am {date}",
      nextAlert: "Nachste Warnung: {date}",
      noFutureAlert: "Keine zukunftige Warnung geplant.",
      summaryLabel: "Status",
      enabledTitle: "Claim-Erinnerung aktiviert",
      enabledBody: "Du erhaltst Claim-Erinnerungen auf diesem Gerat.",
      testTitle: "TCL Claim-Erinnerungstest",
      testBody: "Claim-Erinnerungen funktionieren auf diesem Gerat.",
      invalidDays: "Gib mindestens 1 Tag ein.",
      invalidEarly: "Die fruhe Warnung muss mindestens 1 Tag betragen.",
      earlyAlertOne: "1 Tag vorher",
      earlyAlertMany: "{days} Tage vorher",
      localEarlyTitle: "Claim-Erinnerung: {days} Tage verbleibend",
      localEarlyBody: "{label} endet bald.",
      localFinalTitle: "Claim-Erinnerung: letzter Tag",
      localFinalBody: "{label} ist am letzten Tag."
    },
    es: {
      pageTitle: "Recordatorio de Claim",
      pageIntro: "Mantén los dias de claim automatico separados de las notificaciones de eventos semanales.",
      panelTitle: "Notificaciones de staking claim",
      checking: "Comprobando soporte de notificaciones...",
      unsupported: "Este navegador no puede recibir recordatorios de claim.",
      denied: "Las notificaciones estan bloqueadas. Activalas desde los ajustes del navegador para este sitio.",
      ready: "Introduce los dias restantes y guarda el recordatorio en este dispositivo.",
      enabledPush: "Activo en este dispositivo. Recibiras una notificacion {earlyAlert} y en el ultimo dia.",
      enabledLocal: "Recordatorio local guardado. Recibiras una notificacion {earlyAlert} y en el ultimo dia.",
      serverMissing: "Cloudflare push aun no esta configurado. Solo recordatorios locales.",
      busy: "Actualizando recordatorio de claim...",
      saved: "Recordatorio de claim guardado.",
      disabled: "Recordatorio de claim desactivado.",
      save: "Guardar / Actualizar",
      test: "Prueba",
      disable: "Desactivar",
      labelLabel: "Nombre del recordatorio",
      labelPlaceholder: "Claim automatico",
      daysLabel: "Dias restantes",
      earlyLabel: "Alerta temprana",
      earlySuffix: "dias antes",
      summaryEmpty: "No hay ningun recordatorio de claim activo.",
      summaryActive: "Quedan {days} dias",
      summaryExpired: "Quedan 0 dias",
      expiresAt: "Termina alrededor de {date}",
      nextAlert: "Siguiente alerta: {date}",
      noFutureAlert: "No hay alertas futuras programadas.",
      summaryLabel: "Estado",
      enabledTitle: "Recordatorio de claim activado",
      enabledBody: "Recibiras recordatorios de claim en este dispositivo.",
      testTitle: "Prueba de recordatorio claim TCL",
      testBody: "Los recordatorios de claim funcionan en este dispositivo.",
      invalidDays: "Introduce al menos 1 dia.",
      invalidEarly: "La alerta temprana debe ser de al menos 1 dia.",
      earlyAlertOne: "1 dia antes",
      earlyAlertMany: "{days} dias antes",
      localEarlyTitle: "Recordatorio de claim: quedan {days} dias",
      localEarlyBody: "{label} termina pronto.",
      localFinalTitle: "Recordatorio de claim: ultimo dia",
      localFinalBody: "{label} esta en su ultimo dia."
    },
    fr: {
      pageTitle: "Rappel de Claim",
      pageIntro: "Garde les jours de claim automatique sur une piste de notification separee des evenements hebdomadaires.",
      panelTitle: "Notifications de staking claim",
      checking: "Verification du support des notifications...",
      unsupported: "Ce navigateur ne peut pas recevoir les rappels de claim.",
      denied: "Les notifications sont bloquees. Active-les dans les reglages du navigateur pour ce site.",
      ready: "Saisis les jours restants, puis enregistre le rappel sur cet appareil.",
      enabledPush: "Actif sur cet appareil. Tu recevras une notification {earlyAlert} et le dernier jour.",
      enabledLocal: "Rappel local enregistre. Tu recevras une notification {earlyAlert} et le dernier jour.",
      serverMissing: "Cloudflare push n'est pas encore configure. Rappels locaux uniquement.",
      busy: "Mise a jour du rappel de claim...",
      saved: "Rappel de claim enregistre.",
      disabled: "Rappel de claim desactive.",
      save: "Enregistrer / Mettre a jour",
      test: "Test",
      disable: "Desactiver",
      labelLabel: "Nom du rappel",
      labelPlaceholder: "Claim automatique",
      daysLabel: "Jours restants",
      earlyLabel: "Alerte anticipee",
      earlySuffix: "jours avant",
      summaryEmpty: "Aucun rappel de claim actif.",
      summaryActive: "{days} jours restants",
      summaryExpired: "0 jour restant",
      expiresAt: "Se termine vers {date}",
      nextAlert: "Prochaine alerte : {date}",
      noFutureAlert: "Aucune alerte future programmee.",
      summaryLabel: "Statut",
      enabledTitle: "Rappel de claim active",
      enabledBody: "Tu recevras des rappels de claim sur cet appareil.",
      testTitle: "Test de rappel claim TCL",
      testBody: "Les rappels de claim fonctionnent sur cet appareil.",
      invalidDays: "Saisis au moins 1 jour.",
      invalidEarly: "L'alerte anticipee doit etre d'au moins 1 jour.",
      earlyAlertOne: "1 jour avant",
      earlyAlertMany: "{days} jours avant",
      localEarlyTitle: "Rappel de claim : {days} jours restants",
      localEarlyBody: "{label} expire bientot.",
      localFinalTitle: "Rappel de claim : dernier jour",
      localFinalBody: "{label} est dans son dernier jour."
    },
    it: {
      pageTitle: "Promemoria Claim",
      pageIntro: "Tieni i giorni di claim automatico separati dalle notifiche degli eventi settimanali.",
      panelTitle: "Notifiche staking claim",
      checking: "Verifica supporto notifiche...",
      unsupported: "Questo browser non puo ricevere promemoria claim.",
      denied: "Le notifiche sono bloccate. Abilitale dalle impostazioni del browser per questo sito.",
      ready: "Inserisci i giorni restanti e salva il promemoria su questo dispositivo.",
      enabledPush: "Attivo su questo dispositivo. Riceverai una notifica {earlyAlert} e nell'ultimo giorno.",
      enabledLocal: "Promemoria locale salvato. Riceverai una notifica {earlyAlert} e nell'ultimo giorno.",
      serverMissing: "Cloudflare push non e ancora configurato. Solo promemoria locali.",
      busy: "Aggiornamento promemoria claim...",
      saved: "Promemoria claim salvato.",
      disabled: "Promemoria claim disattivato.",
      save: "Salva / Aggiorna",
      test: "Test",
      disable: "Disattiva",
      labelLabel: "Nome promemoria",
      labelPlaceholder: "Claim automatico",
      daysLabel: "Giorni restanti",
      earlyLabel: "Avviso anticipato",
      earlySuffix: "giorni prima",
      summaryEmpty: "Nessun promemoria claim attivo.",
      summaryActive: "{days} giorni rimasti",
      summaryExpired: "0 giorni rimasti",
      expiresAt: "Termina circa il {date}",
      nextAlert: "Prossimo avviso: {date}",
      noFutureAlert: "Nessun avviso futuro programmato.",
      summaryLabel: "Stato",
      enabledTitle: "Promemoria claim attivato",
      enabledBody: "Riceverai promemoria claim su questo dispositivo.",
      testTitle: "Test promemoria claim TCL",
      testBody: "I promemoria claim funzionano su questo dispositivo.",
      invalidDays: "Inserisci almeno 1 giorno.",
      invalidEarly: "L'avviso anticipato deve essere di almeno 1 giorno.",
      earlyAlertOne: "1 giorno prima",
      earlyAlertMany: "{days} giorni prima",
      localEarlyTitle: "Promemoria claim: {days} giorni rimasti",
      localEarlyBody: "{label} scade presto.",
      localFinalTitle: "Promemoria claim: ultimo giorno",
      localFinalBody: "{label} e nell'ultimo giorno."
    },
    pl: {
      pageTitle: "Przypomnienie Claim",
      pageIntro: "Trzymaj dni automatycznego claim osobno od powiadomien o wydarzeniach tygodniowych.",
      panelTitle: "Powiadomienia staking claim",
      checking: "Sprawdzanie obslugi powiadomien...",
      unsupported: "Ta przegladarka nie moze odbierac przypomnien claim.",
      denied: "Powiadomienia sa zablokowane. Wlacz je w ustawieniach przegladarki dla tej strony.",
      ready: "Wpisz pozostale dni, potem zapisz przypomnienie na tym urzadzeniu.",
      enabledPush: "Aktywne na tym urzadzeniu. Otrzymasz powiadomienie {earlyAlert} i w ostatnim dniu.",
      enabledLocal: "Lokalne przypomnienie zapisane. Otrzymasz powiadomienie {earlyAlert} i w ostatnim dniu.",
      serverMissing: "Cloudflare push nie jest jeszcze skonfigurowany. Tylko lokalne przypomnienia.",
      busy: "Aktualizowanie przypomnienia claim...",
      saved: "Przypomnienie claim zapisane.",
      disabled: "Przypomnienie claim wylaczone.",
      save: "Zapisz / Aktualizuj",
      test: "Test",
      disable: "Wylacz",
      labelLabel: "Nazwa przypomnienia",
      labelPlaceholder: "Automatyczny claim",
      daysLabel: "Pozostale dni",
      earlyLabel: "Wczesny alert",
      earlySuffix: "dni wczesniej",
      summaryEmpty: "Brak aktywnego przypomnienia claim.",
      summaryActive: "Zostalo {days} dni",
      summaryExpired: "Zostalo 0 dni",
      expiresAt: "Konczy sie okolo {date}",
      nextAlert: "Nastepny alert: {date}",
      noFutureAlert: "Brak zaplanowanego przyszlego alertu.",
      summaryLabel: "Status",
      enabledTitle: "Przypomnienie claim wlaczone",
      enabledBody: "Otrzymasz przypomnienia claim na tym urzadzeniu.",
      testTitle: "Test przypomnienia claim TCL",
      testBody: "Przypomnienia claim dzialaja na tym urzadzeniu.",
      invalidDays: "Wpisz co najmniej 1 dzien.",
      invalidEarly: "Wczesny alert musi miec co najmniej 1 dzien.",
      earlyAlertOne: "1 dzien wczesniej",
      earlyAlertMany: "{days} dni wczesniej",
      localEarlyTitle: "Przypomnienie claim: zostalo {days} dni",
      localEarlyBody: "{label} wkrotce wygasa.",
      localFinalTitle: "Przypomnienie claim: ostatni dzien",
      localFinalBody: "{label} jest w ostatnim dniu."
    },
    pt: {
      pageTitle: "Lembrete de Claim",
      pageIntro: "Mantenha os dias de claim automatico em uma trilha separada das notificacoes de eventos semanais.",
      panelTitle: "Notificacoes de staking claim",
      checking: "Verificando suporte a notificacoes...",
      unsupported: "Este navegador nao pode receber lembretes de claim.",
      denied: "As notificacoes estao bloqueadas. Ative-as nas configuracoes do navegador para este site.",
      ready: "Digite os dias restantes e salve o lembrete neste dispositivo.",
      enabledPush: "Ativo neste dispositivo. Voce recebera uma notificacao {earlyAlert} e no ultimo dia.",
      enabledLocal: "Lembrete local salvo. Voce recebera uma notificacao {earlyAlert} e no ultimo dia.",
      serverMissing: "Cloudflare push ainda nao esta configurado. Apenas lembretes locais.",
      busy: "Atualizando lembrete de claim...",
      saved: "Lembrete de claim salvo.",
      disabled: "Lembrete de claim desativado.",
      save: "Salvar / Atualizar",
      test: "Teste",
      disable: "Desativar",
      labelLabel: "Nome do lembrete",
      labelPlaceholder: "Claim automatico",
      daysLabel: "Dias restantes",
      earlyLabel: "Alerta antecipado",
      earlySuffix: "dias antes",
      summaryEmpty: "Nenhum lembrete de claim esta ativo.",
      summaryActive: "{days} dias restantes",
      summaryExpired: "0 dias restantes",
      expiresAt: "Termina por volta de {date}",
      nextAlert: "Proximo alerta: {date}",
      noFutureAlert: "Nenhum alerta futuro agendado.",
      summaryLabel: "Status",
      enabledTitle: "Lembrete de claim ativado",
      enabledBody: "Voce recebera lembretes de claim neste dispositivo.",
      testTitle: "Teste de lembrete claim TCL",
      testBody: "Os lembretes de claim funcionam neste dispositivo.",
      invalidDays: "Digite pelo menos 1 dia.",
      invalidEarly: "O alerta antecipado deve ter pelo menos 1 dia.",
      earlyAlertOne: "1 dia antes",
      earlyAlertMany: "{days} dias antes",
      localEarlyTitle: "Lembrete de claim: {days} dias restantes",
      localEarlyBody: "{label} expira em breve.",
      localFinalTitle: "Lembrete de claim: ultimo dia",
      localFinalBody: "{label} esta no ultimo dia."
    }
  };

  const state = {
    apiBase: "",
    busy: false,
    publicKey: "",
    pushServerConfigured: null,
    statusTimer: null,
    statsTimer: null,
    reminderCount: null,
    lang: "en"
  };

  function getLang() {
    const lang = String(window.currentLang || localStorage.getItem("lang") || navigator.language || "en").toLowerCase();
    const base = lang.split("-")[0];
    return copy[base] ? base : "en";
  }

  function tr(key, vars) {
    const table = copy[getLang()] || copy.en;
    let value = table[key] || copy.en[key] || key;
    Object.entries(vars || {}).forEach(([name, replacement]) => {
      value = value.split(`{${name}}`).join(String(replacement));
    });
    return value;
  }

  function getSettings() {
    try {
      return {
        enabled: false,
        mode: "off",
        label: tr("labelPlaceholder"),
        earlyDays: DEFAULT_EARLY_DAYS,
        expiresAt: null,
        id: "",
        ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {})
      };
    } catch (_) {
      return {
        enabled: false,
        mode: "off",
        label: tr("labelPlaceholder"),
        earlyDays: DEFAULT_EARLY_DAYS,
        expiresAt: null,
        id: ""
      };
    }
  }

  function saveSettings(next) {
    const settings = { ...getSettings(), ...next, updatedAt: new Date().toISOString() };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  function hasPushEventNotifications() {
    try {
      const settings = JSON.parse(localStorage.getItem(EVENT_SETTINGS_KEY) || "{}") || {};
      return Boolean(settings.enabled && settings.mode === "push");
    } catch (_) {
      return false;
    }
  }

  function normalizeApiBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function getDefaultApiBase() {
    try {
      return new URL("api/push", window.location.href).href.replace(/\/+$/, "");
    } catch (_) {
      return "/api/push";
    }
  }

  function getApiBase() {
    if (!state.apiBase) {
      const configured = normalizeApiBase(window.TCL_EVENT_PUSH_CONFIG?.apiBaseUrl);
      state.apiBase = configured || getDefaultApiBase();
    }
    return state.apiBase;
  }

  function supportsNotifications() {
    return Boolean(window.isSecureContext && "serviceWorker" in navigator && "Notification" in window);
  }

  function supportsPush() {
    return supportsNotifications() && "PushManager" in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function requestApi(path, options) {
    const url = `${getApiBase()}/${String(path).replace(/^\/+/, "")}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {})
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function getPushConfig() {
    const fallbackKey = String(window.TCL_EVENT_PUSH_CONFIG?.publicVapidKey || "").trim();
    if (fallbackKey) {
      state.publicKey = fallbackKey;
      state.pushServerConfigured = true;
      return fallbackKey;
    }

    if (state.publicKey || state.pushServerConfigured === false) return state.publicKey;

    try {
      const config = await requestApi("config", { method: "GET" });
      state.publicKey = String(config.publicKey || "").trim();
      state.pushServerConfigured = Boolean(config.configured && state.publicKey);
      return state.publicKey;
    } catch (error) {
      state.pushServerConfigured = false;
      return "";
    }
  }

  function setClaimReminderCountCard(status, count) {
    const card = document.getElementById("claimReminderCountCard");
    const countEl = document.getElementById("claimReminderCount");
    const unit = document.getElementById("claimReminderCountUnit");
    const meta = document.getElementById("claimReminderCountMeta");
    if (!card || !countEl || !meta) return;

    card.dataset.state = status || "loading";
    if (unit) unit.textContent = tr("reminderCountUnit");

    if (Number.isFinite(count)) {
      state.reminderCount = count;
      countEl.textContent = String(count);
      meta.textContent = tr("reminderCountMeta");
      card.setAttribute("aria-label", `${count} ${tr("reminderCountUnit")} ${tr("reminderCountMeta")}`);
      return;
    }

    if (Number.isFinite(state.reminderCount)) {
      countEl.textContent = String(state.reminderCount);
    } else {
      countEl.textContent = "--";
    }
    meta.textContent = status === "error" ? tr("reminderCountError") : tr("reminderCountMeta");
    card.setAttribute("aria-label", `${countEl.textContent} ${tr("reminderCountUnit")} ${meta.textContent}`);
  }

  async function refreshClaimReminderStats() {
    setClaimReminderCountCard("loading");
    try {
      const stats = await requestApi("claim/stats", { method: "GET" });
      setClaimReminderCountCard("ready", Number(stats.reminders));
      return stats;
    } catch (error) {
      console.warn("Claim reminder stats refresh failed", error);
      setClaimReminderCountCard("error");
      return null;
    }
  }

  function startClaimReminderStatsPolling() {
    if (state.statsTimer) return;
    refreshClaimReminderStats();
    state.statsTimer = window.setInterval(refreshClaimReminderStats, STATS_POLL_INTERVAL_MS);

    window.addEventListener("focus", refreshClaimReminderStats);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshClaimReminderStats();
    });
  }

  async function getServiceWorkerRegistration() {
    if (!supportsNotifications()) return null;
    const swUrl = new URL("sw.js", window.location.href);
    const registration = await navigator.serviceWorker.register(swUrl, { updateViaCache: "none" });
    return registration.active ? registration : navigator.serviceWorker.ready;
  }

  function getSubscriptionPayload(subscription) {
    if (!subscription) return null;
    return typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  }

  async function subscribePush(registration) {
    if (!supportsPush()) return null;
    const publicKey = await getPushConfig();
    if (!publicKey) return null;

    const existing = await registration.pushManager.getSubscription();
    return existing || registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  function readForm() {
    const label = String(document.getElementById("claimReminderLabel")?.value || tr("labelPlaceholder")).trim() || tr("labelPlaceholder");
    const days = Math.round(Number(document.getElementById("claimRemainingDays")?.value));
    const earlyDays = Math.round(Number(document.getElementById("claimEarlyDays")?.value || DEFAULT_EARLY_DAYS));
    return { label, days, earlyDays };
  }

  function isValidPositiveDays(value) {
    return Number.isFinite(value) && value >= 1;
  }

  function localUpsert(form) {
    const current = getSettings();
    const now = Date.now();
    return {
      enabled: true,
      mode: "local",
      label: form.label,
      earlyDays: form.earlyDays,
      expiresAt: now + form.days * DAY_MS,
      id: current.id || "",
      lastAction: "set",
      lastInputDays: form.days
    };
  }

  async function upsertReminder() {
    const form = readForm();
    if (!isValidPositiveDays(form.days)) {
      setStatusText("invalidDays");
      return null;
    }
    if (!isValidPositiveDays(form.earlyDays)) {
      setStatusText("invalidEarly");
      return null;
    }

    state.busy = true;
    refreshStatus();

    try {
      if (!supportsNotifications()) throw new Error("Notifications are not supported");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        saveSettings({ enabled: false, mode: "off" });
        return null;
      }

      const registration = await getServiceWorkerRegistration();
      let nextSettings = localUpsert(form);

      try {
        const subscription = await subscribePush(registration);
        if (subscription) {
          const result = await requestApi("claim/upsert", {
            method: "POST",
            body: JSON.stringify({
              action: "set",
              days: form.days,
              earlyDays: form.earlyDays,
              label: form.label,
              subscription: getSubscriptionPayload(subscription),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
              lang: window.currentLang || getLang(),
              userAgent: navigator.userAgent || ""
            })
          });

          if (result.reminder) {
            nextSettings = {
              enabled: true,
              mode: "push",
              id: result.reminder.id || "",
              label: result.reminder.label || form.label,
              earlyDays: Number(result.reminder.earlyDays) || form.earlyDays,
              expiresAt: Number(result.reminder.expiresAt) || nextSettings.expiresAt,
              lastAction: "set",
              lastInputDays: form.days
            };
            state.pushServerConfigured = true;
          }
        }
      } catch (error) {
        console.warn("Claim reminder push upsert failed; local reminder remains available", error);
        state.pushServerConfigured = false;
      }

      const saved = saveSettings(nextSettings);
      syncFormFromSettings(saved);
      await syncLocalSchedule(saved);
      await showImmediate(tr("enabledTitle"), tr("enabledBody"), {
        force: true,
        tag: "tcl-claim-reminder-enabled"
      });
      await refreshClaimReminderStats();
      setStatusText("saved");
      return saved;
    } finally {
      state.busy = false;
      refreshStatus();
    }
  }

  async function unregisterRemoteReminder(registration) {
    if (!supportsPush() || !registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    try {
      await requestApi("claim/delete", {
        method: "POST",
        body: JSON.stringify({ subscription: getSubscriptionPayload(subscription) })
      });
    } catch (error) {
      console.warn("Claim reminder delete API failed", error);
    }

    if (!hasPushEventNotifications()) {
      await subscription.unsubscribe();
    }
  }

  async function disableReminder() {
    state.busy = true;
    refreshStatus();
    try {
      const registration = await getServiceWorkerRegistration().catch(() => null);
      await unregisterRemoteReminder(registration);
      await clearLocalSchedule();
      saveSettings({ enabled: false, mode: "off", expiresAt: null });
      await refreshClaimReminderStats();
      setStatusText("disabled");
    } finally {
      state.busy = false;
      refreshStatus();
    }
  }

  function buildLocalSchedule(settings = getSettings()) {
    if (!settings.enabled || !Number.isFinite(Number(settings.expiresAt))) return [];
    const expiresAt = Number(settings.expiresAt);
    const earlyDays = Math.max(1, Math.round(Number(settings.earlyDays) || DEFAULT_EARLY_DAYS));
    const now = Date.now();
    const maxTriggerAt = now + MAX_LOCAL_WINDOW_MS;
    const label = settings.label || tr("labelPlaceholder");
    const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
    const notifications = [];

    [
      {
        id: `claim:${expiresAt}:early:${earlyDays}`,
        triggerAt: expiresAt - earlyDays * DAY_MS,
        title: tr("localEarlyTitle", { days: daysLeft, label }),
        titleTemplate: tr("localEarlyTitle", { days: "{days}", label }),
        body: tr("localEarlyBody", { label, days: daysLeft })
      },
      {
        id: `claim:${expiresAt}:final`,
        triggerAt: expiresAt - DAY_MS,
        title: tr("localFinalTitle", { days: daysLeft, label }),
        body: tr("localFinalBody", { label, days: daysLeft })
      }
    ].forEach((item) => {
      if (item.triggerAt < now + 15 * 1000 || item.triggerAt > maxTriggerAt) return;
      notifications.push({
        ...item,
        source: "claim",
        type: "claim-reminder",
        expiresAt,
        url: "index.html#claimReminder",
        tag: `tcl-${item.id}`.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()
      });
    });

    return notifications.sort((a, b) => a.triggerAt - b.triggerAt);
  }

  async function postScheduleToServiceWorker(notifications) {
    const registration = await getServiceWorkerRegistration().catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    if (!target) return;
    target.postMessage({
      type: "tcl-claim:schedule",
      notifications
    });
  }

  async function syncLocalSchedule(settings = getSettings()) {
    const notifications = buildLocalSchedule(settings);
    await postScheduleToServiceWorker(notifications).catch((error) => {
      console.warn("Unable to schedule local claim reminders", error);
    });
    return notifications;
  }

  async function clearLocalSchedule() {
    const registration = await getServiceWorkerRegistration().catch(() => null);
    const target = registration?.active || navigator.serviceWorker.controller;
    target?.postMessage({ type: "tcl-claim:clear-schedule" });
  }

  async function showImmediate(title, body, options) {
    const settings = getSettings();
    if (!options?.force && !settings.enabled) return false;
    if (!supportsNotifications() || Notification.permission !== "granted") return false;

    const notificationOptions = {
      body,
      icon: "images/tcl_icon.png",
      badge: "images/tcl_icon.png",
      tag: options?.tag || "tcl-claim-reminder",
      renotify: true,
      data: {
        url: options?.url || "index.html#claimReminder"
      }
    };

    try {
      const registration = await getServiceWorkerRegistration();
      await registration.showNotification(title, notificationOptions);
      return true;
    } catch (error) {
      try {
        new Notification(title, notificationOptions);
        return true;
      } catch (fallbackError) {
        console.warn("Claim notification display failed", fallbackError);
        return false;
      }
    }
  }

  async function testReminder() {
    const settings = getSettings();
    if (!settings.enabled) return;

    if (settings.mode === "push" && supportsPush()) {
      try {
        const registration = await getServiceWorkerRegistration();
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await requestApi("claim/test", {
            method: "POST",
            body: JSON.stringify({
              subscription: getSubscriptionPayload(subscription),
              lang: window.currentLang || getLang(),
              payload: {
                title: tr("testTitle"),
                body: tr("testBody"),
                url: "index.html#claimReminder",
                tag: "tcl-claim-reminder-test"
              }
            })
          });
          return;
        }
      } catch (error) {
        console.warn("Remote claim push test failed; showing local test", error);
      }
    }

    await showImmediate(tr("testTitle"), tr("testBody"), {
      force: true,
      tag: "tcl-claim-reminder-test"
    });
  }

  function formatDate(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return "";
    try {
      return new Intl.DateTimeFormat(navigator.language || "en", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(Number(timestamp)));
    } catch (_) {
      return new Date(Number(timestamp)).toLocaleString();
    }
  }

  function getNextAlert(settings) {
    const expiresAt = Number(settings.expiresAt);
    if (!settings.enabled || !Number.isFinite(expiresAt)) return null;
    const earlyDays = Math.max(1, Math.round(Number(settings.earlyDays) || DEFAULT_EARLY_DAYS));
    const now = Date.now();
    const alerts = [
      expiresAt - earlyDays * DAY_MS,
      expiresAt - DAY_MS
    ].filter((timestamp, index, list) => timestamp > now && list.indexOf(timestamp) === index)
      .sort((left, right) => left - right);
    return alerts[0] || null;
  }

  function formatEarlyAlert(earlyDays) {
    const days = Math.max(1, Math.round(Number(earlyDays) || DEFAULT_EARLY_DAYS));
    return days === 1 ? tr("earlyAlertOne", { days }) : tr("earlyAlertMany", { days });
  }

  function getReminderStatusVars(settings = getSettings()) {
    return {
      earlyAlert: formatEarlyAlert(settings.earlyDays)
    };
  }

  function setStatusText(statusKey, vars) {
    const status = document.getElementById("claimReminderStatus");
    if (status) status.textContent = tr(statusKey, vars);
  }

  function syncStaticCopy() {
    const pairs = [
      ["claimReminderPageTitle", "pageTitle"],
      ["claimReminderPageIntro", "pageIntro"],
      ["claimReminderPanelTitle", "panelTitle"],
      ["claimReminderLabelText", "labelLabel"],
      ["claimRemainingDaysText", "daysLabel"],
      ["claimEarlyDaysText", "earlyLabel"],
      ["claimEarlyDaysSuffix", "earlySuffix"],
      ["claimReminderSummaryLabel", "summaryLabel"]
    ];

    pairs.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = tr(key);
    });

    const labelInput = document.getElementById("claimReminderLabel");
    if (labelInput) labelInput.setAttribute("placeholder", tr("labelPlaceholder"));

    const saveBtn = document.getElementById("saveClaimReminderBtn");
    const testBtn = document.getElementById("testClaimReminderBtn");
    const disableBtn = document.getElementById("disableClaimReminderBtn");
    if (saveBtn) saveBtn.textContent = tr("save");
    if (testBtn) testBtn.textContent = tr("test");
    if (disableBtn) disableBtn.textContent = tr("disable");
  }

  function syncFormFromSettings(settings = getSettings()) {
    const labelInput = document.getElementById("claimReminderLabel");
    const daysInput = document.getElementById("claimRemainingDays");
    const earlyInput = document.getElementById("claimEarlyDays");

    if (labelInput && !labelInput.value.trim()) labelInput.value = settings.label || tr("labelPlaceholder");
    if (earlyInput && document.activeElement !== earlyInput) {
      earlyInput.value = String(settings.earlyDays || DEFAULT_EARLY_DAYS);
    }
    if (daysInput && settings.enabled && Number.isFinite(Number(settings.expiresAt))) {
      if (document.activeElement !== daysInput) {
        daysInput.value = String(Math.max(1, Math.ceil((Number(settings.expiresAt) - Date.now()) / DAY_MS)));
      }
    }
  }

  function renderSummary() {
    const settings = getSettings();
    const summary = document.getElementById("claimReminderSummary");
    const expires = document.getElementById("claimReminderExpiresAt");
    const next = document.getElementById("claimReminderNextAlert");
    const days = document.getElementById("claimReminderDaysLeft");

    if (!summary || !expires || !next || !days) return;

    const expiresAt = Number(settings.expiresAt);
    if (!settings.enabled || !Number.isFinite(expiresAt)) {
      days.textContent = "--";
      summary.textContent = tr("summaryEmpty");
      expires.textContent = "";
      next.textContent = "";
      return;
    }

    const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / DAY_MS));
    days.textContent = String(daysLeft);
    summary.textContent = daysLeft > 0 ? tr("summaryActive", { days: daysLeft }) : tr("summaryExpired");
    expires.textContent = tr("expiresAt", { date: formatDate(expiresAt) });

    const nextAlert = getNextAlert(settings);
    next.textContent = nextAlert
      ? tr("nextAlert", { date: formatDate(nextAlert) })
      : tr("noFutureAlert");
  }

  function refreshStatus() {
    const panel = document.getElementById("claimReminderPanel");
    const saveBtn = document.getElementById("saveClaimReminderBtn");
    const testBtn = document.getElementById("testClaimReminderBtn");
    const disableBtn = document.getElementById("disableClaimReminderBtn");
    if (!panel || !saveBtn || !testBtn || !disableBtn) return;

    syncStaticCopy();
    renderSummary();

    const settings = getSettings();
    panel.dataset.state = settings.enabled ? settings.mode : "ready";

    saveBtn.disabled = state.busy;
    testBtn.disabled = state.busy;
    disableBtn.disabled = state.busy;

    if (state.busy) {
      setStatusText("busy");
      return;
    }

    if (!supportsNotifications()) {
      setStatusText("unsupported");
      saveBtn.hidden = true;
      testBtn.hidden = true;
      disableBtn.hidden = true;
      return;
    }

    if (Notification.permission === "denied") {
      setStatusText("denied");
      saveBtn.hidden = true;
      testBtn.hidden = true;
      disableBtn.hidden = !settings.enabled;
      return;
    }

    saveBtn.hidden = false;
    testBtn.hidden = !settings.enabled;
    disableBtn.hidden = !settings.enabled;

    if (settings.enabled) {
      setStatusText(settings.mode === "push" ? "enabledPush" : "enabledLocal", getReminderStatusVars(settings));
      return;
    }

    setStatusText(state.pushServerConfigured === false ? "serverMissing" : "ready");
  }

  function bindControls() {
    document.getElementById("saveClaimReminderBtn")?.addEventListener("click", () => {
      upsertReminder().catch((error) => {
        console.error("Claim reminder save failed", error);
        state.busy = false;
        refreshStatus();
      });
    });

    document.getElementById("testClaimReminderBtn")?.addEventListener("click", () => {
      testReminder().catch((error) => console.error("Claim reminder test failed", error));
    });

    document.getElementById("disableClaimReminderBtn")?.addEventListener("click", () => {
      disableReminder().catch((error) => {
        console.error("Claim reminder disable failed", error);
        state.busy = false;
        refreshStatus();
      });
    });
  }

  async function boot() {
    state.lang = getLang();
    bindControls();
    syncFormFromSettings();
    refreshStatus();
    setClaimReminderCountCard("loading");
    await getPushConfig();
    refreshStatus();
    startClaimReminderStatsPolling();

    if (getSettings().enabled) {
      await syncLocalSchedule(getSettings());
    }

    if (!state.statusTimer) {
      state.statusTimer = window.setInterval(() => {
        renderSummary();
        syncFormFromSettings(getSettings());
      }, STATUS_TICK_MS);
    }
  }

  window.TCLClaimReminder = {
    save: () => upsertReminder(),
    disable: disableReminder,
    refreshStatus,
    refreshClaimReminderStats,
    syncLocalSchedule,
    setLanguage(lang) {
      state.lang = lang || getLang();
      syncStaticCopy();
      renderSummary();
      refreshStatus();
      setClaimReminderCountCard("ready", state.reminderCount);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot().catch(console.error), { once: true });
  } else {
    boot().catch(console.error);
  }
})();
