// src/index.ts
var DEFAULT_CDN_BASE = "https://releases.revkeen.com/embed";
var DEFAULT_VERSION = "v1";
var SCRIPT_MARKER = "data-revkeen-embed";
var loadPromise = null;
function resolveSrc(options) {
  if (options.scriptSrc) return options.scriptSrc;
  return `${DEFAULT_CDN_BASE}/${options.version ?? DEFAULT_VERSION}/checkout.js`;
}
function loadRevKeenEmbed(options = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(
      new Error("loadRevKeenEmbed must be called in a browser environment")
    );
  }
  if (window.RevKeenEmbed) return Promise.resolve(window.RevKeenEmbed);
  if (loadPromise) return loadPromise;
  const src = resolveSrc(options);
  loadPromise = new Promise((resolve, reject) => {
    const settle = () => {
      if (window.RevKeenEmbed) {
        resolve(window.RevKeenEmbed);
      } else {
        loadPromise = null;
        reject(new Error("RevKeen embed loaded but window.RevKeenEmbed is missing"));
      }
    };
    const fail = () => {
      loadPromise = null;
      reject(new Error(`Failed to load RevKeen embed script: ${src}`));
    };
    const existing = document.querySelector(
      `script[${SCRIPT_MARKER}]`
    );
    if (existing) {
      if (window.RevKeenEmbed) return settle();
      existing.addEventListener("load", settle, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.setAttribute(SCRIPT_MARKER, "true");
    script.addEventListener("load", settle, { once: true });
    script.addEventListener("error", fail, { once: true });
    document.head.appendChild(script);
  });
  return loadPromise;
}

export { loadRevKeenEmbed };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map