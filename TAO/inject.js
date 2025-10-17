(function() {
  console.log("💉 Injecting TAO Wallet into page...");

  window.injectedWeb3 = window.injectedWeb3 || {};

  window.injectedWeb3["tao-wallet"] = {
    version: "1.0.0",
    enable: async (dappName) => {
      console.log(`🔗 ${dappName} is requesting connection...`);
      // Trimite cererea de conectare către background
      window.postMessage({ source: "tao-wallet", type: "connect_request", dappName }, "*");

      // Așteaptă confirmarea din background
      return new Promise((resolve) => {
        const listener = (event) => {
          if (event.data.source === "tao-wallet" && event.data.type === "connect_response") {
            window.removeEventListener("message", listener);
            if (event.data.approved) {
              resolve({
                accounts: {
                  get: async () => [{ address: event.data.address, name: "TAO Wallet" }]
                },
                signer: {
                  signPayload: async (payload) => {
                    window.postMessage({ source: "tao-wallet", type: "sign_request", payload }, "*");
                    return new Promise((res) => {
                      const signListener = (e) => {
                        if (e.data.source === "tao-wallet" && e.data.type === "sign_response") {
                          window.removeEventListener("message", signListener);
                          res({ id: 1, signature: e.data.signature });
                        }
                      };
                      window.addEventListener("message", signListener);
                    });
                  }
                }
              });
            }
          }
        };
        window.addEventListener("message", listener);
      });
    }
  };
})();
