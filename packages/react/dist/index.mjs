// src/index.tsx
import {
  createContext,
  createElement as createElement7,
  useContext,
  useEffect as useEffect3,
  useMemo,
  useState as useState4,
  useSyncExternalStore
} from "react";

// src/store.ts
import {
  RevKeenEnvironment,
  RevKeenPublishableClient
} from "@revkeen/js";

// src/elements/channel.ts
var BUILDER_CHANNELS = [
  "framer",
  "lovable",
  "v0",
  "bolt",
  "webflow",
  "wordpress",
  "react",
  "script",
  // REV-8549: the managed RevKeen Storefront (apps/storefront).
  "storefront"
];
var CHECKOUT_CHANNEL_PARAM = "rk_channel";
var MAX_RAW_CHANNEL_LENGTH = 32;
var CHANNEL_SET = new Set(BUILDER_CHANNELS);
function normalizeBuilderChannel(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_RAW_CHANNEL_LENGTH) return null;
  const candidate = raw.trim().toLowerCase();
  return CHANNEL_SET.has(candidate) ? candidate : null;
}
function withChannel(url, channel) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const normalized = normalizeBuilderChannel(channel);
  if (normalized) parsed.searchParams.set(CHECKOUT_CHANNEL_PARAM, normalized);
  return parsed.toString();
}

// src/elements/hosts.ts
var API_ORIGINS = /* @__PURE__ */ new Set([
  "https://api.revkeen.com",
  "https://staging-api.revkeen.com"
]);
var CHECKOUT_ORIGINS = /* @__PURE__ */ new Set([
  "https://pay.revkeen.com",
  "https://checkout.revkeen.com",
  "https://pay.staging.revkeen.com",
  "https://checkout.staging.revkeen.com"
]);
function allowlistedCheckoutUrl(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return CHECKOUT_ORIGINS.has(url.origin) ? url.toString() : null;
}

