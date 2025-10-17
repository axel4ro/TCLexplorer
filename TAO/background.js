chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "connect_request") {
    chrome.windows.create({
      url: "popup.html?dapp=" + encodeURIComponent(msg.dappName),
      type: "popup",
      width: 420,
      height: 600
    });
  }
});