// src/elements/portal.ts
var DEFAULT_PORTAL_ORIGIN = "https://pay.revkeen.com";
var MERCHANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
async function fetchMerchantPortalSlug(options) {
  const doFetch = options.fetch ?? fetch;
  let response;
  try {
    response = await doFetch(`${options.apiOrigin}/public/embed/config`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${options.publishableKey}` },
      signal: options.signal
    });
  } catch {
    return { status: "error" };
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return { status: "unavailable" };
  }
  if (!response.ok) return { status: "error" };
  let body;
  try {
    body = await response.json();
  } catch {
    return { status: "error" };
  }
  const slug = body?.data?.merchant_slug;
  if (typeof slug !== "string" || !MERCHANT_SLUG_RE.test(slug)) return { status: "unavailable" };
  return { status: "ready", slug };
}
function customerPortalUrl(slug, checkoutOrigin) {
  if (!MERCHANT_SLUG_RE.test(slug)) return null;
  let origin = DEFAULT_PORTAL_ORIGIN;
  if (checkoutOrigin) {
    try {
      const candidate = new URL(checkoutOrigin).origin;
      if (CHECKOUT_ORIGINS.has(candidate)) origin = candidate;
    } catch {
    }
  }
  return `${origin}/portal/${slug}`;
}

// src/store.ts
var DEFAULT_BASE_URL = "https://api.revkeen.com/v2";
var DEFAULT_STORAGE_KEY = "revkeen:react:cart_session_id";
var PUBLISHABLE_PREFIX = /^rk_pk_/;
function assertPublishableKey(key) {
  if (!key || typeof key !== "string") {
    throw new Error("[revkeen-react] publishableKey is required.");
  }
  if (!PUBLISHABLE_PREFIX.test(key)) {
    throw new Error(
      "[revkeen-react] refusing a non-publishable key: browser code must use an rk_pk_* key. Never expose secret keys to the browser."
    );
  }
}
function countLines(cart) {
  if (!cart) return 0;
  return cart.line_items.reduce(
    (sum, line) => sum + (Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0),
    0
  );
}
function recordErrorCode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value;
  if (typeof record.code === "string") return record.code;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object" && !Array.isArray(record.error)) {
    const nestedCode = record.error.code;
    if (typeof nestedCode === "string") return nestedCode;
  }
  return null;
}
function errorCode(err) {
  if (!err || typeof err !== "object") return null;
  const anyErr = err;
  const directCode = typeof anyErr.code === "string" ? anyErr.code : null;
  if (directCode && directCode !== "unknown_error") return directCode;
  if (typeof anyErr.error === "string") return anyErr.error;
  const bodyCode = recordErrorCode(anyErr.body) ?? recordErrorCode(anyErr.rawBody);
  if (bodyCode) return bodyCode;
  const message = typeof anyErr.message === "string" ? anyErr.message : "";
  if (message.includes("CART_DISABLED")) return "CART_DISABLED";
  return directCode;
}
var CartStore = class {
  state = {
    status: "idle",
    cart: null,
    count: 0,
    error: null,
    disabled: false,
    checkoutUrl: null
  };
  listeners = /* @__PURE__ */ new Set();
  client;
  storage;
  storageKey;
  currency;
  checkoutBaseUrl;
  channel;
  apiOrigin;
  publishableKey;
  fetchImpl;
  portalLookup = null;
  constructor(options) {
    assertPublishableKey(options.publishableKey);
    const clientOptions = {
      publishableKey: options.publishableKey,
      ...options.fetch ? { fetch: options.fetch } : {}
    };
    this.client = options.baseUrl ? RevKeenPublishableClient.forCustomBaseUrl(options.baseUrl, clientOptions) : new RevKeenPublishableClient({
      ...clientOptions,
      environment: RevKeenEnvironment.Production
    });
    this.storage = options.storage !== void 0 ? options.storage : typeof localStorage !== "undefined" ? localStorage : null;
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.currency = options.currency;
    this.checkoutBaseUrl = (options.checkoutBaseUrl ?? "https://pay.revkeen.com").replace(/\/$/, "");
    this.channel = normalizeBuilderChannel(options.channel);
    this.publishableKey = options.publishableKey;
    this.fetchImpl = options.fetch;
    this.apiOrigin = "https://api.revkeen.com";
    if (options.baseUrl) {
      try {
        this.apiOrigin = new URL(options.baseUrl).origin;
      } catch {
      }
    }
  }
  /**
   * The customer-portal URL for this store's merchant (REV-8559 element 9).
   * The merchant slug is read from RevKeen (`GET /public/embed/config`, which
   * resolves the merchant from the publishable key), never taken from the page.
   * A successful or "unavailable" answer is cached for the store's lifetime; an
   * error is not, so a later render can retry.
   */
  getCustomerPortalUrl() {
    if (this.portalLookup) return this.portalLookup;
    const lookup = fetchMerchantPortalSlug({
      apiOrigin: this.apiOrigin,
      publishableKey: this.publishableKey,
      ...this.fetchImpl ? { fetch: this.fetchImpl } : {}
    }).then((result) => {
      if (result.status !== "ready") return result;
      const url = customerPortalUrl(result.slug, this.checkoutBaseUrl);
      return url ? { status: "ready", url } : { status: "unavailable" };
    });
    this.portalLookup = lookup;
    void lookup.then((result) => {
      if (result.status === "error" && this.portalLookup === lookup) this.portalLookup = null;
    });
    return lookup;
  }
  /**
   * REV-8573: prefer the server's checkout_url, but only on an allowlisted
   * RevKeen checkout host (REV-8559/8582/8684) and only for this session's
   * /p/{token}. Otherwise the pre-existing token + checkoutBaseUrl build; a
   * rejected checkout_url is never followed.
   */
  checkoutUrlFor(session, channel) {
    const token = session?.session_token;
    if (!token) throw new Error("Checkout session token missing from response");
    const path = `/p/${encodeURIComponent(token)}`;
    const server = allowlistedCheckoutUrl(session?.checkout_url);
    if (server) {
      const url = new URL(server);
      if (url.pathname === path && !url.search && !url.hash) {
        url.searchParams.set("rk_source", "react");
        if (channel) url.searchParams.set(CHECKOUT_CHANNEL_PARAM, channel);
        return url.toString();
      }
    }
    const base = `${this.checkoutBaseUrl}${path}?rk_source=react`;
    return channel ? `${base}&${CHECKOUT_CHANNEL_PARAM}=${channel}` : base;
  }
  channelMetadata(channel) {
    return channel ? { metadata: { channel } } : {};
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;
  setState(patch) {
    this.state = { ...this.state, ...patch };
    if (patch.cart !== void 0) {
      this.state = { ...this.state, count: countLines(this.state.cart) };
    }
    for (const listener of this.listeners) listener();
  }
  handleError(err) {
    const code = errorCode(err);
    if (code === "CART_DISABLED") {
      this.setState({
        status: "disabled",
        disabled: true,
        error: "Cart is not enabled for this merchant."
      });
      return;
    }
    this.setState({
      status: "error",
      error: err instanceof Error ? err.message : String(err)
    });
  }
  storedCartId() {
    try {
      return this.storage?.getItem(this.storageKey) ?? null;
    } catch {
      return null;
    }
  }
  persistCartId(id) {
    try {
      if (id === null) this.storage?.removeItem(this.storageKey);
      else this.storage?.setItem(this.storageKey, id);
    } catch {
    }
  }
  /** Load a persisted cart if one exists. Safe to call repeatedly. */
  async hydrate() {
    const cartId = this.storedCartId();
    if (!cartId) return;
    this.setState({ status: "loading", error: null });
    try {
      const response = await this.client.cart.sessionsGet(cartId);
      this.setState({ status: "ready", cart: response.data ?? null });
    } catch (err) {
      this.persistCartId(null);
      if (errorCode(err) === "CART_DISABLED") this.handleError(err);
      else this.setState({ status: "idle", cart: null, error: null });
    }
  }
  async addItem(item) {
    this.setState({ status: "loading", error: null });
    try {
      const cartId = this.state.cart?.id ?? this.storedCartId();
      let response;
      if (cartId) {
        response = await this.client.cart.sessionsAddLineItem(cartId, {
          product_id: item.productId,
          price_id: item.priceId ?? void 0,
          quantity: item.quantity ?? 1
        });
      } else {
        response = await this.client.cart.sessionsCreate({
          currency: this.currency,
          ...this.channelMetadata(this.channel),
          line_items: [
            {
              product_id: item.productId,
              price_id: item.priceId ?? void 0,
              quantity: item.quantity ?? 1
            }
          ]
        });
      }
      const cart = response.data ?? null;
      if (cart?.id) this.persistCartId(cart.id);
      this.setState({ status: "ready", cart });
    } catch (err) {
      this.handleError(err);
    }
  }
  async updateQuantity(lineId, quantity) {
    const cartId = this.state.cart?.id;
    if (!cartId) return;
    this.setState({ status: "loading", error: null });
    try {
      const response = await this.client.cart.sessionsUpdateLineItem({
        path: { id: cartId, lineId },
        body: { quantity }
      });
      this.setState({ status: "ready", cart: response.data ?? null });
    } catch (err) {
      this.handleError(err);
    }
  }
  async removeLine(lineId) {
    const cartId = this.state.cart?.id;
    if (!cartId) return;
    this.setState({ status: "loading", error: null });
    try {
      const response = await this.client.cart.sessionsRemoveLineItem({
        id: cartId,
        lineId
      });
      this.setState({ status: "ready", cart: response.data ?? null });
    } catch (err) {
      this.handleError(err);
    }
  }
  async applyDiscount(code) {
    const cartId = this.state.cart?.id;
    if (!cartId) return;
    this.setState({ status: "loading", error: null });
    try {
      const response = await this.client.cart.sessionsApplyDiscountCode(cartId, {
        code
      });
      this.setState({ status: "ready", cart: response.data ?? null });
    } catch (err) {
      this.handleError(err);
    }
  }
  /**
   * Convert the cart to a hosted checkout session. Returns the checkout URL
   * (also exposed on state.checkoutUrl); navigation is the caller's choice.
   */
  async checkout() {
    const cartId = this.state.cart?.id;
    if (!cartId) return null;
    this.setState({ status: "loading", error: null });
    try {
      const response = await this.client.cart.sessionsConvert(cartId);
      const checkoutUrl = this.checkoutUrlFor(response.data?.checkout_session, this.channel);
      this.persistCartId(null);
      this.setState({ status: "ready", checkoutUrl });
      return checkoutUrl;
    } catch (err) {
      this.handleError(err);
      return null;
    }
  }
  /**
   * Buy now: create a one-product cart, convert it, and return the hosted
   * checkout URL. The shopper's persisted cart (state.cart / storage) is not
   * read or replaced, so "Buy now" never discards a basket in progress. The
   * server prices the line; no amount is sent.
   */
  async buyNow(item) {
    const channel = item.channel === void 0 ? this.channel : normalizeBuilderChannel(item.channel);
    try {
      const created = await this.client.cart.sessionsCreate({
        currency: this.currency,
        ...this.channelMetadata(channel),
        line_items: [
          {
            product_id: item.productId,
            price_id: item.priceId ?? void 0,
            quantity: item.quantity ?? 1
          }
        ]
      });
      const cartId = created.data?.id;
      if (!cartId) throw new Error("Cart session id missing from response");
      const converted = await this.client.cart.sessionsConvert(cartId);
      return this.checkoutUrlFor(converted.data?.checkout_session, channel);
    } catch (err) {
      this.handleError(err);
      return null;
    }
  }
  /** Publishable-key product read for pickers/cards. */
  async listProducts(query) {
    const response = await this.client.storefront.productsList(query);
    return (response.data ?? []).map(normalizeProduct);
  }
  async getProduct(idOrSlug) {
    const response = await this.client.storefront.productsGet(idOrSlug);
    return normalizeProduct(response.data);
  }
};
function normalizeProduct(product) {
  return {
    ...product,
    availability: product.availability ?? {
      status: "unknown",
      remaining: null,
      display_mode: "hidden",
      low_stock_threshold: null
    }
  };
}
function isSoldOut(product) {
  return product.availability?.status === "soldout";
}

// src/elements/keys.ts
import { createElement } from "react";
var SECRET_KEY_PREFIXES = ["rk_sk_", "rk_live_", "rk_sandbox_", "rk_int_"];
function classifyKey(value) {
  if (value === void 0 || value === null || value === "") return "missing";
  if (typeof value !== "string") return "invalid";
  const key = value.trim();
  if (!key) return "missing";
  if (key.startsWith("rk_pk_")) return "publishable";
  if (key.startsWith("rk_")) return "secret";
  return "invalid";
}
function containsSecretKey(values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const matches = value.match(/rk_[A-Za-z0-9_]+/g) ?? [];
    if (matches.some((token) => classifyKey(token) === "secret")) return true;
  }
  return false;
}
var SECRET_KEY_WARNING = "RevKeen: this element was given a secret key and will not load. Use a publishable key (rk_pk_\u2026) and remove the secret key from this page.";
var INVALID_KEY_WARNING = "RevKeen: this element needs a publishable key (rk_pk_\u2026) and will not load without one.";
function KeyWarning({ kind }) {
  return createElement(
    "p",
    { role: "alert", className: "rk-key-warning", "data-revkeen-state": "blocked" },
    kind === "secret" ? SECRET_KEY_WARNING : INVALID_KEY_WARNING
  );
}

// src/components.tsx
import {
  createElement as createElement2,
  Fragment,
  useState
} from "react";

// ../shared/dist/money.js
var CURRENCY_EXPONENTS = Object.freeze({
  AED: 2,
  AFN: 2,
  ALL: 2,
  AMD: 2,
  AOA: 2,
  ARS: 2,
  AUD: 2,
  AWG: 2,
  AZN: 2,
  BAM: 2,
  BBD: 2,
  BDT: 2,
  BHD: 3,
  BIF: 0,
  BMD: 2,
  BND: 2,
  BOB: 2,
  BOV: 2,
  BRL: 2,
  BSD: 2,
  BTN: 2,
  BWP: 2,
  BYN: 2,
  BZD: 2,
  CAD: 2,
  CDF: 2,
  CHE: 2,
  CHF: 2,
  CHW: 2,
  CLF: 4,
  CLP: 0,
  CNY: 2,
  COP: 2,
  COU: 2,
  CRC: 2,
  CUP: 2,
  CVE: 2,
  CZK: 2,
  DJF: 0,
  DKK: 2,
  DOP: 2,
  DZD: 2,
  EGP: 2,
  ERN: 2,
  ETB: 2,
  EUR: 2,
  FJD: 2,
  FKP: 2,
  GBP: 2,
  GEL: 2,
  GHS: 2,
  GIP: 2,
  GMD: 2,
  GNF: 0,
  GTQ: 2,
  GYD: 2,
  HKD: 2,
  HNL: 2,
  HTG: 2,
  HUF: 2,
  IDR: 2,
  ILS: 2,
  INR: 2,
  IQD: 3,
  IRR: 2,
  ISK: 0,
  JMD: 2,
  JOD: 3,
  JPY: 0,
  KES: 2,
  KGS: 2,
  KHR: 2,
  KMF: 0,
  KPW: 2,
  KRW: 0,
  KWD: 3,
  KYD: 2,
  KZT: 2,
  LAK: 2,
  LBP: 2,
  LKR: 2,
  LRD: 2,
  LSL: 2,
  LYD: 3,
  MAD: 2,
  MDL: 2,
  MGA: 2,
  MKD: 2,
  MMK: 2,
  MNT: 2,
  MOP: 2,
  MRU: 2,
  MUR: 2,
  MVR: 2,
  MWK: 2,
  MXN: 2,
  MXV: 2,
  MYR: 2,
  MZN: 2,
  NAD: 2,
  NGN: 2,
  NIO: 2,
  NOK: 2,
  NPR: 2,
  NZD: 2,
  OMR: 3,
  PAB: 2,
  PEN: 2,
  PGK: 2,
  PHP: 2,
  PKR: 2,
  PLN: 2,
  PYG: 0,
  QAR: 2,
  RON: 2,
  RSD: 2,
  RUB: 2,
  RWF: 0,
  SAR: 2,
  SBD: 2,
  SCR: 2,
  SDG: 2,
  SEK: 2,
  SGD: 2,
  SHP: 2,
  SLE: 2,
  SOS: 2,
  SRD: 2,
  SSP: 2,
  STN: 2,
  SVC: 2,
  SYP: 2,
  SZL: 2,
  THB: 2,
  TJS: 2,
  TMT: 2,
  TND: 3,
  TOP: 2,
  TRY: 2,
  TTD: 2,
  TWD: 2,
  TZS: 2,
  UAH: 2,
  UGX: 0,
  USD: 2,
  USN: 2,
  UYI: 0,
  UYU: 2,
  UYW: 4,
  UZS: 2,
  VED: 2,
  VES: 2,
  VND: 0,
  VUV: 0,
  WST: 2,
  XAD: 2,
  XAF: 0,
  XCD: 2,
  XCG: 2,
  XOF: 0,
  XPF: 0,
  YER: 2,
  ZAR: 2,
  ZMW: 2,
  ZWG: 2,
  // Historical codes retained so immutable documents remain renderable.
  ANG: 2,
  BGN: 2,
  HRK: 2,
  ZWL: 2
});
var ASCII_CURRENCY_CODE = /^[A-Za-z]{3}$/;
var CurrencyMetadataError = class extends RangeError {
  code = "CURRENCY_METADATA_UNAVAILABLE";
  currency;
  subject;
  constructor(message, options) {
    super(message);
    this.name = "CurrencyMetadataError";
    this.currency = options.currency;
    this.subject = options.subject;
  }
};
function subjectSuffix(context) {
  return context?.subject ? ` for ${context.subject}` : "";
}
function normalizeCurrencyCode(currency, context) {
  if (currency === null || currency === void 0 || currency === "") {
    throw new CurrencyMetadataError(
      `Currency is required${subjectSuffix(context)}`,
      { currency, subject: context?.subject }
    );
  }
  if (typeof currency !== "string" || !ASCII_CURRENCY_CODE.test(currency)) {
    throw new CurrencyMetadataError(
      `Currency must be a three-letter ASCII code${subjectSuffix(context)}`,
      { currency, subject: context?.subject }
    );
  }
  return currency.toUpperCase();
}
function resolveCurrencyExponent(currency, context) {
  const normalized = normalizeCurrencyCode(currency, context);
  const exponent = CURRENCY_EXPONENTS[normalized];
  if (exponent === void 0) {
    throw new CurrencyMetadataError(
      `Currency ${normalized} has no supported minor-unit exponent${subjectSuffix(context)}`,
      { currency: normalized, subject: context?.subject }
    );
  }
  return exponent;
}
var NON_ASCII_SPACE = /[\u00A0\u202F]/g;
function toMinorUnits(amountMinor) {
  if (typeof amountMinor === "bigint") {
    return amountMinor;
  }
  if (!Number.isFinite(amountMinor) || !Number.isSafeInteger(amountMinor)) {
    throw new RangeError("amountMinor must be a finite safe integer or bigint");
  }
  return BigInt(amountMinor);
}
function localizeDigits(value, locale) {
  const digitFormatter = new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 0
  });
  const localizedDigits = /* @__PURE__ */ new Map();
  return value.replace(/\d/g, (digit) => {
    const cached = localizedDigits.get(digit);
    if (cached !== void 0) {
      return cached;
    }
    const localized = digitFormatter.format(Number(digit));
    localizedDigits.set(digit, localized);
    return localized;
  });
}
function formatMinorCurrency(money, options) {
  const currencyExponent = resolveCurrencyExponent(money.currency, options);
  const currency = String(money.currency).toUpperCase();
  const amountMinor = toMinorUnits(money.amountMinor);
  const isNegative = amountMinor < 0n;
  const absoluteMinor = isNegative ? -amountMinor : amountMinor;
  const divisor = 10n ** BigInt(currencyExponent);
  const majorUnits = absoluteMinor / divisor;
  const remainder = absoluteMinor % divisor;
  const locale = options?.locale ?? "en-US";
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: currencyExponent,
    maximumFractionDigits: currencyExponent
  });
  const displayMajorUnits = isNegative ? majorUnits === 0n ? -0 : -majorUnits : majorUnits;
  const fraction = remainder.toString().padStart(currencyExponent, "0");
  const localizedFraction = currencyExponent === 0 ? "" : localizeDigits(fraction, locale);
  return formatter.formatToParts(displayMajorUnits).map((part) => part.type === "fraction" ? localizedFraction : part.value).join("").replace(NON_ASCII_SPACE, " ");
}

// src/display.ts
function asPrice(value) {
  if (!value || typeof value.id !== "string" || typeof value.currency !== "string") {
    return null;
  }
  return value;
}
function selectPrice(product, priceId) {
  const prices = (product.prices ?? []).map(asPrice).filter(
    (price) => price !== null
  );
  if (priceId) return prices.find((price) => price.id === priceId) ?? null;
  if (product.default_price_id) {
    const match = prices.find((price) => price.id === product.default_price_id);
    if (match) return match;
  }
  return prices[0] ?? null;
}
function formatMinorAmount(amountMinor, currency, locale) {
  try {
    return formatMinorCurrency({ amountMinor, currency }, locale ? { locale } : void 0);
  } catch {
    return null;
  }
}
function cadenceSuffix(price) {
  if (!price.interval) return "";
  if (price.interval_count && price.interval_count > 1) {
    return ` every ${price.interval_count} ${price.interval}s`;
  }
  return `/${price.interval}`;
}
function priceLabel(product, options = {}) {
  const price = selectPrice(product, options.priceId);
  if (!price) return { kind: "unavailable", text: null, amount: null, price: null };
  if (price.usage_type || price.unit_amount === null || price.unit_amount === void 0) {
    return { kind: "usage", text: "Usage-based", amount: null, price };
  }
  const amount = formatMinorAmount(price.unit_amount, price.currency, options.locale);
  if (amount === null) return { kind: "unavailable", text: null, amount: null, price };
  let text = `${amount}${cadenceSuffix(price)}`;
  if (price.trial_period_days && price.trial_period_days > 0) {
    text += ` \xB7 ${price.trial_period_days}-day trial`;
  }
  return { kind: "flat", text, amount, price };
}
function availabilityLabel(product) {
  const availability = product.availability;
  if (!availability || availability.status === "unknown") return null;
  if (availability.status === "soldout") return "Sold out";
  if (availability.display_mode === "hidden") return null;
  if (availability.display_mode === "exact" && availability.remaining !== null) {
    return `${availability.remaining} left`;
  }
  if (availability.status === "low") return "Low availability";
  return "In stock";
}

// src/elements/definitions.ts
var GRID_MAX_ITEMS = 12;
var PRICING_MAX_PLANS = 4;
var PRICE_NAME_RE = /amount|price|currency|cost|total|unit_?amount/i;
var PRICE_ID_EXCEPTIONS = ["priceId", "data-revkeen-price-id"];
var PRICE_DISPLAY_TOGGLES = ["showPrice", "data-revkeen-show-price"];
var BUTTON_VARIANTS = ["outline", "solid", "plain"];
var BUTTON_SIZES = ["sm", "md", "lg"];
var BUTTON_RADII = ["none", "sm", "md", "full"];
var STYLE_OPTIONS = [
  {
    prop: "variant",
    attribute: "data-revkeen-variant",
    type: "enum",
    values: BUTTON_VARIANTS,
    description: "Button look. Colours come from the page (`currentColor`, or `--rk-accent` for solid)."
  },
  { prop: "size", attribute: "data-revkeen-size", type: "enum", values: BUTTON_SIZES, description: "Button size." },
  {
    prop: "radius",
    attribute: "data-revkeen-radius",
    type: "enum",
    values: BUTTON_RADII,
    description: "Button corner radius."
  },
  { prop: "buttonLabel", attribute: "data-revkeen-button-label", type: "string", description: "Button text." }
];
var LOCALE_OPTION = {
  prop: "locale",
  attribute: "data-revkeen-locale",
  type: "string",
  description: "Number-format locale, e.g. en-GB. Defaults to the browser's."
};
var PAYMENT_LINK_OPTION = {
  prop: "paymentLink",
  attribute: "data-revkeen-payment-link",
  type: "string",
  description: "Payment-link URL or id. The price is read live from RevKeen."
};
var BUILDER_ELEMENTS = {
  "buy-button": {
    key: "buy-button",
    title: "Buy button",
    marker: "data-revkeen-buy-button",
    requires: "none",
    options: [
      { ...PAYMENT_LINK_OPTION, required: true },
      {
        prop: "showPrice",
        attribute: "data-revkeen-show-price",
        type: "boolean",
        description: "Show RevKeen's live price for the link next to the button (default on)."
      },
      LOCALE_OPTION,
      ...STYLE_OPTIONS
    ]
  },
  "live-price": {
    key: "live-price",
    title: "Live price",
    marker: "data-revkeen-live-price",
    requires: "none-or-publishable-key",
    options: [
      PAYMENT_LINK_OPTION,
      {
        prop: "productId",
        attribute: "data-revkeen-product-id",
        type: "string",
        description: "Product UUID, reference or slug (needs a publishable key) instead of a payment link."
      },
      {
        prop: "priceId",
        attribute: "data-revkeen-price-id",
        type: "string",
        description: "Which of the product's prices. Defaults to the product's default price."
      },
      LOCALE_OPTION
    ]
  },
  "product-card": {
    key: "product-card",
    title: "Product card",
    marker: "data-revkeen-product-card",
    requires: "publishable-key",
    snippetDefaults: { mode: "checkout" },
    options: [
      {
        prop: "productId",
        attribute: "data-revkeen-product-id",
        type: "string",
        required: true,
        description: "Product UUID, reference or slug."
      },
      {
        prop: "mode",
        attribute: "data-revkeen-mode",
        type: "enum",
        values: ["cart", "checkout", "none"],
        description: "Add to cart, go straight to checkout, or no button."
      },
      { prop: "showImage", attribute: "data-revkeen-show-image", type: "boolean", description: "Show the image." },
      {
        prop: "showDescription",
        attribute: "data-revkeen-show-description",
        type: "boolean",
        description: "Show the description."
      },
      LOCALE_OPTION,
      ...STYLE_OPTIONS
    ]
  },
  "product-grid": {
    key: "product-grid",
    title: "Product grid",
    marker: "data-revkeen-product-grid",
    requires: "publishable-key",
    snippetDefaults: { mode: "checkout" },
    options: [
      {
        prop: "productIds",
        attribute: "data-revkeen-product-ids",
        type: "string-list",
        description: "Comma-separated products to show, in order. Empty shows the merchant's products."
      },
      {
        prop: "limit",
        attribute: "data-revkeen-limit",
        type: "string",
        description: "Maximum products shown (1\u201312; the grid never shows more than 12)."
      },
      {
        prop: "mode",
        attribute: "data-revkeen-mode",
        type: "enum",
        values: ["cart", "checkout", "none"],
        description: "Add to cart, go straight to checkout, or no button."
      },
      { prop: "showImage", attribute: "data-revkeen-show-image", type: "boolean", description: "Show images." },
      {
        prop: "showDescription",
        attribute: "data-revkeen-show-description",
        type: "boolean",
        description: "Show descriptions."
      },
      LOCALE_OPTION,
      ...STYLE_OPTIONS
    ]
  },
  "pricing-table": {
    key: "pricing-table",
    title: "Pricing table",
    marker: "data-revkeen-pricing-table",
    requires: "none-or-publishable-key",
    options: [
      {
        prop: "paymentLinks",
        attribute: "data-revkeen-payment-links",
        type: "string-list",
        description: "Comma-separated payment links, one per plan and billing interval (no key needed)."
      },
      {
        prop: "productIds",
        attribute: "data-revkeen-product-ids",
        type: "string-list",
        description: "Comma-separated products whose prices form the plans (needs a publishable key)."
      },
      LOCALE_OPTION,
      ...STYLE_OPTIONS
    ]
  },
  "thank-you": {
    key: "thank-you",
    title: "Thank-you section",
    marker: "data-revkeen-thank-you",
    requires: "none",
    options: [
      {
        prop: "heading",
        attribute: "data-revkeen-heading",
        type: "string",
        description: "Heading shown when the buyer returns from checkout."
      }
    ]
  },
  "manage-subscription": {
    key: "manage-subscription",
    title: "Manage subscription link",
    marker: "data-revkeen-manage-subscription",
    // The merchant slug is read from RevKeen for the publishable key; it is
    // never an option, so a page cannot choose which portal the link opens.
    requires: "publishable-key",
    options: [...STYLE_OPTIONS]
  }
};
var FORBIDDEN_PRICE_INPUTS = [
  "amount",
  "amountMinor",
  "amount_minor",
  "unitAmount",
  "unit_amount",
  "price",
  "priceText",
  "currency",
  "total",
  "data-amount",
  "data-price",
  "data-currency",
  "data-revkeen-price",
  "data-revkeen-amount",
  "data-revkeen-currency"
];
function isForbidden(name) {
  const lower = name.toLowerCase();
  return FORBIDDEN_PRICE_INPUTS.some((forbidden) => forbidden.toLowerCase() === lower);
}
var FORBIDDEN_LOWER = new Set(FORBIDDEN_PRICE_INPUTS.map((name) => name.toLowerCase()));
function stripPriceInputs(props) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (!FORBIDDEN_LOWER.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}
var DISPLAY_TOGGLES = new Set(PRICE_DISPLAY_TOGGLES);
for (const definition of Object.values(BUILDER_ELEMENTS)) {
  for (const option of definition.options) {
    if (isForbidden(option.prop) || isForbidden(option.attribute)) {
      throw new Error(`[revkeen-react] element ${definition.key} declares a price input: ${option.prop}`);
    }
    const toggle = DISPLAY_TOGGLES.has(option.prop) || DISPLAY_TOGGLES.has(option.attribute);
    if (toggle && option.type !== "boolean") {
      throw new Error(`[revkeen-react] element ${definition.key}: ${option.prop} must be a boolean toggle`);
    }
  }
}
function parseBoolean(value) {
  const lower = value.trim().toLowerCase();
  if (lower === "" || lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return void 0;
}
function propsFromAttributes(key, getAttribute) {
  const props = { ...BUILDER_ELEMENTS[key].snippetDefaults ?? {} };
  for (const option of BUILDER_ELEMENTS[key].options) {
    const raw = getAttribute(option.attribute);
    if (raw === null) continue;
    switch (option.type) {
      case "string": {
        const value = raw.trim();
        if (value) props[option.prop] = value;
        break;
      }
      case "string-list": {
        const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
        if (list.length > 0) props[option.prop] = list;
        break;
      }
      case "boolean": {
        const value = parseBoolean(raw);
        if (value !== void 0) props[option.prop] = value;
        break;
      }
      case "enum": {
        const value = raw.trim().toLowerCase();
        if (option.values?.includes(value)) props[option.prop] = value;
        break;
      }
    }
  }
  if (typeof props.limit === "string") {
    const limit = Number.parseInt(props.limit, 10);
    if (Number.isInteger(limit) && limit >= 1) props.limit = Math.min(limit, GRID_MAX_ITEMS);
    else delete props.limit;
  }
  return props;
}
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderSnippet(key, values) {
  const definition = BUILDER_ELEMENTS[key];
  const attributes = [definition.marker];
  for (const option of definition.options) {
    const value = values[option.prop];
    if (value === void 0 || isForbidden(option.prop)) continue;
    let text;
    if (Array.isArray(value)) text = value.join(",");
    else if (typeof value === "boolean") text = value ? "true" : "false";
    else text = String(value);
    if (option.type === "enum" && !option.values?.includes(text)) continue;
    attributes.push(`${option.attribute}="${escapeAttribute(text)}"`);
  }
  return `<div ${attributes.join(" ")}></div>`;
}

// src/elements/style.ts
function pick(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function buttonClassName(options = {}, extra) {
  const variant = pick(options.variant, BUTTON_VARIANTS, "outline");
  const size = pick(options.size, BUTTON_SIZES, "md");
  const radius = pick(options.radius, BUTTON_RADII, "md");
  const classes = ["rk-button", `rk-button--${variant}`, `rk-button--${size}`, `rk-radius--${radius}`];
  if (extra) classes.push(extra);
  return classes.join(" ");
}

// src/components.tsx
var VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
};
function navigate(url) {
  if (typeof window !== "undefined") window.location.assign(url);
}
function PriceDisplay({
  product,
  priceId,
  locale,
  fallback = null,
  children,
  className,
  ...spanProps
}) {
  const label = priceLabel(product, { priceId, locale });
  if (children) return createElement2(Fragment, null, children(label));
  if (!label.text) return createElement2(Fragment, null, fallback);
  return createElement2(
    "span",
    {
      ...spanProps,
      className: className ?? "rk-price",
      "data-revkeen-price": label.kind
    },
    label.text
  );
}
function BuyButton({
  productId,
  priceId,
  quantity,
  product,
  onCheckout,
  channel,
  soldOutLabel = "Sold out",
  disabledLabel = "Checkout unavailable",
  pendingLabel = "Opening checkout\u2026",
  children = "Buy now",
  ...buttonProps
}) {
  const store = useCartStore();
  const cart = useCart();
  const [pending, setPending] = useState(false);
  const soldOut = product ? isSoldOut(product) : false;
  const blocked = cart.disabled || soldOut;
  return createElement2(
    "button",
    {
      type: "button",
      className: buttonProps.className ?? "rk-button",
      ...buttonProps,
      disabled: buttonProps.disabled || blocked || pending,
      "aria-disabled": blocked || void 0,
      "aria-busy": pending || void 0,
      title: cart.disabled ? "Checkout is not enabled for this merchant." : soldOut ? "This product is sold out." : buttonProps.title,
      onClick: async () => {
        if (blocked || pending) return;
        setPending(true);
        try {
          const url = await store.buyNow(
            channel === void 0 ? { productId, priceId, quantity } : { productId, priceId, quantity, channel }
          );
          if (url && onCheckout?.(url) !== false) navigate(url);
        } finally {
          setPending(false);
        }
      }
    },
    cart.disabled ? disabledLabel : soldOut ? soldOutLabel : pending ? pendingLabel : children
  );
}
function CartButton({
  onOpen,
  onCheckout,
  label = "Cart",
  children,
  ...buttonProps
}) {
  const cart = useCart();
  const count = cart.count;
  const itemText = `${count} ${count === 1 ? "item" : "items"}`;
  const content = typeof children === "function" ? children(count) : children ?? createElement2(
    Fragment,
    null,
    label,
    " ",
    createElement2("span", { className: "rk-cart-count", "aria-hidden": true }, count)
  );
  const button = createElement2(
    "button",
    {
      type: "button",
      className: buttonProps.className ?? "rk-button",
      ...buttonProps,
      "aria-label": buttonProps["aria-label"] ?? `${label}, ${itemText}`,
      disabled: buttonProps.disabled || cart.disabled || !onOpen && count === 0,
      onClick: async () => {
        if (onOpen) {
          onOpen();
          return;
        }
        const url = await cart.checkout();
        if (url && onCheckout?.(url) !== false) navigate(url);
      }
    },
    content
  );
  return createElement2(
    Fragment,
    null,
    button,
    createElement2(
      "span",
      { role: "status", "aria-live": "polite", style: VISUALLY_HIDDEN },
      cart.status === "idle" ? "" : `${label}: ${itemText}`
    )
  );
}
function ProductCard({
  product,
  locale,
  mode = "cart",
  showImage = true,
  showDescription = false,
  actionLabel,
  buttonLabel,
  onCheckout,
  channel,
  variant,
  size,
  radius,
  children,
  className,
  ...articleProps
}) {
  const price = priceLabel(product, { locale });
  const availability = availabilityLabel(product);
  const soldOut = isSoldOut(product);
  if (children) {
    return createElement2(Fragment, null, children({ product, price, availability, soldOut }));
  }
  const headingId = `rk-product-${product.id}`;
  const label = actionLabel ?? buttonLabel;
  const styled = variant !== void 0 || size !== void 0 || radius !== void 0;
  const buttonClass = styled ? buttonClassName({ variant, size, radius }) : "rk-button";
  const action = mode === "none" ? null : mode === "checkout" ? createElement2(
    BuyButton,
    {
      productId: product.id,
      product,
      onCheckout,
      className: buttonClass,
      ...channel === void 0 ? {} : { channel }
    },
    label ?? "Buy now"
  ) : createElement2(
    AddToCartButton,
    { productId: product.id, product, className: buttonClass },
    label ?? "Add to cart"
  );
  return createElement2(
    "article",
    {
      ...stripPriceInputs(articleProps),
      className: className ?? "rk-product-card",
      "aria-labelledby": headingId,
      "data-revkeen-product-id": product.id
    },
    showImage && product.image_url ? createElement2("img", {
      className: "rk-product-image",
      src: product.image_url,
      alt: "",
      loading: "lazy"
    }) : null,
    createElement2("h3", { id: headingId, className: "rk-product-name" }, product.name),
    showDescription && product.description ? createElement2("p", { className: "rk-product-description" }, product.description) : null,
    price.text ? createElement2(PriceDisplay, { product, locale }) : null,
    availability ? createElement2("p", { className: "rk-product-availability" }, availability) : null,
    action
  );
}
function matchesId(product, id) {
  return product.id === id || product.product_id === id || product.slug === id;
}
function ProductGrid({
  productIds,
  limit,
  locale,
  mode,
  showImage,
  showDescription,
  label = "Products",
  loadingFallback = "Loading products\u2026",
  emptyFallback = "No products available.",
  unavailableFallback = "These products are unavailable.",
  errorFallback = "Products could not be loaded.",
  onCheckout,
  renderProduct,
  buttonLabel,
  channel,
  variant,
  size,
  radius,
  className,
  ...sectionProps
}) {
  const cap = Math.max(1, Math.min(limit ?? GRID_MAX_ITEMS, GRID_MAX_ITEMS));
  const selecting = Boolean(productIds && productIds.length > 0);
  const { products, loading, error } = useProducts(selecting ? void 0 : { limit: cap });
  let visible = products ?? [];
  if (selecting) {
    visible = productIds.map((id) => visible.find((product) => matchesId(product, id))).filter((product) => Boolean(product));
  }
  visible = visible.slice(0, cap);
  const state = loading ? "loading" : error ? "error" : visible.length > 0 ? "ready" : selecting ? "unavailable" : "empty";
  let body;
  if (state === "loading") body = createElement2("p", { className: "rk-grid-status" }, loadingFallback);
  else if (state === "error") body = createElement2("p", { className: "rk-grid-status", role: "alert" }, errorFallback);
  else if (state === "empty") body = createElement2("p", { className: "rk-grid-status" }, emptyFallback);
  else if (state === "unavailable") body = createElement2("p", { className: "rk-grid-status" }, unavailableFallback);
  else {
    body = createElement2(
      "ul",
      { className: "rk-product-grid-list" },
      ...visible.map(
        (product) => createElement2(
          "li",
          { key: product.id, className: "rk-product-grid-item" },
          renderProduct ? renderProduct(product) : createElement2(ProductCard, {
            product,
            locale,
            mode,
            showImage,
            showDescription,
            onCheckout,
            buttonLabel,
            channel,
            variant,
            size,
            radius
          })
        )
      )
    );
  }
  return createElement2(
    "section",
    {
      ...stripPriceInputs(sectionProps),
      className: className ?? "rk-product-grid",
      "aria-label": label,
      "aria-busy": loading || void 0,
      "data-revkeen-state": state
    },
    body
  );
}

// src/elements/components.ts
import {
  createElement as createElement3,
  Fragment as Fragment2,
  useEffect,
  useState as useState2
} from "react";

// src/elements/link-summary.ts
var PRODUCTION_API_ORIGIN = "https://api.revkeen.com";
var STAGING_API_ORIGIN = "https://staging-api.revkeen.com";
var API_ORIGIN_BY_CHECKOUT_HOST = {
  "pay.revkeen.com": PRODUCTION_API_ORIGIN,
  "checkout.revkeen.com": PRODUCTION_API_ORIGIN,
  "pay.staging.revkeen.com": STAGING_API_ORIGIN,
  "checkout.staging.revkeen.com": STAGING_API_ORIGIN
};
var LINK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var CURRENCY_RE = /^[A-Za-z]{3}$/;
function parsePaymentLink(input) {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (LINK_ID_RE.test(raw)) return { id: raw.toLowerCase(), apiOrigin: PRODUCTION_API_ORIGIN };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const match = url.pathname.match(/\/l\/([^/]+)\/?$/);
  const id = match ? decodeURIComponent(match[1]) : "";
  if (!LINK_ID_RE.test(id)) return null;
  return {
    id: id.toLowerCase(),
    apiOrigin: API_ORIGIN_BY_CHECKOUT_HOST[url.hostname.toLowerCase()] ?? PRODUCTION_API_ORIGIN
  };
}
var INTERVALS = ["day", "week", "month", "year"];
function parseSummaryResponse(body) {
  const data = body?.data;
  if (!data || data.active !== true) return null;
  const { product_name, amount_minor, currency, interval, interval_count, trial_period_days, checkout_url } = data;
  if (typeof amount_minor !== "number" || !Number.isSafeInteger(amount_minor) || amount_minor < 0) {
    return null;
  }
  if (typeof currency !== "string" || !CURRENCY_RE.test(currency)) return null;
  if (typeof checkout_url !== "string") return null;
  let checkout;
  try {
    checkout = new URL(checkout_url);
  } catch {
    return null;
  }
  if (checkout.protocol !== "https:") return null;
  const cadence = typeof interval === "string" && INTERVALS.includes(interval) ? interval : null;
  return {
    productName: typeof product_name === "string" ? product_name : "",
    amountMinor: amount_minor,
    currency: currency.toUpperCase(),
    interval: cadence,
    intervalCount: cadence && typeof interval_count === "number" && Number.isSafeInteger(interval_count) && interval_count > 0 ? interval_count : null,
    trialPeriodDays: typeof trial_period_days === "number" && Number.isSafeInteger(trial_period_days) && trial_period_days > 0 ? trial_period_days : null,
    checkoutUrl: checkout.toString()
  };
}
function formatSummaryPrice(summary, locale) {
  const label = priceLabel(
    {
      default_price_id: "link",
      prices: [
        {
          id: "link",
          currency: summary.currency,
          unit_amount: summary.amountMinor,
          interval: summary.interval,
          interval_count: summary.intervalCount,
          trial_period_days: summary.trialPeriodDays
        }
      ]
    },
    locale ? { locale } : {}
  );
  return label.kind === "flat" ? label.text : null;
}
async function fetchPaymentLinkSummary(link, options = {}) {
  const doFetch = options.fetch ?? fetch;
  let response;
  try {
    response = await doFetch(`${link.apiOrigin}/public/payment-links/${encodeURIComponent(link.id)}`, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: options.signal
    });
  } catch {
    return { status: "error" };
  }
  if (response.status === 404) return { status: "unavailable" };
  if (!response.ok) return { status: "error" };
  let body;
  try {
    body = await response.json();
  } catch {
    return { status: "error" };
  }
  const summary = parseSummaryResponse(body);
  return summary ? { status: "ready", summary } : { status: "unavailable" };
}

// src/elements/pricing.ts
var INTERVAL_ORDER = ["month", "year", "week", "day", "one_time"];
var PRICING_INTERVAL_LABELS = {
  month: "Monthly",
  year: "Yearly",
  week: "Weekly",
  day: "Daily",
  one_time: "One-time"
};
function columnTitle(productName, interval) {
  const name = productName.trim();
  const cadence = PRICING_INTERVAL_LABELS[interval];
  return name ? `${name} \xB7 ${cadence}` : cadence;
}
function toInterval(value) {
  return value === "day" || value === "week" || value === "month" || value === "year" ? value : "one_time";
}
function orderIntervals(found) {
  const set = new Set(found);
  return INTERVAL_ORDER.filter((interval) => set.has(interval));
}
function defaultPricingInterval(intervals) {
  if (intervals.includes("month")) return "month";
  return intervals[0] ?? null;
}
function toggleIntervals(intervals) {
  return intervals.includes("month") && intervals.includes("year") ? ["month", "year"] : [];
}
function productPrices(product) {
  return (product.prices ?? []).map((price) => selectPrice({ prices: [price], default_price_id: null })).filter((price) => price !== null);
}
function intervalsFromProducts(products) {
  const found = [];
  for (const product of products) {
    for (const price of productPrices(product)) found.push(toInterval(price.interval));
  }
  return orderIntervals(found);
}
function columnsFromProducts(products, interval, options = {}) {
  const columns = [];
  for (const product of products) {
    for (const price of productPrices(product)) {
      if (toInterval(price.interval) !== interval) continue;
      const label = priceLabel(product, { priceId: price.id, locale: options.locale });
      columns.push({
        key: `${product.id}:${price.id}`,
        title: columnTitle(product.name, interval),
        description: product.description ?? null,
        interval,
        priceText: label.text,
        action: label.text ? { kind: "product", productId: product.id, priceId: price.id } : null
      });
    }
  }
  return columns;
}
function intervalsFromSummaries(summaries) {
  return orderIntervals(summaries.map((summary) => toInterval(summary.interval)));
}
function columnsFromSummaries(summaries, interval, options = {}) {
  return summaries.filter(({ summary }) => toInterval(summary.interval) === interval).map(({ id, summary }) => {
    const priceText = formatSummaryPrice(summary, options.locale);
    return {
      key: id,
      title: columnTitle(summary.productName, interval),
      description: null,
      interval,
      priceText,
      action: priceText ? { kind: "link", checkoutUrl: summary.checkoutUrl } : null
    };
  });
}

// src/elements/thank-you.ts
var THANK_YOU_DEFAULT_HEADING = "Thanks for your order";
var THANK_YOU_PARAM = "rk_checkout";
var CHECKOUT_ID_PLACEHOLDER = "{CHECKOUT_ID}";
var THANK_YOU_STATUS_PARAM = "rk_status";
var CHECKOUT_STATUS_TOKEN_PLACEHOLDER = "{CHECKOUT_STATUS_TOKEN}";
var THANK_YOU_CONFIRMED_TEXT = "Payment confirmed";
var MARKER_RE = /^[A-Za-z0-9_-]{1,128}$/;
var STATUS_TOKEN_RE = /^rvk_cst_[A-Za-z0-9_-]{43}$/;
function readThankYouState(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(typeof search === "string" ? search : "");
  const marker = params.get(THANK_YOU_PARAM);
  const returned = typeof marker === "string" && MARKER_RE.test(marker);
  const status = params.get(THANK_YOU_STATUS_PARAM);
  const statusToken = returned && typeof status === "string" && STATUS_TOKEN_RE.test(status) ? status : null;
  return { returned, statusToken };
}
var PUBLIC_STATUSES = /* @__PURE__ */ new Set(["pending", "complete", "failed", "expired"]);
async function fetchCheckoutStatus(apiOrigin, statusToken, options = {}) {
  if (!STATUS_TOKEN_RE.test(statusToken)) return { status: "unavailable" };
  const doFetch = options.fetch ?? fetch;
  let response;
  try {
    response = await doFetch(`${apiOrigin}/public/checkout-status/${encodeURIComponent(statusToken)}`, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: options.signal
    });
  } catch {
    return { status: "error" };
  }
  if (response.status === 404) return { status: "unavailable" };
  if (!response.ok) return { status: "error" };
  let body;
  try {
    body = await response.json();
  } catch {
    return { status: "error" };
  }
  const status = body?.status;
  return typeof status === "string" && PUBLIC_STATUSES.has(status) ? { status } : { status: "error" };
}
function thankYouSuccessUrl(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  url.searchParams.delete(THANK_YOU_PARAM);
  url.hash = "";
  url.searchParams.delete(THANK_YOU_STATUS_PARAM);
  const separator = url.search ? "&" : "?";
  return `${url.toString()}${separator}${THANK_YOU_PARAM}=${CHECKOUT_ID_PLACEHOLDER}&${THANK_YOU_STATUS_PARAM}=${CHECKOUT_STATUS_TOKEN_PLACEHOLDER}`;
}

// src/elements/components.ts
var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
function isNotFound(err) {
  if (!err || typeof err !== "object") return false;
  const record = err;
  const status = typeof record.status === "number" ? record.status : record.statusCode;
  if (status === 400 || status === 403 || status === 404 || status === 422) return true;
  if (record.code === "CART_DISABLED") return true;
  return typeof record.message === "string" && record.message.includes("CART_DISABLED");
}
function usePaymentLinkSummary(paymentLink, options = {}) {
  const link = parsePaymentLink(paymentLink);
  const [state, setState] = useState2(link ? { status: "loading" } : { status: "unavailable" });
  const doFetch = options.fetch;
  const linkKey = link ? `${link.apiOrigin}|${link.id}` : "";
  useEffect(() => {
    const parsed = parsePaymentLink(paymentLink);
    if (!parsed) {
      setState({ status: "unavailable" });
      return;
    }
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    let cancelled = false;
    setState({ status: "loading" });
    void fetchPaymentLinkSummary(parsed, {
      ...doFetch ? { fetch: doFetch } : {},
      ...controller ? { signal: controller.signal } : {}
    }).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [linkKey, doFetch]);
  return state;
}
function useLiveProduct(idOrSlug) {
  const store = useCartStore();
  const id = typeof idOrSlug === "string" ? idOrSlug.trim() : "";
  const valid = ID_RE.test(id);
  const [state, setState] = useState2(valid ? { status: "loading" } : { status: "unavailable" });
  useEffect(() => {
    if (!valid) {
      setState({ status: "unavailable" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    store.getProduct(id).then(
      (product) => {
        if (!cancelled) setState(product ? { status: "ready", product } : { status: "unavailable" });
      },
      (err) => {
        if (!cancelled) setState({ status: isNotFound(err) ? "unavailable" : "error" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [store, id, valid]);
  return state;
}
var PRICE_UNAVAILABLE = "Unavailable";
function renderPrice(context, props, spanProps) {
  if (props.children) return createElement3(Fragment2, null, props.children(context));
  const fallback = props.fallback ?? PRICE_UNAVAILABLE;
  const content = context.status === "ready" ? context.text : context.status === "loading" ? props.loadingFallback ?? null : context.status === "empty" ? props.fallback ?? null : context.status === "error" ? props.errorFallback ?? fallback : fallback;
  return createElement3(
    "span",
    {
      ...spanProps,
      className: props.className ?? "rk-price",
      "data-revkeen-state": context.status,
      "aria-busy": context.status === "loading" || void 0
    },
    content
  );
}
function LinkLivePrice(props) {
  const { paymentLink, locale, fetch: doFetch, loadingFallback, fallback, errorFallback, children, className, ...rest } = props;
  const state = usePaymentLinkSummary(paymentLink, doFetch ? { fetch: doFetch } : {});
  const text = state.status === "ready" ? formatSummaryPrice(state.summary, locale) : null;
  const context = {
    status: state.status === "ready" && !text ? "unavailable" : state.status,
    text
  };
  return renderPrice(context, { loadingFallback, fallback, errorFallback, children, className }, stripPriceInputs(rest));
}
function ProductLivePrice(props) {
  const {
    productId,
    priceId,
    locale,
    loadingFallback,
    fallback,
    errorFallback,
    children,
    className,
    fetch: _unused,
    paymentLink: _link,
    ...rest
  } = props;
  const state = useLiveProduct(productId);
  let context;
  if (state.status !== "ready") context = { status: state.status, text: null };
  else {
    const label = priceLabel(state.product, { priceId, locale });
    context = label.text ? { status: "ready", text: label.text } : { status: label.price ? "unavailable" : "empty", text: null };
  }
  return renderPrice(context, { loadingFallback, fallback, errorFallback, children, className }, stripPriceInputs(rest));
}
function LivePrice(props) {
  const clean = stripPriceInputs(props);
  if (clean.productId && !clean.paymentLink) return createElement3(ProductLivePrice, clean);
  return createElement3(LinkLivePrice, clean);
}
function cardStatus(status, content, className) {
  return createElement3(
    "div",
    {
      className: className ?? "rk-product-card",
      "data-revkeen-state": status,
      "aria-busy": status === "loading" || void 0,
      role: status === "error" ? "alert" : void 0
    },
    content
  );
}
function LiveProductCard(props) {
  const {
    productId,
    loadingFallback = null,
    unavailableFallback = "This product is unavailable.",
    errorFallback = "This product could not be loaded.",
    ...cardProps
  } = stripPriceInputs(props);
  const state = useLiveProduct(productId);
  if (state.status === "loading") return cardStatus("loading", loadingFallback, cardProps.className);
  if (state.status === "unavailable") return cardStatus("unavailable", unavailableFallback, cardProps.className);
  if (state.status === "error") return cardStatus("error", errorFallback, cardProps.className);
  const hasPrice = Boolean(priceLabel(state.product, { locale: cardProps.locale }).text);
  return createElement3(ProductCard, {
    ...cardProps,
    ...hasPrice ? {} : { mode: "none" },
    product: state.product,
    "data-revkeen-state": hasPrice ? "ready" : "empty"
  });
}
function PricingTableView(props) {
  const {
    status,
    intervals,
    buildColumns,
    renderAction,
    label = "Pricing",
    loadingFallback = "Loading prices\u2026",
    emptyFallback = "No plans are available.",
    unavailableFallback = "Prices are not available.",
    errorFallback = "Prices could not be loaded.",
    children,
    className,
    paymentLinks: _links,
    productIds: _products,
    locale: _locale,
    channel: _channel,
    buttonLabel: _buttonLabel,
    fetch: _fetch,
    onCheckout: _onCheckout,
    variant: _variant,
    size: _size,
    radius: _radius,
    ...sectionProps
  } = props;
  const switchIntervals = toggleIntervals(intervals);
  const [chosen, setChosen] = useState2("month");
  const interval = switchIntervals.length > 0 ? switchIntervals.includes(chosen) ? chosen : "month" : null;
  const columns = status === "ready" ? buildColumns(interval).slice(0, PRICING_MAX_PLANS) : [];
  const effective = status === "ready" && columns.length === 0 ? "empty" : status;
  if (children) {
    return createElement3(
      Fragment2,
      null,
      children({ intervals: switchIntervals, interval, setInterval: setChosen, columns, status: effective })
    );
  }
  let body;
  if (effective === "loading") body = createElement3("p", { className: "rk-grid-status" }, loadingFallback);
  else if (effective === "empty") body = createElement3("p", { className: "rk-grid-status" }, emptyFallback);
  else if (effective === "unavailable")
    body = createElement3("p", { className: "rk-grid-status" }, unavailableFallback);
  else if (effective === "error")
    body = createElement3("p", { className: "rk-grid-status", role: "alert" }, errorFallback);
  else {
    const toggle = switchIntervals.length > 0 ? createElement3(
      "div",
      { className: "rk-pricing-toggle", role: "group", "aria-label": "Billing interval" },
      ...switchIntervals.map(
        (option) => createElement3(
          "button",
          {
            key: option,
            type: "button",
            className: "rk-pricing-toggle-option",
            "aria-pressed": option === interval,
            onClick: () => setChosen(option)
          },
          PRICING_INTERVAL_LABELS[option]
        )
      )
    ) : null;
    const list = createElement3(
      "ul",
      { className: "rk-pricing-list" },
      ...columns.map(
        (column) => createElement3(
          "li",
          { key: column.key, className: "rk-pricing-plan", "data-revkeen-plan": column.key },
          createElement3("h3", { className: "rk-product-name" }, column.title),
          column.description ? createElement3("p", { className: "rk-product-description" }, column.description) : null,
          createElement3("p", { className: "rk-price" }, column.priceText),
          renderAction(column)
        )
      )
    );
    body = createElement3(Fragment2, null, toggle, list);
  }
  return createElement3(
    "section",
    {
      ...stripPriceInputs(sectionProps),
      className: className ?? "rk-pricing-table",
      "aria-label": label,
      "aria-busy": effective === "loading" || void 0,
      "data-revkeen-state": effective
    },
    body
  );
}
function columnsFor(interval, intervals, build) {
  if (interval) return build(interval);
  return intervals.flatMap((each) => build(each));
}
function LinkPricingTable(props) {
  const { paymentLinks = [], fetch: doFetch, locale, channel, buttonLabel, variant, size, radius, onCheckout } = props;
  const key = paymentLinks.join(",");
  const [state, setState] = useState2(
    { status: "loading", summaries: [] }
  );
  useEffect(() => {
    let cancelled = false;
    const links = key.split(",").map((value) => parsePaymentLink(value)).filter((link) => link !== null).slice(0, PRICING_MAX_PLANS * 2);
    if (links.length === 0) {
      setState({ status: "unavailable", summaries: [] });
      return;
    }
    setState({ status: "loading", summaries: [] });
    void Promise.all(links.map((link) => fetchPaymentLinkSummary(link, doFetch ? { fetch: doFetch } : {}))).then(
      (results) => {
        if (cancelled) return;
        const summaries = results.flatMap(
          (result, index) => result.status === "ready" ? [{ id: links[index].id, summary: result.summary }] : []
        );
        const anyError = results.some((result) => result.status === "error");
        setState({ status: summaries.length > 0 ? "ready" : anyError ? "error" : "unavailable", summaries });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key, doFetch]);
  const normalizedChannel = normalizeBuilderChannel(channel ?? "react");
  const intervals = intervalsFromSummaries(state.summaries.map((entry) => entry.summary));
  const label = buttonLabel ?? "Choose plan";
  return createElement3(PricingTableView, {
    ...props,
    status: state.status,
    intervals,
    buildColumns: (interval) => columnsFor(interval, intervals, (each) => columnsFromSummaries(state.summaries, each, locale ? { locale } : {})),
    renderAction: (column) => {
      if (column.action?.kind !== "link") return null;
      const checkoutUrl = allowlistedCheckoutUrl(column.action.checkoutUrl);
      const href = checkoutUrl ? withChannel(checkoutUrl, normalizedChannel) : null;
      if (!href) return null;
      return createElement3(
        "a",
        {
          className: buttonClassName({ variant, size, radius }),
          href,
          "aria-label": `${label}: ${column.title}`,
          onClick: onCheckout ? (event) => {
            if (onCheckout(href) === false) event.preventDefault();
          } : void 0
        },
        label
      );
    }
  });
}
function ProductPricingTable(props) {
  const store = useCartStore();
  const { productIds = [], locale, channel, buttonLabel, variant, size, radius, onCheckout } = props;
  const key = productIds.join(",");
  const [state, setState] = useState2({
    status: "loading",
    products: []
  });
  useEffect(() => {
    let cancelled = false;
    const ids = key.split(",").map((id) => id.trim()).filter((id) => ID_RE.test(id)).slice(0, PRICING_MAX_PLANS);
    if (ids.length === 0) {
      setState({ status: "unavailable", products: [] });
      return;
    }
    setState({ status: "loading", products: [] });
    void Promise.allSettled(ids.map((id) => store.getProduct(id))).then((results) => {
      if (cancelled) return;
      const products = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const anyError = results.some((result) => result.status === "rejected" && !isNotFound(result.reason));
      setState({ status: products.length > 0 ? "ready" : anyError ? "error" : "unavailable", products });
    });
    return () => {
      cancelled = true;
    };
  }, [key, store]);
  const intervals = intervalsFromProducts(state.products);
  const label = buttonLabel ?? "Choose plan";
  return createElement3(PricingTableView, {
    ...props,
    status: state.status,
    intervals,
    buildColumns: (interval) => columnsFor(interval, intervals, (each) => columnsFromProducts(state.products, each, locale ? { locale } : {})),
    renderAction: (column) => {
      if (column.action?.kind !== "product") return null;
      return createElement3(
        BuyButton,
        {
          productId: column.action.productId,
          priceId: column.action.priceId,
          className: buttonClassName({ variant, size, radius }),
          "aria-label": `${label}: ${column.title}`,
          channel: normalizeBuilderChannel(channel ?? "react"),
          ...onCheckout ? { onCheckout } : {}
        },
        label
      );
    }
  });
}
function PricingTable(props) {
  const clean = stripPriceInputs(props);
  if (clean.productIds && clean.productIds.length > 0 && !(clean.paymentLinks && clean.paymentLinks.length > 0)) {
    return createElement3(ProductPricingTable, clean);
  }
  return createElement3(LinkPricingTable, clean);
}
function ThankYou(props) {
  const {
    search,
    heading = THANK_YOU_DEFAULT_HEADING,
    children,
    className,
    apiOrigin,
    fetch: fetchImpl,
    ...rest
  } = stripPriceInputs(props);
  const [state, setState] = useState2(
    () => search !== void 0 ? readThankYouState(search) : { returned: false, statusToken: null }
  );
  const [confirmed, setConfirmed] = useState2(false);
  useEffect(() => {
    const source = search ?? (typeof window !== "undefined" ? window.location.search : "");
    setState(readThankYouState(source));
  }, [search]);
  const origin = apiOrigin && API_ORIGINS.has(apiOrigin) ? apiOrigin : PRODUCTION_API_ORIGIN;
  useEffect(() => {
    setConfirmed(false);
    if (!state.returned || !state.statusToken) return;
    const controller = new AbortController();
    void fetchCheckoutStatus(origin, state.statusToken, { fetch: fetchImpl, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setConfirmed(result.status === "complete");
    });
    return () => controller.abort();
  }, [state.returned, state.statusToken, origin, fetchImpl]);
  if (!state.returned) return null;
  return createElement3(
    "section",
    {
      ...rest,
      className: className ?? "rk-thank-you",
      role: "status",
      "data-revkeen-state": confirmed ? "confirmed" : "ready"
    },
    createElement3("h2", { className: "rk-product-name" }, heading),
    confirmed ? createElement3("p", { className: "rk-thank-you-confirmed" }, THANK_YOU_CONFIRMED_TEXT) : null,
    children ?? null
  );
}

// src/elements/buy-button.ts
import { createElement as createElement4 } from "react";
var BUY_BUTTON_DEFAULT_LABEL = "Buy now";
var BUY_BUTTON_UNAVAILABLE_LABEL = "Unavailable";
function BuyLinkButton(props) {
  const {
    paymentLink,
    showPrice = true,
    buttonLabel,
    locale,
    channel,
    unavailableLabel = BUY_BUTTON_UNAVAILABLE_LABEL,
    fetch: doFetch,
    onCheckout,
    variant,
    size,
    radius,
    className,
    ...rest
  } = stripPriceInputs(props);
  const summaryState = usePaymentLinkSummary(paymentLink, doFetch ? { fetch: doFetch } : {});
  let state;
  if (summaryState.status !== "ready") state = summaryState;
  else {
    const priceText = formatSummaryPrice(summaryState.summary, locale);
    const checkoutUrl = allowlistedCheckoutUrl(summaryState.summary.checkoutUrl);
    const href = checkoutUrl ? withChannel(checkoutUrl, normalizeBuilderChannel(channel ?? "react")) : null;
    state = priceText && href ? { status: "ready", href, priceText, productName: summaryState.summary.productName } : { status: "unavailable" };
  }
  const label = buttonLabel || BUY_BUTTON_DEFAULT_LABEL;
  const classes = buttonClassName({ variant, size, radius });
  let control;
  if (state.status === "ready") {
    const href = state.href;
    control = createElement4(
      "a",
      {
        className: classes,
        href,
        "aria-label": showPrice ? `${label}, ${state.productName ? `${state.productName}, ` : ""}${state.priceText}` : void 0,
        onClick: onCheckout ? (event) => {
          if (onCheckout(href) === false) event.preventDefault();
        } : void 0
      },
      label
    );
  } else {
    control = createElement4(
      "button",
      {
        type: "button",
        className: classes,
        disabled: true,
        "aria-busy": state.status === "loading" || void 0,
        title: state.status === "error" ? "RevKeen could not be reached. Try again later." : state.status === "unavailable" ? "This payment link is not available." : void 0
      },
      state.status === "loading" ? label : unavailableLabel
    );
  }
  return createElement4(
    "span",
    {
      ...rest,
      className: className ?? "rk-buy-button",
      "data-revkeen-state": state.status,
      "aria-busy": state.status === "loading" || void 0
    },
    showPrice && state.status === "ready" ? createElement4("span", { className: "rk-price" }, state.priceText) : null,
    control
  );
}

// src/elements/manage-subscription.ts
import { createElement as createElement5, useEffect as useEffect2, useState as useState3 } from "react";
var MANAGE_SUBSCRIPTION_DEFAULT_LABEL = "Manage subscription";
var IGNORED_TARGET_PROPS = ["href", "merchantSlug", "slug", "portalBaseUrl", "portalUrl", "checkoutBaseUrl"];
function ManageSubscriptionLink(props) {
  const cleaned = stripPriceInputs(props);
  for (const name of IGNORED_TARGET_PROPS) delete cleaned[name];
  const {
    buttonLabel,
    unavailableLabel = "Unavailable",
    variant,
    size,
    radius,
    className,
    ...rest
  } = cleaned;
  const store = useCartStore();
  const [state, setState] = useState3({ status: "loading" });
  useEffect2(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void store.getCustomerPortalUrl().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);
  const label = buttonLabel || MANAGE_SUBSCRIPTION_DEFAULT_LABEL;
  const classes = [buttonClassName({ variant, size, radius }), className].filter(Boolean).join(" ");
  if (state.status === "ready") {
    return createElement5(
      "a",
      { ...rest, className: classes, href: state.url, "data-revkeen-state": "ready" },
      label
    );
  }
  return createElement5(
    "button",
    {
      ...rest,
      type: "button",
      className: classes,
      disabled: true,
      "data-revkeen-state": state.status,
      "aria-busy": state.status === "loading" || void 0,
      title: state.status === "error" ? "RevKeen could not be reached. Try again later." : state.status === "unavailable" ? "The customer portal link is not available." : void 0
    },
    state.status === "loading" ? label : unavailableLabel
  );
}

// src/elements/mount.ts
import { createElement as createElement6 } from "react";
var MOUNTED_ATTRIBUTE = "data-revkeen-element-mounted";
var mountedNodes = /* @__PURE__ */ new WeakSet();
var DEFAULT_SNIPPET_API_BASE_URL = "https://api.revkeen.com/v2";
function allowlistedOrigin(raw, allowed, paths) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (!allowed.has(url.origin)) return null;
  return paths.includes(url.pathname) ? url.origin : null;
}
function resolveSnippetApiBaseUrl(raw) {
  const origin = allowlistedOrigin(raw, API_ORIGINS, ["/", "", "/v2", "/v2/"]);
  return origin ? `${origin}/v2` : DEFAULT_SNIPPET_API_BASE_URL;
}
function resolveSnippetCheckoutBaseUrl(raw) {
  return allowlistedOrigin(raw, CHECKOUT_ORIGINS, ["/", ""]) ?? void 0;
}
var COMPONENTS = {
  "buy-button": BuyLinkButton,
  "live-price": LivePrice,
  "product-card": LiveProductCard,
  "product-grid": ProductGrid,
  "pricing-table": PricingTable,
  "thank-you": ThankYou,
  "manage-subscription": ManageSubscriptionLink
};
var CHANNEL_ELEMENTS = /* @__PURE__ */ new Set([
  "buy-button",
  "product-card",
  "product-grid",
  "pricing-table"
]);
var LINK_FETCH_ELEMENTS = /* @__PURE__ */ new Set(["buy-button", "live-price", "pricing-table"]);
function needsKey(key, props) {
  const requires = BUILDER_ELEMENTS[key].requires;
  if (requires === "publishable-key") return true;
  if (requires === "none") return false;
  const links = props.paymentLink ?? props.paymentLinks;
  return !links && Boolean(props.productId ?? props.productIds);
}
function attributeValues(element) {
  return Array.from(element.attributes, (attribute) => attribute.value);
}
function mountBuilderElements(root, options) {
  let mounted = 0;
  const report = options.onError ?? ((message) => console.warn(`[RevKeen] ${message}`));
  const channel = options.channel === void 0 ? "script" : normalizeBuilderChannel(options.channel);
  const keyClass = classifyKey(options.publishableKey);
  const baseUrl = resolveSnippetApiBaseUrl(options.apiBaseUrl);
  const checkoutBaseUrl = resolveSnippetCheckoutBaseUrl(options.checkoutBaseUrl);
  for (const definition of Object.values(BUILDER_ELEMENTS)) {
    root.querySelectorAll(`[${definition.marker}]`).forEach((element) => {
      if (mountedNodes.has(element)) return;
      mountedNodes.add(element);
      element.setAttribute(MOUNTED_ATTRIBUTE, "true");
      if (keyClass === "secret" || containsSecretKey(attributeValues(element))) {
        options.createRoot(element).render(createElement6(KeyWarning, { kind: "secret" }));
        report(`${definition.title} was given a secret key and was not loaded.`, element);
        return;
      }
      const props = propsFromAttributes(definition.key, (name) => element.getAttribute(name));
      if (CHANNEL_ELEMENTS.has(definition.key)) {
        props.channel = channel ?? "";
      }
      if (options.fetch && LINK_FETCH_ELEMENTS.has(definition.key)) {
        props.fetch = options.fetch;
      }
      let node = createElement6(COMPONENTS[definition.key], props);
      if (needsKey(definition.key, props)) {
        if (keyClass !== "publishable") {
          options.createRoot(element).render(createElement6(KeyWarning, { kind: "invalid" }));
          report(`${definition.title} needs a publishable key (data-revkeen-publishable-key).`, element);
          return;
        }
        node = createElement6(CartProvider, {
          publishableKey: options.publishableKey,
          baseUrl,
          ...checkoutBaseUrl ? { checkoutBaseUrl } : {},
          ...options.fetch ? { fetch: options.fetch } : {},
          ...channel ? { channel } : {},
          children: node
        });
      }
      options.createRoot(element).render(node);
      mounted += 1;
    });
  }
  return mounted;
}

// src/index.tsx
var CartStoreContext = createContext(null);
function CartProvider(props) {
  const keyClass = classifyKey(props.publishableKey);
  if (keyClass !== "publishable") {
    return createElement7(KeyWarning, { kind: keyClass === "secret" ? "secret" : "invalid" });
  }
  return createElement7(CheckedCartProvider, props);
}
function CheckedCartProvider({ children, ...options }) {
  const store = useMemo(
    () => new CartStore(options),
    // The store is intentionally created once per provider; changing keys at
    // runtime means remounting the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect3(() => {
    void store.hydrate();
  }, [store]);
  return createElement7(CartStoreContext.Provider, { value: store }, children);
}
function useCartStore() {
  const store = useContext(CartStoreContext);
  if (!store) {
    throw new Error("[revkeen-react] useCart must be used inside <CartProvider>.");
  }
  return store;
}
function useCart() {
  const store = useCartStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    addItem: store.addItem.bind(store),
    updateQuantity: store.updateQuantity.bind(store),
    removeLine: store.removeLine.bind(store),
    applyDiscount: store.applyDiscount.bind(store),
    checkout: store.checkout.bind(store)
  };
}
function useCartCount() {
  return useCart().count;
}
function useProducts(query) {
  const store = useCartStore();
  const [state, setState] = useState4({
    products: null,
    error: null,
    loading: true
  });
  const limit = query?.limit;
  useEffect3(() => {
    let cancelled = false;
    setState({ products: null, error: null, loading: true });
    store.listProducts(limit === void 0 ? void 0 : { limit }).then((products) => {
      if (!cancelled) setState({ products, error: null, loading: false });
    }).catch((err) => {
      if (!cancelled) {
        setState({
          products: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store, limit]);
  return state;
}
function useProduct(idOrSlug) {
  const store = useCartStore();
  const [state, setState] = useState4({
    product: null,
    error: null,
    loading: Boolean(idOrSlug)
  });
  useEffect3(() => {
    if (!idOrSlug) {
      setState({ product: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ product: null, error: null, loading: true });
    store.getProduct(idOrSlug).then((product) => {
      if (!cancelled) setState({ product, error: null, loading: false });
    }).catch((err) => {
      if (!cancelled) {
        setState({
          product: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store, idOrSlug]);
  return state;
}
function AddToCartButton({
  productId,
  priceId,
  quantity,
  product,
  soldOutLabel = "Sold out",
  disabledLabel = "Cart unavailable",
  children = "Add to cart",
  ...buttonProps
}) {
  const cart = useCart();
  const soldOut = product ? isSoldOut(product) : false;
  const blocked = cart.disabled || soldOut;
  return createElement7(
    "button",
    {
      type: "button",
      ...buttonProps,
      disabled: buttonProps.disabled || blocked || cart.status === "loading",
      "aria-disabled": blocked || void 0,
      title: cart.disabled ? "Cart is not enabled for this merchant." : soldOut ? "This product is sold out." : buttonProps.title,
      onClick: () => {
        if (blocked) return;
        void cart.addItem({ productId, priceId, quantity });
      }
    },
    cart.disabled ? disabledLabel : soldOut ? soldOutLabel : children
  );
}
export {
  AddToCartButton,
  BUILDER_CHANNELS,
  BUILDER_ELEMENTS,
  BUTTON_RADII,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  BUY_BUTTON_DEFAULT_LABEL,
  BUY_BUTTON_UNAVAILABLE_LABEL,
  BuyButton,
  BuyLinkButton,
  CHECKOUT_CHANNEL_PARAM,
  CHECKOUT_ID_PLACEHOLDER,
  CHECKOUT_STATUS_TOKEN_PLACEHOLDER,
  CartButton,
  CartProvider,
  CartStore,
  DEFAULT_BASE_URL,
  DEFAULT_SNIPPET_API_BASE_URL,
  FORBIDDEN_PRICE_INPUTS,
  GRID_MAX_ITEMS,
  INVALID_KEY_WARNING,
  LivePrice,
  LiveProductCard,
  MANAGE_SUBSCRIPTION_DEFAULT_LABEL,
  MOUNTED_ATTRIBUTE,
  ManageSubscriptionLink,
  PRICE_DISPLAY_TOGGLES,
  PRICE_ID_EXCEPTIONS,
  PRICE_NAME_RE,
  PRICING_INTERVAL_LABELS,
  PRICING_MAX_PLANS,
  PricingTable,
  ProductGrid,
  SECRET_KEY_PREFIXES,
  SECRET_KEY_WARNING,
  THANK_YOU_CONFIRMED_TEXT,
  THANK_YOU_DEFAULT_HEADING,
  THANK_YOU_PARAM,
  THANK_YOU_STATUS_PARAM,
  ThankYou,
  assertPublishableKey,
  buttonClassName,
  classifyKey,
  defaultPricingInterval,
  fetchCheckoutStatus,
  fetchPaymentLinkSummary,
  mountBuilderElements,
  normalizeBuilderChannel,
  parsePaymentLink,
  propsFromAttributes,
  readThankYouState,
  renderSnippet,
  resolveSnippetApiBaseUrl,
  resolveSnippetCheckoutBaseUrl,
  stripPriceInputs,
  thankYouSuccessUrl,
  toggleIntervals,
  useCart,
  useCartCount,
  useCartStore,
  useLiveProduct,
  usePaymentLinkSummary,
  useProduct,
  useProducts,
  withChannel
};
