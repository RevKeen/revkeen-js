import * as react from 'react';
import { ButtonHTMLAttributes, ReactNode, CSSProperties, HTMLAttributes, ReactElement } from 'react';

/**
 * Framework-free cart store (REV-5160).
 *
 * All cart behavior lives here — the React layer is a thin
 * useSyncExternalStore wrapper — so the store is fully unit-testable in
 * node. Browser-only by construction: publishable keys are enforced
 * (rk_pk_*; secret keys are rejected) and every call goes through the
 * RevKeen browser client (@revkeen/js). CART_DISABLED surfaces as a dedicated
 * `disabled` state instead of a generic error.
 */
declare const DEFAULT_BASE_URL = "https://api.revkeen.com/v2";
declare function assertPublishableKey(key: string): void;
interface CartAvailability {
    status: "unknown" | "plenty" | "low" | "soldout";
    remaining: number | null;
    display_mode: string;
    low_stock_threshold: number | null;
}
interface CartProduct {
    id: string;
    product_id: string | null;
    slug: string | null;
    name: string;
    description: string | null;
    currency: string;
    image_url: string | null;
    default_price_id: string | null;
    prices: Array<Record<string, unknown>>;
    availability: CartAvailability;
    [key: string]: unknown;
}
interface CartLineItem {
    id: string;
    product_id: string;
    name: string;
    quantity: number;
    unit_price_minor: number;
    currency: string;
    [key: string]: unknown;
}
interface CartData {
    id: string;
    currency: string;
    status: string;
    line_items: CartLineItem[];
    subtotal_minor: number;
    total_minor: number;
    discount_code: string | null;
    [key: string]: unknown;
}
type CartStatus = "idle" | "loading" | "ready" | "error" | "disabled";
interface CartState {
    status: CartStatus;
    cart: CartData | null;
    /** Line quantities summed — badge-ready. */
    count: number;
    error: string | null;
    /** True when the merchant has not enabled Cart (CART_DISABLED). */
    disabled: boolean;
    /** Set after checkout(): the hosted checkout URL to navigate to. */
    checkoutUrl: string | null;
}
interface CartStoreOptions {
    /** Publishable Cart key (rk_pk_*). Required; secret keys are rejected. */
    publishableKey: string;
    baseUrl?: string;
    /** Hosted checkout origin for the convert redirect URL. */
    checkoutBaseUrl?: string;
    currency?: string;
    storageKey?: string;
    fetch?: typeof fetch;
    /** Storage for cart persistence; defaults to localStorage when present. */
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    /**
     * Builder channel hint (REV-8233), e.g. "lovable". Allowlisted client-side
     * and again by RevKeen; an unknown value is dropped. Attribution only.
     */
    channel?: string;
}
type Listener = () => void;
type CustomerPortalLookup = {
    status: "ready";
    url: string;
} | {
    status: "unavailable";
} | {
    status: "error";
};
declare class CartStore {
    private state;
    private listeners;
    private client;
    private storage;
    private storageKey;
    private currency?;
    private checkoutBaseUrl;
    private channel;
    private apiOrigin;
    private publishableKey;
    private fetchImpl?;
    private portalLookup;
    constructor(options: CartStoreOptions);
    /**
     * The customer-portal URL for this store's merchant (REV-8559 element 9).
     * The merchant slug is read from RevKeen (`GET /public/embed/config`, which
     * resolves the merchant from the publishable key), never taken from the page.
     * A successful or "unavailable" answer is cached for the store's lifetime; an
     * error is not, so a later render can retry.
     */
    getCustomerPortalUrl(): Promise<CustomerPortalLookup>;
    /**
     * REV-8573: prefer the server's checkout_url, but only on an allowlisted
     * RevKeen checkout host (REV-8559/8582/8684) and only for this session's
     * /p/{token}. Otherwise the pre-existing token + checkoutBaseUrl build; a
     * rejected checkout_url is never followed.
     */
    private checkoutUrlFor;
    private channelMetadata;
    subscribe: (listener: Listener) => (() => void);
    getState: () => CartState;
    private setState;
    private handleError;
    private storedCartId;
    private persistCartId;
    /** Load a persisted cart if one exists. Safe to call repeatedly. */
    hydrate(): Promise<void>;
    addItem(item: {
        productId: string;
        priceId?: string | null;
        quantity?: number;
    }): Promise<void>;
    updateQuantity(lineId: string, quantity: number): Promise<void>;
    removeLine(lineId: string): Promise<void>;
    applyDiscount(code: string | null): Promise<void>;
    /**
     * Convert the cart to a hosted checkout session. Returns the checkout URL
     * (also exposed on state.checkoutUrl); navigation is the caller's choice.
     */
    checkout(): Promise<string | null>;
    /**
     * Buy now: create a one-product cart, convert it, and return the hosted
     * checkout URL. The shopper's persisted cart (state.cart / storage) is not
     * read or replaced, so "Buy now" never discards a basket in progress. The
     * server prices the line; no amount is sent.
     */
    buyNow(item: {
        productId: string;
        priceId?: string | null;
        quantity?: number;
        /** Overrides the store's channel for this purchase (allowlisted). */
        channel?: string | null;
    }): Promise<string | null>;
    /** Publishable-key product read for pickers/cards. */
    listProducts(query?: {
        limit?: number;
    }): Promise<CartProduct[]>;
    getProduct(idOrSlug: string): Promise<CartProduct>;
}

/**
 * Display helpers for RevKeen products in builder-hosted storefronts.
 *
 * Every amount comes from the RevKeen API in minor units and is only
 * FORMATTED here, through the shared exponent-aware formatter
 * (`@revkeen/shared/money`). Nothing in this module computes, rounds, taxes
 * or converts a price, and nothing falls back to a guessed amount or
 * currency: a price that cannot be formatted renders as no price.
 */

/** The public price fields the storefront projection returns. */
interface StorefrontPrice {
    id: string;
    currency: string;
    /** Minor units (pence, cents). Null for usage-based / decimal-only prices. */
    unit_amount: number | null;
    interval?: string | null;
    interval_count?: number | null;
    usage_type?: string | null;
    trial_period_days?: number | null;
    [key: string]: unknown;
}
type PriceLabelKind = "flat" | "usage" | "unavailable";
interface PriceLabel {
    kind: PriceLabelKind;
    /** Human label, e.g. "£55.00/month · 14-day trial". Null when unavailable. */
    text: string | null;
    /** The formatted amount alone, e.g. "£55.00". */
    amount: string | null;
    price: StorefrontPrice | null;
}

/**
 * One definition per prebuilt builder element (REV-8559, section 2).
 *
 * Each definition drives three outputs:
 *
 * (a) the React component in `@revkeen/react` (`./components`);
 * (b) the Webflow / HTML `data-revkeen-*` snippet contract: `renderSnippet`
 *     writes it (for the Dashboard's copy buttons) and `propsFromAttributes`
 *     reads it (for the embed script's auto-mount);
 * (c) the props shape a Framer module wraps: `options` below lists every input
 *     a builder may expose, with its type, so the Framer stream maps each one to
 *     a property control without inventing new inputs.
 *
 * The price rule is structural: no definition has an amount, price or currency
 * input, and `propsFromAttributes` reads only the attributes listed here. A
 * page-supplied `data-amount`, `data-revkeen-price`, `price` or `amount` is never
 * read, so it cannot reach what is shown or charged.
 *
 * ## The snippet attribute contract (public, final)
 *
 * Pasted snippets are never updated, so every name below is final: kebab-case,
 * never renamed, never removed. If one ever has to change, the old name stays
 * readable as an alias. `builder-elements.test.ts` snapshots this exact list, so
 * a rename or removal fails CI. Attributes not listed here are ignored.
 *
 * | Element        | Marker (valueless)             | Attributes                                                                                                        |
 * | -------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
 * | Buy button     | `data-revkeen-buy-button`      | `payment-link`, `show-price`, `locale`, `variant`, `size`, `radius`, `button-label`                                 |
 * | Live price     | `data-revkeen-live-price`      | `payment-link`, `product-id`, `price-id`, `locale`                                                                 |
 * | Product card   | `data-revkeen-product-card`    | `product-id`, `mode`, `show-image`, `show-description`, `locale`, `variant`, `size`, `radius`, `button-label`      |
 * | Product grid   | `data-revkeen-product-grid`    | `product-ids`, `limit`, `mode`, `show-image`, `show-description`, `locale`, `variant`, `size`, `radius`, `button-label` |
 * | Pricing table  | `data-revkeen-pricing-table`   | `payment-links`, `product-ids`, `locale`, `variant`, `size`, `radius`, `button-label`                              |
 * | Thank-you      | `data-revkeen-thank-you`       | `heading`                                                                                                           |
 * | Manage subscr. | `data-revkeen-manage-subscription` | `variant`, `size`, `radius`, `button-label`                                                                   |
 *
 * (Each attribute is `data-revkeen-<name>`.) Markers carry no value and are
 * never read as data, so `live-price` / `pricing-table` naming the element is
 * not a price input. `show-price` is a boolean display toggle (see
 * {@link PRICE_DISPLAY_TOGGLES}): it switches RevKeen's own price on or off and
 * can never carry an amount.
 *
 * Deliberately NOT attributes: any amount, price, currency or total (prices
 * come from RevKeen); the builder channel (set by the delivery path — the embed
 * script, a Framer module, or the React app — never by a page attribute); any
 * key (a publishable key is given to the embed script, never to an element);
 * any host or base URL (checkout URLs come from RevKeen, and hosts are an exact
 * allowlist in `mount.ts`).
 */
type BuilderElementKey = "buy-button" | "live-price" | "product-card" | "product-grid" | "pricing-table" | "thank-you" | "manage-subscription";
type ElementOptionType = "string" | "string-list" | "boolean" | "enum";
interface ElementOption {
    /** React / Framer prop name. */
    prop: string;
    /** `data-revkeen-*` attribute in the HTML snippet. */
    attribute: string;
    type: ElementOptionType;
    values?: readonly string[];
    required?: boolean;
    description: string;
}
interface BuilderElementDefinition {
    key: BuilderElementKey;
    title: string;
    /** Marker attribute that identifies the element in HTML. */
    marker: string;
    /**
     * What the element needs to read its data:
     * - "none": public, key-free reads (payment-link summary) or no read at all;
     * - "publishable-key": the storefront product read (`rk_pk_*`, a registered
     *   origin and Cart enabled for the merchant).
     * - "none-or-publishable-key": key-free with payment links, key with products.
     */
    requires: "none" | "publishable-key" | "none-or-publishable-key";
    options: readonly ElementOption[];
    /**
     * Props a pasted snippet gets when it does not set the attribute. Product
     * cards and grids go straight to hosted checkout until the embed cart drawer
     * (REV-8559 element 6) is verified with builder snippets.
     */
    snippetDefaults?: Readonly<Record<string, unknown>>;
}
/** Most cards a product grid shows. */
declare const GRID_MAX_ITEMS = 12;
/** Most plans a pricing table shows. */
declare const PRICING_MAX_PLANS = 4;
/**
 * Names that could carry a price. No element prop or attribute may match, except
 * the id fields in {@link PRICE_ID_EXCEPTIONS}, which select a RevKeen price by id.
 */
declare const PRICE_NAME_RE: RegExp;
declare const PRICE_ID_EXCEPTIONS: readonly ["priceId", "data-revkeen-price-id"];
/**
 * Boolean display toggles whose names mention price. They only show or hide the
 * price RevKeen returned, so they may match {@link PRICE_NAME_RE}, but they must
 * be declared `type: "boolean"`: a boolean parses to true/false and can never
 * carry an amount. The module-load guard below and the walker test enforce it.
 */
declare const PRICE_DISPLAY_TOGGLES: readonly ["showPrice", "data-revkeen-show-price"];
declare const BUTTON_VARIANTS: readonly ["outline", "solid", "plain"];
declare const BUTTON_SIZES: readonly ["sm", "md", "lg"];
declare const BUTTON_RADII: readonly ["none", "sm", "md", "full"];
type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
type ButtonSize = (typeof BUTTON_SIZES)[number];
type ButtonRadius = (typeof BUTTON_RADII)[number];
declare const BUILDER_ELEMENTS: Record<BuilderElementKey, BuilderElementDefinition>;
/**
 * Inputs a page might use to try to set a price. None is ever read. Listed so
 * tests and the Dashboard can assert their absence.
 */
declare const FORBIDDEN_PRICE_INPUTS: readonly ["amount", "amountMinor", "amount_minor", "unitAmount", "unit_amount", "price", "priceText", "currency", "total", "data-amount", "data-price", "data-currency", "data-revkeen-price", "data-revkeen-amount", "data-revkeen-currency"];
/**
 * Removes every price-like key from props before they are spread onto the DOM,
 * so a page cannot even leave a misleading `data-amount` on a RevKeen element.
 */
declare function stripPriceInputs<T extends Record<string, unknown>>(props: T): T;
/**
 * Reads an element's props from its HTML attributes. Only the options declared
 * for that element are read; every other attribute on the element (including a
 * page-supplied price) is ignored.
 */
declare function propsFromAttributes(key: BuilderElementKey, getAttribute: (name: string) => string | null): Record<string, unknown>;
/**
 * The HTML snippet for an element (what the Dashboard's copy button gives a
 * Webflow or plain-HTML site). Unknown or price-like keys in `values` are
 * dropped. The page also needs the embed script tag; that is not repeated here.
 */
declare function renderSnippet(key: BuilderElementKey, values: Record<string, string | readonly string[] | boolean | undefined>): string;

/**
 * The documented style options for builder elements (REV-8559): variant, size,
 * radius and button label. They map to classes in `@revkeen/react/styles.css`,
 * which is structural only: colours and fonts are inherited from the page
 * (`currentColor`, `inherit`), and the solid variant reads `--rk-accent` /
 * `--rk-accent-contrast` so the merchant's own palette decides. Nothing here
 * styles checkout, a status or a money figure (rule 29).
 */

interface ElementStyleOptions {
    variant?: ButtonVariant;
    size?: ButtonSize;
    radius?: ButtonRadius;
}
/** `rk-button rk-button--outline rk-button--md rk-radius--md` etc. Unknown values fall back. */
declare function buttonClassName(options?: ElementStyleOptions, extra?: string): string;

interface BuyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
    productId: string;
    priceId?: string | null;
    quantity?: number;
    /** Pass the product when already loaded to enable sold-out handling. */
    product?: CartProduct | null;
    /**
     * Called with the hosted checkout URL before navigating. Return false to
     * navigate yourself (e.g. inside an iframe host).
     */
    onCheckout?: (checkoutUrl: string) => boolean | void;
    /** Builder channel hint (REV-8233); overrides the provider's. Attribution only. */
    channel?: string | null;
    soldOutLabel?: ReactNode;
    disabledLabel?: ReactNode;
    pendingLabel?: ReactNode;
    children?: ReactNode;
}
/**
 * Buy now: sends one product straight to hosted checkout without touching the
 * shopper's persisted cart. The server prices the item; the URL is the
 * existing `/p/{token}` hosted checkout.
 */
declare function BuyButton({ productId, priceId, quantity, product, onCheckout, channel, soldOutLabel, disabledLabel, pendingLabel, children, ...buttonProps }: BuyButtonProps): react.DetailedReactHTMLElement<{
    disabled: boolean;
    "aria-disabled": true | undefined;
    "aria-busy": true | undefined;
    title: string | undefined;
    onClick: () => Promise<void>;
    form?: string | undefined | undefined;
    slot?: string | undefined | undefined;
    style?: CSSProperties | undefined;
    role?: react.AriaRole | undefined;
    className: string;
    value?: string | number | readonly string[] | undefined;
    formAction?: string | undefined;
    formEncType?: string | undefined | undefined;
    formMethod?: string | undefined | undefined;
    formNoValidate?: boolean | undefined | undefined;
    formTarget?: string | undefined | undefined;
    name?: string | undefined | undefined;
    type: string;
    defaultChecked?: boolean | undefined | undefined;
    defaultValue?: string | number | readonly string[] | undefined;
    suppressContentEditableWarning?: boolean | undefined | undefined;
    suppressHydrationWarning?: boolean | undefined | undefined;
    accessKey?: string | undefined | undefined;
    autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined | (string & {}) | undefined;
    autoFocus?: boolean | undefined | undefined;
    contentEditable?: (boolean | "true" | "false") | "inherit" | "plaintext-only" | undefined;
    contextMenu?: string | undefined | undefined;
    dir?: string | undefined | undefined;
    draggable?: (boolean | "true" | "false") | undefined;
    enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined | undefined;
    hidden?: boolean | undefined | undefined;
    id?: string | undefined | undefined;
    lang?: string | undefined | undefined;
    nonce?: string | undefined | undefined;
    spellCheck?: (boolean | "true" | "false") | undefined;
    tabIndex?: number | undefined | undefined;
    translate?: "yes" | "no" | undefined | undefined;
    radioGroup?: string | undefined | undefined;
    about?: string | undefined | undefined;
    content?: string | undefined | undefined;
    datatype?: string | undefined | undefined;
    inlist?: any;
    prefix?: string | undefined | undefined;
    property?: string | undefined | undefined;
    rel?: string | undefined | undefined;
    resource?: string | undefined | undefined;
    rev?: string | undefined | undefined;
    typeof?: string | undefined | undefined;
    vocab?: string | undefined | undefined;
    autoCorrect?: string | undefined | undefined;
    autoSave?: string | undefined | undefined;
    color?: string | undefined | undefined;
    itemProp?: string | undefined | undefined;
    itemScope?: boolean | undefined | undefined;
    itemType?: string | undefined | undefined;
    itemID?: string | undefined | undefined;
    itemRef?: string | undefined | undefined;
    results?: number | undefined | undefined;
    security?: string | undefined | undefined;
    unselectable?: "on" | "off" | undefined | undefined;
    inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | undefined;
    is?: string | undefined | undefined;
    exportparts?: string | undefined | undefined;
    part?: string | undefined | undefined;
    "aria-activedescendant"?: string | undefined | undefined;
    "aria-atomic"?: (boolean | "true" | "false") | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined | undefined;
    "aria-braillelabel"?: string | undefined | undefined;
    "aria-brailleroledescription"?: string | undefined | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-colcount"?: number | undefined | undefined;
    "aria-colindex"?: number | undefined | undefined;
    "aria-colindextext"?: string | undefined | undefined;
    "aria-colspan"?: number | undefined | undefined;
    "aria-controls"?: string | undefined | undefined;
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined | undefined;
    "aria-describedby"?: string | undefined | undefined;
    "aria-description"?: string | undefined | undefined;
    "aria-details"?: string | undefined | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined | undefined;
    "aria-errormessage"?: string | undefined | undefined;
    "aria-expanded"?: (boolean | "true" | "false") | undefined;
    "aria-flowto"?: string | undefined | undefined;
    "aria-grabbed"?: (boolean | "true" | "false") | undefined;
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined | undefined;
    "aria-hidden"?: (boolean | "true" | "false") | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined | undefined;
    "aria-keyshortcuts"?: string | undefined | undefined;
    "aria-label"?: string | undefined | undefined;
    "aria-labelledby"?: string | undefined | undefined;
    "aria-level"?: number | undefined | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined | undefined;
    "aria-modal"?: (boolean | "true" | "false") | undefined;
    "aria-multiline"?: (boolean | "true" | "false") | undefined;
    "aria-multiselectable"?: (boolean | "true" | "false") | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined | undefined;
    "aria-owns"?: string | undefined | undefined;
    "aria-placeholder"?: string | undefined | undefined;
    "aria-posinset"?: number | undefined | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-readonly"?: (boolean | "true" | "false") | undefined;
    "aria-relevant"?: "additions" | "additions removals" | "additions text" | "all" | "removals" | "removals additions" | "removals text" | "text" | "text additions" | "text removals" | undefined | undefined;
    "aria-required"?: (boolean | "true" | "false") | undefined;
    "aria-roledescription"?: string | undefined | undefined;
    "aria-rowcount"?: number | undefined | undefined;
    "aria-rowindex"?: number | undefined | undefined;
    "aria-rowindextext"?: string | undefined | undefined;
    "aria-rowspan"?: number | undefined | undefined;
    "aria-selected"?: (boolean | "true" | "false") | undefined;
    "aria-setsize"?: number | undefined | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined | undefined;
    "aria-valuemax"?: number | undefined | undefined;
    "aria-valuemin"?: number | undefined | undefined;
    "aria-valuenow"?: number | undefined | undefined;
    "aria-valuetext"?: string | undefined | undefined;
    dangerouslySetInnerHTML?: {
        __html: string | TrustedHTML;
    } | undefined | undefined;
    onCopy?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCopyCapture?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCut?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCutCapture?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onPaste?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onPasteCapture?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCompositionEnd?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionEndCapture?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionStart?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionStartCapture?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionUpdate?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionUpdateCapture?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onFocus?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onFocusCapture?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onBlur?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onBlurCapture?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onChange?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onChangeCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onBeforeInput?: react.InputEventHandler<HTMLButtonElement> | undefined;
    onBeforeInputCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInput?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInputCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onReset?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onResetCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onSubmit?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onSubmitCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInvalid?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInvalidCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onLoad?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onError?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onErrorCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onKeyDown?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyDownCapture?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyPress?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyPressCapture?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyUp?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyUpCapture?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onAbort?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onAbortCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlay?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlayCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlayThrough?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlayThroughCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onDurationChange?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onDurationChangeCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEmptied?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEmptiedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEncrypted?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEncryptedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEnded?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEndedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedData?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedDataCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedMetadata?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedMetadataCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadStart?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadStartCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPause?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPauseCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlay?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlayCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlaying?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlayingCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onProgress?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onProgressCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onRateChange?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onRateChangeCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeeked?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeekedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeeking?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeekingCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onStalled?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onStalledCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSuspend?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSuspendCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onTimeUpdate?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onTimeUpdateCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onVolumeChange?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onVolumeChangeCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onWaiting?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onWaitingCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onAuxClick?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onAuxClickCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onClickCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onContextMenu?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onContextMenuCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onDoubleClick?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onDoubleClickCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onDrag?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEnd?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEndCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEnter?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEnterCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragExit?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragExitCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragLeave?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragLeaveCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragOver?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragOverCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragStart?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragStartCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDrop?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDropCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onMouseDown?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseDownCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseEnter?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseLeave?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseMove?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseMoveCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOut?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOutCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOver?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOverCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseUp?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseUpCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onSelect?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSelectCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onTouchCancel?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchCancelCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchEnd?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchEndCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchMove?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchMoveCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchStart?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchStartCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onPointerDown?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerDownCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerMove?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerMoveCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerUp?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerUpCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerCancel?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerCancelCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerEnter?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerLeave?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOver?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOverCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOut?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOutCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onGotPointerCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onGotPointerCaptureCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onLostPointerCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onLostPointerCaptureCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onScroll?: react.UIEventHandler<HTMLButtonElement> | undefined;
    onScrollCapture?: react.UIEventHandler<HTMLButtonElement> | undefined;
    onWheel?: react.WheelEventHandler<HTMLButtonElement> | undefined;
    onWheelCapture?: react.WheelEventHandler<HTMLButtonElement> | undefined;
    onAnimationStart?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationStartCapture?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationEnd?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationEndCapture?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationIteration?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationIterationCapture?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onTransitionEnd?: react.TransitionEventHandler<HTMLButtonElement> | undefined;
    onTransitionEndCapture?: react.TransitionEventHandler<HTMLButtonElement> | undefined;
}, HTMLElement>;
interface CartButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
    /**
     * Opens the merchant's cart UI (a drawer or page built with `useCart`).
     * When omitted, the button converts the cart and goes to hosted checkout.
     */
    onOpen?: () => void;
    onCheckout?: (checkoutUrl: string) => boolean | void;
    /** Accessible base label; the item count is appended. */
    label?: string;
    children?: ReactNode | ((count: number) => ReactNode);
}
/** Cart trigger with a live, announced item count. */
declare function CartButton({ onOpen, onCheckout, label, children, ...buttonProps }: CartButtonProps): react.FunctionComponentElement<{
    children?: ReactNode | undefined;
}>;
interface ProductCardRenderContext {
    product: CartProduct;
    price: PriceLabel;
    availability: string | null;
    soldOut: boolean;
}
interface ProductCardProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    product: CartProduct;
    locale?: string;
    /** "cart" adds to the cart; "checkout" goes straight to hosted checkout. */
    mode?: "cart" | "checkout" | "none";
    showImage?: boolean;
    showDescription?: boolean;
    actionLabel?: ReactNode;
    /** Documented builder name for the button text; `actionLabel` wins if both are set. */
    buttonLabel?: ReactNode;
    onCheckout?: (checkoutUrl: string) => boolean | void;
    /** Builder channel hint for "Buy now" (REV-8233). Attribution only. */
    channel?: string | null;
    variant?: ElementStyleOptions["variant"];
    size?: ElementStyleOptions["size"];
    radius?: ElementStyleOptions["radius"];
    children?: (context: ProductCardRenderContext) => ReactNode;
}
interface ProductGridProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    /** Show only these products (UUID, reference or slug), in this order. */
    productIds?: string[];
    limit?: number;
    locale?: string;
    mode?: ProductCardProps["mode"];
    showImage?: boolean;
    showDescription?: boolean;
    /** Accessible name for the grid region. */
    label?: string;
    loadingFallback?: ReactNode;
    emptyFallback?: ReactNode;
    unavailableFallback?: ReactNode;
    errorFallback?: ReactNode;
    onCheckout?: (checkoutUrl: string) => boolean | void;
    renderProduct?: (product: CartProduct) => ReactNode;
    buttonLabel?: ReactNode;
    channel?: string | null;
    variant?: ElementStyleOptions["variant"];
    size?: ElementStyleOptions["size"];
    radius?: ElementStyleOptions["radius"];
}
/** The merchant's active, priced products from the RevKeen API. */
declare function ProductGrid({ productIds, limit, locale, mode, showImage, showDescription, label, loadingFallback, emptyFallback, unavailableFallback, errorFallback, onCheckout, renderProduct, buttonLabel, channel, variant, size, radius, className, ...sectionProps }: ProductGridProps): react.DetailedReactHTMLElement<{
    className: string;
    "aria-label": string;
    "aria-busy": true | undefined;
    "data-revkeen-state": string;
}, HTMLElement>;

/**
 * Builder channel hint for prebuilt elements (REV-8233, REV-8559).
 *
 * The channel says which builder surface a buyer came through. It is
 * attribution only: RevKeen never reads it for price, rails, tenancy or
 * authorization, and re-validates it server-side on every read.
 *
 * The allowlist is `COMMERCE_CHANNELS` in `packages/events/src/commerce-channel.ts`.
 * It is mirrored here, not imported, because `@revkeen/events` is a private
 * package that pulls in zod; this public browser package must not ship either.
 * `__tests__/unit/react-cart/builder-elements.test.ts` asserts the two lists
 * are identical, so the mirror cannot drift from the authority.
 */
declare const BUILDER_CHANNELS: readonly ["framer", "lovable", "v0", "bolt", "webflow", "wordpress", "react", "script", "storefront"];
type BuilderChannel = (typeof BUILDER_CHANNELS)[number];
/** Query parameter hosted checkout reads the hint from (`apps/checkout/app/p|l`). */
declare const CHECKOUT_CHANNEL_PARAM = "rk_channel";
/**
 * An allowlisted channel, or null. Same rule as `normaliseCommerceChannel`:
 * strings only, trimmed and lower-cased, anything off the list is dropped.
 */
declare function normalizeBuilderChannel(raw: unknown): BuilderChannel | null;
/**
 * The server's checkout URL with the channel hint set. Only https URLs are
 * returned; anything else is null so an element never navigates to a
 * `javascript:`, `data:` or plain-http target.
 */
declare function withChannel(url: string, channel: unknown): string | null;

interface ParsedPaymentLink {
    id: string;
    /** Engine API origin the summary is read from. */
    apiOrigin: string;
}
/**
 * Accepts a bare payment-link id or a hosted payment-link URL
 * (`https://checkout.revkeen.com/l/{id}`). Anything else is null.
 */
declare function parsePaymentLink(input: string | undefined | null): ParsedPaymentLink | null;
type BillingInterval = "day" | "week" | "month" | "year";
/** The validated fields of the REV-8252 projection. */
interface PaymentLinkSummary {
    productName: string;
    amountMinor: number;
    currency: string;
    interval: BillingInterval | null;
    intervalCount: number | null;
    trialPeriodDays: number | null;
    checkoutUrl: string;
}
type SummaryResult = {
    status: "ready";
    summary: PaymentLinkSummary;
} | {
    status: "unavailable";
} | {
    status: "error";
};
/**
 * Reads the live summary. 404 (missing, archived, disabled, expired, private or
 * unpriceable: the server gives one answer for all) is "unavailable"; any other
 * failure is "error". Neither ever yields a price.
 */
declare function fetchPaymentLinkSummary(link: ParsedPaymentLink, options?: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
}): Promise<SummaryResult>;

/**
 * Pricing table model (REV-8559 element 5). Pure: turns server data into
 * columns. No amount is ever taken from the caller: every column's price text
 * is formatted from a price RevKeen returned, and its action points at the
 * server-priced checkout (a payment link's hosted page, or a product/price id
 * that the cart prices server-side).
 *
 * Two sources, same model:
 * - payment links (key-free, `GET /public/payment-links/:id`), one link per
 *   plan and interval; and
 * - storefront products (publishable key), one product with several prices or
 *   several products side by side.
 */

type PricingInterval = "day" | "week" | "month" | "year" | "one_time";
/** Toggle labels. Cadence only: this is price data, not a renewal promise. */
declare const PRICING_INTERVAL_LABELS: Record<PricingInterval, string>;
type PricingAction = {
    kind: "link";
    checkoutUrl: string;
} | {
    kind: "product";
    productId: string;
    priceId: string;
};
interface PricingColumn {
    key: string;
    /**
     * "Product name · Monthly". Storefront prices carry no nickname, so the
     * title is the product's own name plus the price's interval, never an
     * invented plan name.
     */
    title: string;
    description: string | null;
    interval: PricingInterval;
    /** Formatted from the server's minor units, e.g. "£55.00/month". Null = no price. */
    priceText: string | null;
    action: PricingAction | null;
}
/** The interval to show first: monthly when present, else the first available. */
declare function defaultPricingInterval(intervals: readonly PricingInterval[]): PricingInterval | null;
/**
 * The Monthly/Yearly switch exists only when the plans have both a monthly and
 * a yearly price. Otherwise there is no switch and every plan is shown.
 */
declare function toggleIntervals(intervals: readonly PricingInterval[]): PricingInterval[];

type ElementState = "loading" | "ready" | "empty" | "unavailable" | "error";
type LinkSummaryState = {
    status: "loading";
} | {
    status: "ready";
    summary: PaymentLinkSummary;
} | {
    status: "unavailable";
} | {
    status: "error";
};
/** Live read of a payment link's summary. No key, no credentials. */
declare function usePaymentLinkSummary(paymentLink: string | null | undefined, options?: {
    fetch?: typeof fetch;
}): LinkSummaryState;
type LiveProductState = {
    status: "loading";
} | {
    status: "ready";
    product: CartProduct;
} | {
    status: "unavailable";
} | {
    status: "error";
};
/**
 * One product, read live with the provider's publishable key. A missing or
 * malformed id is `unavailable` without a request; 4xx / Cart disabled is
 * `unavailable`; anything else that fails is `error`.
 */
declare function useLiveProduct(idOrSlug: string | null | undefined): LiveProductState;
interface LivePriceRenderContext {
    status: ElementState;
    /** The formatted server price, e.g. "£55.00/month". Null unless ready. */
    text: string | null;
}
interface LivePriceProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
    /** Payment-link URL or id. Key-free. */
    paymentLink?: string | null;
    /** Or a product (UUID, reference or slug); needs `<CartProvider>` with a publishable key. */
    productId?: string | null;
    priceId?: string | null;
    locale?: string;
    /** Shown while loading. Default: nothing. */
    loadingFallback?: ReactNode;
    /** Shown when there is no price to show. Default: "Unavailable". */
    fallback?: ReactNode;
    /** Shown when the read failed. Default: `fallback`. */
    errorFallback?: ReactNode;
    fetch?: typeof fetch;
    children?: (context: LivePriceRenderContext) => ReactNode;
}
/**
 * Element 2: price text for any layout, read live from RevKeen. Give it a
 * payment link (no key) or a product (inside `<CartProvider>`).
 */
declare function LivePrice(props: LivePriceProps): react.FunctionComponentElement<LivePriceProps>;
interface LiveProductCardProps extends Omit<ProductCardProps, "product"> {
    /** Product UUID, reference or slug. Read live with the provider's publishable key. */
    productId: string;
    loadingFallback?: ReactNode;
    unavailableFallback?: ReactNode;
    errorFallback?: ReactNode;
}
/**
 * Element 3: a product card that loads its own product. This is the builder
 * element; the lower-level `ProductCard` (internal) renders a product object
 * that a builder element read from RevKeen.
 */
declare function LiveProductCard(props: LiveProductCardProps): react.FunctionComponentElement<ProductCardProps> | react.DetailedReactHTMLElement<{
    className: string;
    "data-revkeen-state": ElementState;
    "aria-busy": true | undefined;
    role: "alert" | undefined;
}, HTMLElement>;
interface PricingTableRenderContext {
    /** Intervals the switch offers: ["month", "year"] when both exist, else []. */
    intervals: PricingInterval[];
    interval: PricingInterval | null;
    setInterval: (interval: PricingInterval) => void;
    columns: PricingColumn[];
    status: ElementState;
}
interface PricingTableProps extends Omit<HTMLAttributes<HTMLElement>, "children">, ElementStyleOptions {
    /** One payment link per plan and billing interval (key-free). */
    paymentLinks?: string[];
    /** Or products whose active prices form the plans (needs `<CartProvider>`). */
    productIds?: string[];
    locale?: string;
    /** Delivery-path channel hint (REV-8233). Allowlisted; defaults to "react". */
    channel?: BuilderChannel | string | null;
    buttonLabel?: string;
    /** Accessible name for the table region. */
    label?: string;
    loadingFallback?: ReactNode;
    emptyFallback?: ReactNode;
    unavailableFallback?: ReactNode;
    errorFallback?: ReactNode;
    fetch?: typeof fetch;
    onCheckout?: (checkoutUrl: string) => boolean | void;
    children?: (context: PricingTableRenderContext) => ReactNode;
}
/**
 * Element 5: plans side by side. Payment links need no key; products need
 * `<CartProvider>`. The Monthly/Yearly switch appears only when both exist; at
 * most {@link PRICING_MAX_PLANS} plans are shown. Column titles are the
 * product name and the interval ("Pro · Monthly"), never an invented plan name.
 * Recurring prices show their cadence ("/month"), which is price data.
 */
declare function PricingTable(props: PricingTableProps): react.FunctionComponentElement<PricingTableProps>;
interface ThankYouProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    /** Defaults to `window.location.search`. */
    search?: string;
    heading?: ReactNode;
    children?: ReactNode;
    /**
     * REV-8566: RevKeen API origin for the status read. Allowlisted
     * (`API_ORIGINS`); anything else falls back to production.
     */
    apiOrigin?: string;
    /** Injectable fetch, as on the other builder elements. */
    fetch?: typeof fetch;
}
/**
 * Element 10: shows the merchant's thank-you content when the buyer returns
 * from checkout (`?rk_checkout=…`, see `thankYouSuccessUrl`). Nothing from the
 * URL is rendered (no amount, currency, product name or order number).
 *
 * REV-8566: when the URL also carries a status-only token (`rk_status`), it
 * reads `GET /public/checkout-status/:token`. Only a `complete` answer adds the
 * confirmed line and `data-revkeen-state="confirmed"`. The URL alone never
 * confirms anything; any other answer, an error or no token keeps the generic copy.
 */
declare function ThankYou(props: ThankYouProps): react.DetailedReactHTMLElement<{
    className: string;
    role: "status";
    "data-revkeen-state": string;
    slot?: string | undefined | undefined;
    style?: react.CSSProperties | undefined;
    title?: string | undefined | undefined;
    onClick?: react.MouseEventHandler<HTMLElement> | undefined;
    defaultChecked?: boolean | undefined | undefined;
    defaultValue?: string | number | readonly string[] | undefined;
    suppressContentEditableWarning?: boolean | undefined | undefined;
    suppressHydrationWarning?: boolean | undefined | undefined;
    accessKey?: string | undefined | undefined;
    autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined | (string & {}) | undefined;
    autoFocus?: boolean | undefined | undefined;
    contentEditable?: (boolean | "true" | "false") | "inherit" | "plaintext-only" | undefined;
    contextMenu?: string | undefined | undefined;
    dir?: string | undefined | undefined;
    draggable?: (boolean | "true" | "false") | undefined;
    enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined | undefined;
    hidden?: boolean | undefined | undefined;
    id?: string | undefined | undefined;
    lang?: string | undefined | undefined;
    nonce?: string | undefined | undefined;
    spellCheck?: (boolean | "true" | "false") | undefined;
    tabIndex?: number | undefined | undefined;
    translate?: "yes" | "no" | undefined | undefined;
    radioGroup?: string | undefined | undefined;
    about?: string | undefined | undefined;
    content?: string | undefined | undefined;
    datatype?: string | undefined | undefined;
    inlist?: any;
    prefix?: string | undefined | undefined;
    property?: string | undefined | undefined;
    rel?: string | undefined | undefined;
    resource?: string | undefined | undefined;
    rev?: string | undefined | undefined;
    typeof?: string | undefined | undefined;
    vocab?: string | undefined | undefined;
    autoCorrect?: string | undefined | undefined;
    autoSave?: string | undefined | undefined;
    color?: string | undefined | undefined;
    itemProp?: string | undefined | undefined;
    itemScope?: boolean | undefined | undefined;
    itemType?: string | undefined | undefined;
    itemID?: string | undefined | undefined;
    itemRef?: string | undefined | undefined;
    results?: number | undefined | undefined;
    security?: string | undefined | undefined;
    unselectable?: "on" | "off" | undefined | undefined;
    inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | undefined;
    is?: string | undefined | undefined;
    exportparts?: string | undefined | undefined;
    part?: string | undefined | undefined;
    "aria-activedescendant"?: string | undefined | undefined;
    "aria-atomic"?: (boolean | "true" | "false") | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined | undefined;
    "aria-braillelabel"?: string | undefined | undefined;
    "aria-brailleroledescription"?: string | undefined | undefined;
    "aria-busy"?: (boolean | "true" | "false") | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-colcount"?: number | undefined | undefined;
    "aria-colindex"?: number | undefined | undefined;
    "aria-colindextext"?: string | undefined | undefined;
    "aria-colspan"?: number | undefined | undefined;
    "aria-controls"?: string | undefined | undefined;
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined | undefined;
    "aria-describedby"?: string | undefined | undefined;
    "aria-description"?: string | undefined | undefined;
    "aria-details"?: string | undefined | undefined;
    "aria-disabled"?: (boolean | "true" | "false") | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined | undefined;
    "aria-errormessage"?: string | undefined | undefined;
    "aria-expanded"?: (boolean | "true" | "false") | undefined;
    "aria-flowto"?: string | undefined | undefined;
    "aria-grabbed"?: (boolean | "true" | "false") | undefined;
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined | undefined;
    "aria-hidden"?: (boolean | "true" | "false") | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined | undefined;
    "aria-keyshortcuts"?: string | undefined | undefined;
    "aria-label"?: string | undefined | undefined;
    "aria-labelledby"?: string | undefined | undefined;
    "aria-level"?: number | undefined | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined | undefined;
    "aria-modal"?: (boolean | "true" | "false") | undefined;
    "aria-multiline"?: (boolean | "true" | "false") | undefined;
    "aria-multiselectable"?: (boolean | "true" | "false") | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined | undefined;
    "aria-owns"?: string | undefined | undefined;
    "aria-placeholder"?: string | undefined | undefined;
    "aria-posinset"?: number | undefined | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-readonly"?: (boolean | "true" | "false") | undefined;
    "aria-relevant"?: "additions" | "additions removals" | "additions text" | "all" | "removals" | "removals additions" | "removals text" | "text" | "text additions" | "text removals" | undefined | undefined;
    "aria-required"?: (boolean | "true" | "false") | undefined;
    "aria-roledescription"?: string | undefined | undefined;
    "aria-rowcount"?: number | undefined | undefined;
    "aria-rowindex"?: number | undefined | undefined;
    "aria-rowindextext"?: string | undefined | undefined;
    "aria-rowspan"?: number | undefined | undefined;
    "aria-selected"?: (boolean | "true" | "false") | undefined;
    "aria-setsize"?: number | undefined | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined | undefined;
    "aria-valuemax"?: number | undefined | undefined;
    "aria-valuemin"?: number | undefined | undefined;
    "aria-valuenow"?: number | undefined | undefined;
    "aria-valuetext"?: string | undefined | undefined;
    dangerouslySetInnerHTML?: {
        __html: string | TrustedHTML;
    } | undefined | undefined;
    onCopy?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCopyCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCut?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCutCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPaste?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPasteCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCompositionEnd?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionEndCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStart?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStartCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdate?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdateCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onFocus?: react.FocusEventHandler<HTMLElement> | undefined;
    onFocusCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlur?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlurCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onChange?: react.FormEventHandler<HTMLElement> | undefined;
    onChangeCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onBeforeInput?: react.InputEventHandler<HTMLElement> | undefined;
    onBeforeInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInput?: react.FormEventHandler<HTMLElement> | undefined;
    onInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onReset?: react.FormEventHandler<HTMLElement> | undefined;
    onResetCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmit?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmitCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalid?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalidCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onLoad?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onError?: react.ReactEventHandler<HTMLElement> | undefined;
    onErrorCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onKeyDown?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyDownCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPress?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPressCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUp?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUpCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onAbort?: react.ReactEventHandler<HTMLElement> | undefined;
    onAbortCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThrough?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThroughCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptied?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptiedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncrypted?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncryptedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEnded?: react.ReactEventHandler<HTMLElement> | undefined;
    onEndedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedData?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedDataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadata?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStart?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStartCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPause?: react.ReactEventHandler<HTMLElement> | undefined;
    onPauseCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlaying?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgress?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgressCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeked?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeking?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalled?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalledCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspend?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspendCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdate?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdateCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaiting?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaitingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onAuxClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onAuxClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenu?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenuCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDrag?: react.DragEventHandler<HTMLElement> | undefined;
    onDragCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnd?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEndCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnter?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnterCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExit?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExitCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeave?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeaveCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOver?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOverCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStart?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStartCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDrop?: react.DragEventHandler<HTMLElement> | undefined;
    onDropCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onMouseDown?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseDownCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseEnter?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseLeave?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMove?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMoveCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOut?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOutCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOver?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOverCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUp?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUpCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onSelect?: react.ReactEventHandler<HTMLElement> | undefined;
    onSelectCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTouchCancel?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchCancelCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEnd?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEndCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMove?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMoveCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStart?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStartCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onPointerDown?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerDownCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMove?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMoveCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUp?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUpCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancel?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancelCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerEnter?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerLeave?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOver?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOverCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOut?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOutCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onScroll?: react.UIEventHandler<HTMLElement> | undefined;
    onScrollCapture?: react.UIEventHandler<HTMLElement> | undefined;
    onWheel?: react.WheelEventHandler<HTMLElement> | undefined;
    onWheelCapture?: react.WheelEventHandler<HTMLElement> | undefined;
    onAnimationStart?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationStartCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEnd?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEndCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIteration?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIterationCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onTransitionEnd?: react.TransitionEventHandler<HTMLElement> | undefined;
    onTransitionEndCapture?: react.TransitionEventHandler<HTMLElement> | undefined;
}, HTMLElement> | null;

/**
 * Thank-you handling (REV-8559 element 10).
 *
 * Hosted checkout sends the buyer to the payment link's success URL when it is
 * set (`apps/checkout/lib/intent-checkout.ts`, `resolveIntentSuccessDestination`),
 * substituting placeholders such as `{CHECKOUT_ID}`. The recommended success URL
 * for a builder page is the page itself plus `rk_checkout={CHECKOUT_ID}`; the
 * thank-you section shows when that marker is present.
 *
 * What the marker is NOT: proof of payment. Anyone can type it into a URL. So
 * the marker alone only ever shows static merchant copy.
 *
 * REV-8566: the success URL can also carry `rk_status={CHECKOUT_STATUS_TOKEN}`,
 * a status-only token Engine mints at payment time. The section confirms the
 * payment ONLY after `GET /public/checkout-status/:token` returns `complete`;
 * the URL itself never confirms anything. It never shows an amount, currency, product or
 * customer detail taken from the URL, even though the success URL placeholder
 * set includes `{AMOUNT}` and `{CURRENCY}`: a page-supplied amount is not shown.
 */
/**
 * Default heading. It thanks the buyer for the order and says nothing about
 * payment: the marker cannot prove a payment happened, so no copy here may say
 * "paid" or confirm one.
 */
declare const THANK_YOU_DEFAULT_HEADING = "Thanks for your order";
/** Marker query parameter the thank-you section looks for. */
declare const THANK_YOU_PARAM = "rk_checkout";
/** Placeholder hosted checkout replaces with the checkout id. */
declare const CHECKOUT_ID_PLACEHOLDER = "{CHECKOUT_ID}";
/** REV-8566: query parameter carrying the status-only token. */
declare const THANK_YOU_STATUS_PARAM = "rk_status";
/** REV-8566: placeholder Engine replaces with the status-only token. */
declare const CHECKOUT_STATUS_TOKEN_PLACEHOLDER = "{CHECKOUT_STATUS_TOKEN}";
/** Shown only after the status read returns `complete`. */
declare const THANK_YOU_CONFIRMED_TEXT = "Payment confirmed";
interface ThankYouState {
    /** True when the page was reached with a well-formed checkout marker. */
    returned: boolean;
    /** A well-formed status-only token, or null. It proves nothing by itself. */
    statusToken: string | null;
}
/**
 * Reads only the marker. Every other parameter (amount, currency, price,
 * product, email) is ignored by construction: nothing else is returned.
 */
declare function readThankYouState(search: string | URLSearchParams | null | undefined): ThankYouState;
type PublicCheckoutStatus = "pending" | "complete" | "failed" | "expired";
type CheckoutStatusResult = {
    status: PublicCheckoutStatus;
} | {
    status: "unavailable";
} | {
    status: "error";
};
/**
 * REV-8566: reads `GET /public/checkout-status/:token`. 404 (unknown, expired
 * or malformed: the server gives one answer for all) is "unavailable"; any
 * other failure is "error". Only a body of exactly `{ status }` with a known
 * value is accepted.
 */
declare function fetchCheckoutStatus(apiOrigin: string, statusToken: string, options?: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
}): Promise<CheckoutStatusResult>;
/**
 * The success URL to set on a payment link so the buyer returns to `pageUrl`
 * and the thank-you section shows. https only. The `{CHECKOUT_ID}` and
 * `{CHECKOUT_STATUS_TOKEN}` placeholders are kept literal (not percent-encoded)
 * because checkout substitutes them.
 */
declare function thankYouSuccessUrl(pageUrl: string): string | null;

declare const BUY_BUTTON_DEFAULT_LABEL = "Buy now";
declare const BUY_BUTTON_UNAVAILABLE_LABEL = "Unavailable";
interface BuyLinkButtonProps extends Omit<HTMLAttributes<HTMLElement>, "children">, ElementStyleOptions {
    /** Payment-link URL (`https://checkout.revkeen.com/l/{id}`) or id. */
    paymentLink?: string | null;
    /** Show RevKeen's live price next to the button. Default true. */
    showPrice?: boolean;
    /** Button text. Default "Buy now". */
    buttonLabel?: string;
    /** Number-format locale for the price. Defaults to the browser's. */
    locale?: string;
    /** Delivery-path channel hint (REV-8233). Allowlisted; defaults to "react". */
    channel?: BuilderChannel | string | null;
    /** Text on the disabled button when there is nothing to buy. Default "Unavailable". */
    unavailableLabel?: ReactNode;
    fetch?: typeof fetch;
    /** Called with the checkout URL before navigating. Return false to cancel. */
    onCheckout?: (checkoutUrl: string) => boolean | void;
}
/**
 * Element 1: a payment-link buy button. The React component, the
 * `data-revkeen-buy-button` snippet and a Framer module all render this.
 */
declare function BuyLinkButton(props: BuyLinkButtonProps): react.DetailedReactHTMLElement<{
    className: string;
    "data-revkeen-state": "error" | "loading" | "ready" | "unavailable";
    "aria-busy": true | undefined;
    slot?: string | undefined | undefined;
    style?: react.CSSProperties | undefined;
    title?: string | undefined | undefined;
    role?: react.AriaRole | undefined;
    onClick?: react.MouseEventHandler<HTMLElement> | undefined;
    defaultChecked?: boolean | undefined | undefined;
    defaultValue?: string | number | readonly string[] | undefined;
    suppressContentEditableWarning?: boolean | undefined | undefined;
    suppressHydrationWarning?: boolean | undefined | undefined;
    accessKey?: string | undefined | undefined;
    autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined | (string & {}) | undefined;
    autoFocus?: boolean | undefined | undefined;
    contentEditable?: (boolean | "true" | "false") | "inherit" | "plaintext-only" | undefined;
    contextMenu?: string | undefined | undefined;
    dir?: string | undefined | undefined;
    draggable?: (boolean | "true" | "false") | undefined;
    enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined | undefined;
    hidden?: boolean | undefined | undefined;
    id?: string | undefined | undefined;
    lang?: string | undefined | undefined;
    nonce?: string | undefined | undefined;
    spellCheck?: (boolean | "true" | "false") | undefined;
    tabIndex?: number | undefined | undefined;
    translate?: "yes" | "no" | undefined | undefined;
    radioGroup?: string | undefined | undefined;
    about?: string | undefined | undefined;
    content?: string | undefined | undefined;
    datatype?: string | undefined | undefined;
    inlist?: any;
    prefix?: string | undefined | undefined;
    property?: string | undefined | undefined;
    rel?: string | undefined | undefined;
    resource?: string | undefined | undefined;
    rev?: string | undefined | undefined;
    typeof?: string | undefined | undefined;
    vocab?: string | undefined | undefined;
    autoCorrect?: string | undefined | undefined;
    autoSave?: string | undefined | undefined;
    color?: string | undefined | undefined;
    itemProp?: string | undefined | undefined;
    itemScope?: boolean | undefined | undefined;
    itemType?: string | undefined | undefined;
    itemID?: string | undefined | undefined;
    itemRef?: string | undefined | undefined;
    results?: number | undefined | undefined;
    security?: string | undefined | undefined;
    unselectable?: "on" | "off" | undefined | undefined;
    inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | undefined;
    is?: string | undefined | undefined;
    exportparts?: string | undefined | undefined;
    part?: string | undefined | undefined;
    "aria-activedescendant"?: string | undefined | undefined;
    "aria-atomic"?: (boolean | "true" | "false") | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined | undefined;
    "aria-braillelabel"?: string | undefined | undefined;
    "aria-brailleroledescription"?: string | undefined | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-colcount"?: number | undefined | undefined;
    "aria-colindex"?: number | undefined | undefined;
    "aria-colindextext"?: string | undefined | undefined;
    "aria-colspan"?: number | undefined | undefined;
    "aria-controls"?: string | undefined | undefined;
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined | undefined;
    "aria-describedby"?: string | undefined | undefined;
    "aria-description"?: string | undefined | undefined;
    "aria-details"?: string | undefined | undefined;
    "aria-disabled"?: (boolean | "true" | "false") | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined | undefined;
    "aria-errormessage"?: string | undefined | undefined;
    "aria-expanded"?: (boolean | "true" | "false") | undefined;
    "aria-flowto"?: string | undefined | undefined;
    "aria-grabbed"?: (boolean | "true" | "false") | undefined;
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined | undefined;
    "aria-hidden"?: (boolean | "true" | "false") | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined | undefined;
    "aria-keyshortcuts"?: string | undefined | undefined;
    "aria-label"?: string | undefined | undefined;
    "aria-labelledby"?: string | undefined | undefined;
    "aria-level"?: number | undefined | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined | undefined;
    "aria-modal"?: (boolean | "true" | "false") | undefined;
    "aria-multiline"?: (boolean | "true" | "false") | undefined;
    "aria-multiselectable"?: (boolean | "true" | "false") | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined | undefined;
    "aria-owns"?: string | undefined | undefined;
    "aria-placeholder"?: string | undefined | undefined;
    "aria-posinset"?: number | undefined | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-readonly"?: (boolean | "true" | "false") | undefined;
    "aria-relevant"?: "additions" | "additions removals" | "additions text" | "all" | "removals" | "removals additions" | "removals text" | "text" | "text additions" | "text removals" | undefined | undefined;
    "aria-required"?: (boolean | "true" | "false") | undefined;
    "aria-roledescription"?: string | undefined | undefined;
    "aria-rowcount"?: number | undefined | undefined;
    "aria-rowindex"?: number | undefined | undefined;
    "aria-rowindextext"?: string | undefined | undefined;
    "aria-rowspan"?: number | undefined | undefined;
    "aria-selected"?: (boolean | "true" | "false") | undefined;
    "aria-setsize"?: number | undefined | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined | undefined;
    "aria-valuemax"?: number | undefined | undefined;
    "aria-valuemin"?: number | undefined | undefined;
    "aria-valuenow"?: number | undefined | undefined;
    "aria-valuetext"?: string | undefined | undefined;
    dangerouslySetInnerHTML?: {
        __html: string | TrustedHTML;
    } | undefined | undefined;
    onCopy?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCopyCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCut?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCutCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPaste?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPasteCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCompositionEnd?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionEndCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStart?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStartCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdate?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdateCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onFocus?: react.FocusEventHandler<HTMLElement> | undefined;
    onFocusCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlur?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlurCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onChange?: react.FormEventHandler<HTMLElement> | undefined;
    onChangeCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onBeforeInput?: react.InputEventHandler<HTMLElement> | undefined;
    onBeforeInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInput?: react.FormEventHandler<HTMLElement> | undefined;
    onInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onReset?: react.FormEventHandler<HTMLElement> | undefined;
    onResetCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmit?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmitCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalid?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalidCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onLoad?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onError?: react.ReactEventHandler<HTMLElement> | undefined;
    onErrorCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onKeyDown?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyDownCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPress?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPressCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUp?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUpCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onAbort?: react.ReactEventHandler<HTMLElement> | undefined;
    onAbortCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThrough?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThroughCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptied?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptiedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncrypted?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncryptedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEnded?: react.ReactEventHandler<HTMLElement> | undefined;
    onEndedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedData?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedDataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadata?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStart?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStartCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPause?: react.ReactEventHandler<HTMLElement> | undefined;
    onPauseCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlaying?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgress?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgressCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeked?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeking?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalled?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalledCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspend?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspendCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdate?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdateCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaiting?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaitingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onAuxClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onAuxClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenu?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenuCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDrag?: react.DragEventHandler<HTMLElement> | undefined;
    onDragCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnd?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEndCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnter?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnterCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExit?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExitCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeave?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeaveCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOver?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOverCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStart?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStartCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDrop?: react.DragEventHandler<HTMLElement> | undefined;
    onDropCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onMouseDown?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseDownCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseEnter?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseLeave?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMove?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMoveCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOut?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOutCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOver?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOverCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUp?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUpCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onSelect?: react.ReactEventHandler<HTMLElement> | undefined;
    onSelectCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTouchCancel?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchCancelCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEnd?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEndCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMove?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMoveCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStart?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStartCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onPointerDown?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerDownCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMove?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMoveCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUp?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUpCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancel?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancelCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerEnter?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerLeave?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOver?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOverCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOut?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOutCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onScroll?: react.UIEventHandler<HTMLElement> | undefined;
    onScrollCapture?: react.UIEventHandler<HTMLElement> | undefined;
    onWheel?: react.WheelEventHandler<HTMLElement> | undefined;
    onWheelCapture?: react.WheelEventHandler<HTMLElement> | undefined;
    onAnimationStart?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationStartCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEnd?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEndCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIteration?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIterationCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onTransitionEnd?: react.TransitionEventHandler<HTMLElement> | undefined;
    onTransitionEndCapture?: react.TransitionEventHandler<HTMLElement> | undefined;
}, HTMLElement>;

declare const MANAGE_SUBSCRIPTION_DEFAULT_LABEL = "Manage subscription";
interface ManageSubscriptionLinkProps extends Omit<HTMLAttributes<HTMLElement>, "children">, ElementStyleOptions {
    /** Link text. Default "Manage subscription". */
    buttonLabel?: string;
    /** Text on the disabled button when the portal link is not available. */
    unavailableLabel?: ReactNode;
}
declare function ManageSubscriptionLink(props: ManageSubscriptionLinkProps): react.DetailedReactHTMLElement<{
    className: string;
    href: string;
    "data-revkeen-state": string;
    slot?: string | undefined | undefined;
    style?: react.CSSProperties | undefined;
    title?: string | undefined | undefined;
    role?: react.AriaRole | undefined;
    onClick?: react.MouseEventHandler<HTMLElement> | undefined;
    defaultChecked?: boolean | undefined | undefined;
    defaultValue?: string | number | readonly string[] | undefined;
    suppressContentEditableWarning?: boolean | undefined | undefined;
    suppressHydrationWarning?: boolean | undefined | undefined;
    accessKey?: string | undefined | undefined;
    autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined | (string & {}) | undefined;
    autoFocus?: boolean | undefined | undefined;
    contentEditable?: (boolean | "true" | "false") | "inherit" | "plaintext-only" | undefined;
    contextMenu?: string | undefined | undefined;
    dir?: string | undefined | undefined;
    draggable?: (boolean | "true" | "false") | undefined;
    enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined | undefined;
    hidden?: boolean | undefined | undefined;
    id?: string | undefined | undefined;
    lang?: string | undefined | undefined;
    nonce?: string | undefined | undefined;
    spellCheck?: (boolean | "true" | "false") | undefined;
    tabIndex?: number | undefined | undefined;
    translate?: "yes" | "no" | undefined | undefined;
    radioGroup?: string | undefined | undefined;
    about?: string | undefined | undefined;
    content?: string | undefined | undefined;
    datatype?: string | undefined | undefined;
    inlist?: any;
    prefix?: string | undefined | undefined;
    property?: string | undefined | undefined;
    rel?: string | undefined | undefined;
    resource?: string | undefined | undefined;
    rev?: string | undefined | undefined;
    typeof?: string | undefined | undefined;
    vocab?: string | undefined | undefined;
    autoCorrect?: string | undefined | undefined;
    autoSave?: string | undefined | undefined;
    color?: string | undefined | undefined;
    itemProp?: string | undefined | undefined;
    itemScope?: boolean | undefined | undefined;
    itemType?: string | undefined | undefined;
    itemID?: string | undefined | undefined;
    itemRef?: string | undefined | undefined;
    results?: number | undefined | undefined;
    security?: string | undefined | undefined;
    unselectable?: "on" | "off" | undefined | undefined;
    inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | undefined;
    is?: string | undefined | undefined;
    exportparts?: string | undefined | undefined;
    part?: string | undefined | undefined;
    "aria-activedescendant"?: string | undefined | undefined;
    "aria-atomic"?: (boolean | "true" | "false") | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined | undefined;
    "aria-braillelabel"?: string | undefined | undefined;
    "aria-brailleroledescription"?: string | undefined | undefined;
    "aria-busy"?: (boolean | "true" | "false") | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-colcount"?: number | undefined | undefined;
    "aria-colindex"?: number | undefined | undefined;
    "aria-colindextext"?: string | undefined | undefined;
    "aria-colspan"?: number | undefined | undefined;
    "aria-controls"?: string | undefined | undefined;
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined | undefined;
    "aria-describedby"?: string | undefined | undefined;
    "aria-description"?: string | undefined | undefined;
    "aria-details"?: string | undefined | undefined;
    "aria-disabled"?: (boolean | "true" | "false") | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined | undefined;
    "aria-errormessage"?: string | undefined | undefined;
    "aria-expanded"?: (boolean | "true" | "false") | undefined;
    "aria-flowto"?: string | undefined | undefined;
    "aria-grabbed"?: (boolean | "true" | "false") | undefined;
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined | undefined;
    "aria-hidden"?: (boolean | "true" | "false") | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined | undefined;
    "aria-keyshortcuts"?: string | undefined | undefined;
    "aria-label"?: string | undefined | undefined;
    "aria-labelledby"?: string | undefined | undefined;
    "aria-level"?: number | undefined | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined | undefined;
    "aria-modal"?: (boolean | "true" | "false") | undefined;
    "aria-multiline"?: (boolean | "true" | "false") | undefined;
    "aria-multiselectable"?: (boolean | "true" | "false") | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined | undefined;
    "aria-owns"?: string | undefined | undefined;
    "aria-placeholder"?: string | undefined | undefined;
    "aria-posinset"?: number | undefined | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-readonly"?: (boolean | "true" | "false") | undefined;
    "aria-relevant"?: "additions" | "additions removals" | "additions text" | "all" | "removals" | "removals additions" | "removals text" | "text" | "text additions" | "text removals" | undefined | undefined;
    "aria-required"?: (boolean | "true" | "false") | undefined;
    "aria-roledescription"?: string | undefined | undefined;
    "aria-rowcount"?: number | undefined | undefined;
    "aria-rowindex"?: number | undefined | undefined;
    "aria-rowindextext"?: string | undefined | undefined;
    "aria-rowspan"?: number | undefined | undefined;
    "aria-selected"?: (boolean | "true" | "false") | undefined;
    "aria-setsize"?: number | undefined | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined | undefined;
    "aria-valuemax"?: number | undefined | undefined;
    "aria-valuemin"?: number | undefined | undefined;
    "aria-valuenow"?: number | undefined | undefined;
    "aria-valuetext"?: string | undefined | undefined;
    dangerouslySetInnerHTML?: {
        __html: string | TrustedHTML;
    } | undefined | undefined;
    onCopy?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCopyCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCut?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCutCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPaste?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPasteCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCompositionEnd?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionEndCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStart?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStartCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdate?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdateCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onFocus?: react.FocusEventHandler<HTMLElement> | undefined;
    onFocusCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlur?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlurCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onChange?: react.FormEventHandler<HTMLElement> | undefined;
    onChangeCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onBeforeInput?: react.InputEventHandler<HTMLElement> | undefined;
    onBeforeInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInput?: react.FormEventHandler<HTMLElement> | undefined;
    onInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onReset?: react.FormEventHandler<HTMLElement> | undefined;
    onResetCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmit?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmitCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalid?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalidCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onLoad?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onError?: react.ReactEventHandler<HTMLElement> | undefined;
    onErrorCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onKeyDown?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyDownCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPress?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPressCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUp?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUpCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onAbort?: react.ReactEventHandler<HTMLElement> | undefined;
    onAbortCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThrough?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThroughCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptied?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptiedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncrypted?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncryptedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEnded?: react.ReactEventHandler<HTMLElement> | undefined;
    onEndedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedData?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedDataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadata?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStart?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStartCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPause?: react.ReactEventHandler<HTMLElement> | undefined;
    onPauseCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlaying?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgress?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgressCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeked?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeking?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalled?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalledCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspend?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspendCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdate?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdateCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaiting?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaitingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onAuxClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onAuxClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenu?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenuCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDrag?: react.DragEventHandler<HTMLElement> | undefined;
    onDragCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnd?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEndCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnter?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnterCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExit?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExitCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeave?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeaveCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOver?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOverCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStart?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStartCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDrop?: react.DragEventHandler<HTMLElement> | undefined;
    onDropCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onMouseDown?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseDownCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseEnter?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseLeave?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMove?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMoveCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOut?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOutCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOver?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOverCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUp?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUpCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onSelect?: react.ReactEventHandler<HTMLElement> | undefined;
    onSelectCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTouchCancel?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchCancelCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEnd?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEndCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMove?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMoveCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStart?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStartCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onPointerDown?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerDownCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMove?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMoveCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUp?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUpCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancel?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancelCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerEnter?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerLeave?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOver?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOverCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOut?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOutCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onScroll?: react.UIEventHandler<HTMLElement> | undefined;
    onScrollCapture?: react.UIEventHandler<HTMLElement> | undefined;
    onWheel?: react.WheelEventHandler<HTMLElement> | undefined;
    onWheelCapture?: react.WheelEventHandler<HTMLElement> | undefined;
    onAnimationStart?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationStartCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEnd?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEndCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIteration?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIterationCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onTransitionEnd?: react.TransitionEventHandler<HTMLElement> | undefined;
    onTransitionEndCapture?: react.TransitionEventHandler<HTMLElement> | undefined;
}, HTMLElement> | react.DetailedReactHTMLElement<{
    type: string;
    className: string;
    disabled: boolean;
    "data-revkeen-state": "error" | "loading" | "unavailable";
    "aria-busy": true | undefined;
    title: string | undefined;
    slot?: string | undefined | undefined;
    style?: react.CSSProperties | undefined;
    role?: react.AriaRole | undefined;
    onClick?: react.MouseEventHandler<HTMLElement> | undefined;
    defaultChecked?: boolean | undefined | undefined;
    defaultValue?: string | number | readonly string[] | undefined;
    suppressContentEditableWarning?: boolean | undefined | undefined;
    suppressHydrationWarning?: boolean | undefined | undefined;
    accessKey?: string | undefined | undefined;
    autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined | (string & {}) | undefined;
    autoFocus?: boolean | undefined | undefined;
    contentEditable?: (boolean | "true" | "false") | "inherit" | "plaintext-only" | undefined;
    contextMenu?: string | undefined | undefined;
    dir?: string | undefined | undefined;
    draggable?: (boolean | "true" | "false") | undefined;
    enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined | undefined;
    hidden?: boolean | undefined | undefined;
    id?: string | undefined | undefined;
    lang?: string | undefined | undefined;
    nonce?: string | undefined | undefined;
    spellCheck?: (boolean | "true" | "false") | undefined;
    tabIndex?: number | undefined | undefined;
    translate?: "yes" | "no" | undefined | undefined;
    radioGroup?: string | undefined | undefined;
    about?: string | undefined | undefined;
    content?: string | undefined | undefined;
    datatype?: string | undefined | undefined;
    inlist?: any;
    prefix?: string | undefined | undefined;
    property?: string | undefined | undefined;
    rel?: string | undefined | undefined;
    resource?: string | undefined | undefined;
    rev?: string | undefined | undefined;
    typeof?: string | undefined | undefined;
    vocab?: string | undefined | undefined;
    autoCorrect?: string | undefined | undefined;
    autoSave?: string | undefined | undefined;
    color?: string | undefined | undefined;
    itemProp?: string | undefined | undefined;
    itemScope?: boolean | undefined | undefined;
    itemType?: string | undefined | undefined;
    itemID?: string | undefined | undefined;
    itemRef?: string | undefined | undefined;
    results?: number | undefined | undefined;
    security?: string | undefined | undefined;
    unselectable?: "on" | "off" | undefined | undefined;
    inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | undefined;
    is?: string | undefined | undefined;
    exportparts?: string | undefined | undefined;
    part?: string | undefined | undefined;
    "aria-activedescendant"?: string | undefined | undefined;
    "aria-atomic"?: (boolean | "true" | "false") | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined | undefined;
    "aria-braillelabel"?: string | undefined | undefined;
    "aria-brailleroledescription"?: string | undefined | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-colcount"?: number | undefined | undefined;
    "aria-colindex"?: number | undefined | undefined;
    "aria-colindextext"?: string | undefined | undefined;
    "aria-colspan"?: number | undefined | undefined;
    "aria-controls"?: string | undefined | undefined;
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined | undefined;
    "aria-describedby"?: string | undefined | undefined;
    "aria-description"?: string | undefined | undefined;
    "aria-details"?: string | undefined | undefined;
    "aria-disabled"?: (boolean | "true" | "false") | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined | undefined;
    "aria-errormessage"?: string | undefined | undefined;
    "aria-expanded"?: (boolean | "true" | "false") | undefined;
    "aria-flowto"?: string | undefined | undefined;
    "aria-grabbed"?: (boolean | "true" | "false") | undefined;
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined | undefined;
    "aria-hidden"?: (boolean | "true" | "false") | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined | undefined;
    "aria-keyshortcuts"?: string | undefined | undefined;
    "aria-label"?: string | undefined | undefined;
    "aria-labelledby"?: string | undefined | undefined;
    "aria-level"?: number | undefined | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined | undefined;
    "aria-modal"?: (boolean | "true" | "false") | undefined;
    "aria-multiline"?: (boolean | "true" | "false") | undefined;
    "aria-multiselectable"?: (boolean | "true" | "false") | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined | undefined;
    "aria-owns"?: string | undefined | undefined;
    "aria-placeholder"?: string | undefined | undefined;
    "aria-posinset"?: number | undefined | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-readonly"?: (boolean | "true" | "false") | undefined;
    "aria-relevant"?: "additions" | "additions removals" | "additions text" | "all" | "removals" | "removals additions" | "removals text" | "text" | "text additions" | "text removals" | undefined | undefined;
    "aria-required"?: (boolean | "true" | "false") | undefined;
    "aria-roledescription"?: string | undefined | undefined;
    "aria-rowcount"?: number | undefined | undefined;
    "aria-rowindex"?: number | undefined | undefined;
    "aria-rowindextext"?: string | undefined | undefined;
    "aria-rowspan"?: number | undefined | undefined;
    "aria-selected"?: (boolean | "true" | "false") | undefined;
    "aria-setsize"?: number | undefined | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined | undefined;
    "aria-valuemax"?: number | undefined | undefined;
    "aria-valuemin"?: number | undefined | undefined;
    "aria-valuenow"?: number | undefined | undefined;
    "aria-valuetext"?: string | undefined | undefined;
    dangerouslySetInnerHTML?: {
        __html: string | TrustedHTML;
    } | undefined | undefined;
    onCopy?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCopyCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCut?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCutCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPaste?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onPasteCapture?: react.ClipboardEventHandler<HTMLElement> | undefined;
    onCompositionEnd?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionEndCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStart?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionStartCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdate?: react.CompositionEventHandler<HTMLElement> | undefined;
    onCompositionUpdateCapture?: react.CompositionEventHandler<HTMLElement> | undefined;
    onFocus?: react.FocusEventHandler<HTMLElement> | undefined;
    onFocusCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlur?: react.FocusEventHandler<HTMLElement> | undefined;
    onBlurCapture?: react.FocusEventHandler<HTMLElement> | undefined;
    onChange?: react.FormEventHandler<HTMLElement> | undefined;
    onChangeCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onBeforeInput?: react.InputEventHandler<HTMLElement> | undefined;
    onBeforeInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInput?: react.FormEventHandler<HTMLElement> | undefined;
    onInputCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onReset?: react.FormEventHandler<HTMLElement> | undefined;
    onResetCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmit?: react.FormEventHandler<HTMLElement> | undefined;
    onSubmitCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalid?: react.FormEventHandler<HTMLElement> | undefined;
    onInvalidCapture?: react.FormEventHandler<HTMLElement> | undefined;
    onLoad?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onError?: react.ReactEventHandler<HTMLElement> | undefined;
    onErrorCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onKeyDown?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyDownCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPress?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyPressCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUp?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onKeyUpCapture?: react.KeyboardEventHandler<HTMLElement> | undefined;
    onAbort?: react.ReactEventHandler<HTMLElement> | undefined;
    onAbortCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThrough?: react.ReactEventHandler<HTMLElement> | undefined;
    onCanPlayThroughCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onDurationChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptied?: react.ReactEventHandler<HTMLElement> | undefined;
    onEmptiedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncrypted?: react.ReactEventHandler<HTMLElement> | undefined;
    onEncryptedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onEnded?: react.ReactEventHandler<HTMLElement> | undefined;
    onEndedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedData?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedDataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadata?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadedMetadataCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStart?: react.ReactEventHandler<HTMLElement> | undefined;
    onLoadStartCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPause?: react.ReactEventHandler<HTMLElement> | undefined;
    onPauseCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlay?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlaying?: react.ReactEventHandler<HTMLElement> | undefined;
    onPlayingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgress?: react.ReactEventHandler<HTMLElement> | undefined;
    onProgressCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onRateChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeked?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekedCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeeking?: react.ReactEventHandler<HTMLElement> | undefined;
    onSeekingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalled?: react.ReactEventHandler<HTMLElement> | undefined;
    onStalledCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspend?: react.ReactEventHandler<HTMLElement> | undefined;
    onSuspendCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdate?: react.ReactEventHandler<HTMLElement> | undefined;
    onTimeUpdateCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChange?: react.ReactEventHandler<HTMLElement> | undefined;
    onVolumeChangeCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaiting?: react.ReactEventHandler<HTMLElement> | undefined;
    onWaitingCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onAuxClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onAuxClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenu?: react.MouseEventHandler<HTMLElement> | undefined;
    onContextMenuCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClick?: react.MouseEventHandler<HTMLElement> | undefined;
    onDoubleClickCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onDrag?: react.DragEventHandler<HTMLElement> | undefined;
    onDragCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnd?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEndCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnter?: react.DragEventHandler<HTMLElement> | undefined;
    onDragEnterCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExit?: react.DragEventHandler<HTMLElement> | undefined;
    onDragExitCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeave?: react.DragEventHandler<HTMLElement> | undefined;
    onDragLeaveCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOver?: react.DragEventHandler<HTMLElement> | undefined;
    onDragOverCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStart?: react.DragEventHandler<HTMLElement> | undefined;
    onDragStartCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onDrop?: react.DragEventHandler<HTMLElement> | undefined;
    onDropCapture?: react.DragEventHandler<HTMLElement> | undefined;
    onMouseDown?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseDownCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseEnter?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseLeave?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMove?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseMoveCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOut?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOutCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOver?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseOverCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUp?: react.MouseEventHandler<HTMLElement> | undefined;
    onMouseUpCapture?: react.MouseEventHandler<HTMLElement> | undefined;
    onSelect?: react.ReactEventHandler<HTMLElement> | undefined;
    onSelectCapture?: react.ReactEventHandler<HTMLElement> | undefined;
    onTouchCancel?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchCancelCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEnd?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchEndCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMove?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchMoveCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStart?: react.TouchEventHandler<HTMLElement> | undefined;
    onTouchStartCapture?: react.TouchEventHandler<HTMLElement> | undefined;
    onPointerDown?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerDownCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMove?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerMoveCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUp?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerUpCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancel?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerCancelCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerEnter?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerLeave?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOver?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOverCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOut?: react.PointerEventHandler<HTMLElement> | undefined;
    onPointerOutCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onGotPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onLostPointerCaptureCapture?: react.PointerEventHandler<HTMLElement> | undefined;
    onScroll?: react.UIEventHandler<HTMLElement> | undefined;
    onScrollCapture?: react.UIEventHandler<HTMLElement> | undefined;
    onWheel?: react.WheelEventHandler<HTMLElement> | undefined;
    onWheelCapture?: react.WheelEventHandler<HTMLElement> | undefined;
    onAnimationStart?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationStartCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEnd?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationEndCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIteration?: react.AnimationEventHandler<HTMLElement> | undefined;
    onAnimationIterationCapture?: react.AnimationEventHandler<HTMLElement> | undefined;
    onTransitionEnd?: react.TransitionEventHandler<HTMLElement> | undefined;
    onTransitionEndCapture?: react.TransitionEventHandler<HTMLElement> | undefined;
}, HTMLElement>;

/**
 * Mounts the HTML snippet contract (REV-8559 output b) onto a page.
 *
 * A Webflow or plain-HTML site pastes `<div data-revkeen-live-price
 * data-revkeen-payment-link="…"></div>` (see `renderSnippet`). The embed
 * script calls `mountBuilderElements(document, { createRoot, … })`, which finds
 * each marker, reads ONLY the declared attributes (`propsFromAttributes`) and
 * renders the same React component a React app would use. There is one
 * implementation of each element.
 *
 * `createRoot` is passed in so this package does not depend on react-dom; the
 * embed bundle already ships it.
 *
 * Trust rules on this path:
 * - Hosts come from an exact allowlist. A page-supplied API or checkout base
 *   that is not a RevKeen host is dropped, and the production default is used.
 * - The key must be publishable. A secret, server or internal key blocks every
 *   element found with a visible warning; nothing is requested and the key is
 *   never logged.
 * - The channel is the delivery path's (the embed script's), allowlisted; an
 *   element cannot set it.
 * - Mounting is idempotent: a node is rendered once, however many times this
 *   runs; nodes a builder adds or replaces later are mounted on the next run.
 */

interface MountRoot {
    render(element: ReactElement): void;
}
interface MountBuilderElementsOptions {
    createRoot: (container: Element) => MountRoot;
    /** Publishable key (rk_pk_*) for product elements. Key-free elements work without it. */
    publishableKey?: string;
    /** Engine API origin, with or without `/v2`. Allowlisted; anything else is dropped. */
    apiBaseUrl?: string;
    /** Hosted checkout origin for product-element checkouts. Allowlisted. */
    checkoutBaseUrl?: string;
    /** Delivery-path channel. Default "script"; a value outside the allowlist is dropped. */
    channel?: string;
    fetch?: typeof fetch;
    /** Called once per element that cannot mount. Never receives a key. Default: one console.warn. */
    onError?: (message: string, element: Element) => void;
}
/** Visible marker on a mounted node. The WeakSet below is what decides. */
declare const MOUNTED_ATTRIBUTE = "data-revkeen-element-mounted";
declare const DEFAULT_SNIPPET_API_BASE_URL = "https://api.revkeen.com/v2";
/**
 * The storefront API base for the snippet path: an allowlisted origin plus
 * exactly one `/v2`. Accepts the origin with or without `/v2` and a trailing
 * slash; anything else (another host, another path) falls back to production.
 */
declare function resolveSnippetApiBaseUrl(raw: unknown): string;
/** An allowlisted hosted-checkout origin, or undefined (the store's default). */
declare function resolveSnippetCheckoutBaseUrl(raw: unknown): string | undefined;
/** Mounts every not-yet-mounted builder element under `root`. Returns how many mounted. */
declare function mountBuilderElements(root: ParentNode, options: MountBuilderElementsOptions): number;

/**
 * Key handling for builder elements (REV-8559 criterion 7).
 *
 * Elements run in the browser, so the only key they may ever hold is a
 * publishable key (`rk_pk_…`). Anything else that looks like a RevKeen
 * credential (`rk_sk_…`, the server keys `rk_live_…` / `rk_sandbox_…`, the
 * internal workload credential `rk_int_…`, or any other `rk_` prefix) is a
 * secret that must not be on a web page: the element refuses to render, makes
 * no request with it, never logs it, and shows the site owner a warning that
 * does not echo it.
 */
type KeyClass = "publishable" | "secret" | "missing" | "invalid";
/** Named secret prefixes, for tests and docs. Any other `rk_` prefix is also treated as secret. */
declare const SECRET_KEY_PREFIXES: readonly ["rk_sk_", "rk_live_", "rk_sandbox_", "rk_int_"];
declare function classifyKey(value: unknown): KeyClass;
/** Visible, key-free warning shown in place of an element given a secret key. */
declare const SECRET_KEY_WARNING = "RevKeen: this element was given a secret key and will not load. Use a publishable key (rk_pk_\u2026) and remove the secret key from this page.";
declare const INVALID_KEY_WARNING = "RevKeen: this element needs a publishable key (rk_pk_\u2026) and will not load without one.";

interface CartProviderProps extends CartStoreOptions {
    children: ReactNode;
}
/**
 * Provides the cart store and hydrates any persisted cart on mount.
 *
 * Only a publishable key (`rk_pk_…`) is accepted. Given a secret, server or
 * internal key (or anything else), it renders a visible warning instead of its
 * children, builds no client and makes no request, and never logs the key
 * (REV-8559 criterion 7).
 */
declare function CartProvider(props: CartProviderProps): react.FunctionComponentElement<{
    kind: "secret" | "invalid";
}> | react.FunctionComponentElement<CartProviderProps>;
declare function useCartStore(): CartStore;
interface UseCartResult extends CartState {
    addItem: CartStore["addItem"];
    updateQuantity: CartStore["updateQuantity"];
    removeLine: CartStore["removeLine"];
    applyDiscount: CartStore["applyDiscount"];
    checkout: CartStore["checkout"];
}
/** Cart state + actions. */
declare function useCart(): UseCartResult;
/** Badge-ready line-quantity count. */
declare function useCartCount(): number;
interface UseProductsResult {
    products: CartProduct[] | null;
    error: string | null;
    loading: boolean;
}
/** Publishable-key product list for product cards/pickers. */
declare function useProducts(query?: {
    limit?: number;
}): UseProductsResult;
interface UseProductResult {
    product: CartProduct | null;
    error: string | null;
    loading: boolean;
}
/** One product by UUID, merchant reference, or slug. */
declare function useProduct(idOrSlug: string | null | undefined): UseProductResult;
interface AddToCartButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
    productId: string;
    priceId?: string | null;
    quantity?: number;
    /** Pass the product when already loaded to enable sold-out handling. */
    product?: CartProduct | null;
    soldOutLabel?: ReactNode;
    disabledLabel?: ReactNode;
    children?: ReactNode;
}
/**
 * Minimal, composable add-to-cart button. Unstyled beyond the caller's
 * props. Disabled with a clear reason when the product is sold out or the
 * merchant's Cart is disabled (CART_DISABLED).
 */
declare function AddToCartButton({ productId, priceId, quantity, product, soldOutLabel, disabledLabel, children, ...buttonProps }: AddToCartButtonProps): react.DetailedReactHTMLElement<{
    disabled: boolean;
    "aria-disabled": true | undefined;
    title: string | undefined;
    onClick: () => void;
    form?: string | undefined | undefined;
    slot?: string | undefined | undefined;
    style?: react.CSSProperties | undefined;
    role?: react.AriaRole | undefined;
    className?: string | undefined | undefined;
    value?: string | number | readonly string[] | undefined;
    formAction?: string | undefined;
    formEncType?: string | undefined | undefined;
    formMethod?: string | undefined | undefined;
    formNoValidate?: boolean | undefined | undefined;
    formTarget?: string | undefined | undefined;
    name?: string | undefined | undefined;
    type: string;
    defaultChecked?: boolean | undefined | undefined;
    defaultValue?: string | number | readonly string[] | undefined;
    suppressContentEditableWarning?: boolean | undefined | undefined;
    suppressHydrationWarning?: boolean | undefined | undefined;
    accessKey?: string | undefined | undefined;
    autoCapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined | (string & {}) | undefined;
    autoFocus?: boolean | undefined | undefined;
    contentEditable?: (boolean | "true" | "false") | "inherit" | "plaintext-only" | undefined;
    contextMenu?: string | undefined | undefined;
    dir?: string | undefined | undefined;
    draggable?: (boolean | "true" | "false") | undefined;
    enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined | undefined;
    hidden?: boolean | undefined | undefined;
    id?: string | undefined | undefined;
    lang?: string | undefined | undefined;
    nonce?: string | undefined | undefined;
    spellCheck?: (boolean | "true" | "false") | undefined;
    tabIndex?: number | undefined | undefined;
    translate?: "yes" | "no" | undefined | undefined;
    radioGroup?: string | undefined | undefined;
    about?: string | undefined | undefined;
    content?: string | undefined | undefined;
    datatype?: string | undefined | undefined;
    inlist?: any;
    prefix?: string | undefined | undefined;
    property?: string | undefined | undefined;
    rel?: string | undefined | undefined;
    resource?: string | undefined | undefined;
    rev?: string | undefined | undefined;
    typeof?: string | undefined | undefined;
    vocab?: string | undefined | undefined;
    autoCorrect?: string | undefined | undefined;
    autoSave?: string | undefined | undefined;
    color?: string | undefined | undefined;
    itemProp?: string | undefined | undefined;
    itemScope?: boolean | undefined | undefined;
    itemType?: string | undefined | undefined;
    itemID?: string | undefined | undefined;
    itemRef?: string | undefined | undefined;
    results?: number | undefined | undefined;
    security?: string | undefined | undefined;
    unselectable?: "on" | "off" | undefined | undefined;
    inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | undefined;
    is?: string | undefined | undefined;
    exportparts?: string | undefined | undefined;
    part?: string | undefined | undefined;
    "aria-activedescendant"?: string | undefined | undefined;
    "aria-atomic"?: (boolean | "true" | "false") | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined | undefined;
    "aria-braillelabel"?: string | undefined | undefined;
    "aria-brailleroledescription"?: string | undefined | undefined;
    "aria-busy"?: (boolean | "true" | "false") | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-colcount"?: number | undefined | undefined;
    "aria-colindex"?: number | undefined | undefined;
    "aria-colindextext"?: string | undefined | undefined;
    "aria-colspan"?: number | undefined | undefined;
    "aria-controls"?: string | undefined | undefined;
    "aria-current"?: boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time" | undefined | undefined;
    "aria-describedby"?: string | undefined | undefined;
    "aria-description"?: string | undefined | undefined;
    "aria-details"?: string | undefined | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined | undefined;
    "aria-errormessage"?: string | undefined | undefined;
    "aria-expanded"?: (boolean | "true" | "false") | undefined;
    "aria-flowto"?: string | undefined | undefined;
    "aria-grabbed"?: (boolean | "true" | "false") | undefined;
    "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog" | undefined | undefined;
    "aria-hidden"?: (boolean | "true" | "false") | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined | undefined;
    "aria-keyshortcuts"?: string | undefined | undefined;
    "aria-label"?: string | undefined | undefined;
    "aria-labelledby"?: string | undefined | undefined;
    "aria-level"?: number | undefined | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined | undefined;
    "aria-modal"?: (boolean | "true" | "false") | undefined;
    "aria-multiline"?: (boolean | "true" | "false") | undefined;
    "aria-multiselectable"?: (boolean | "true" | "false") | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined | undefined;
    "aria-owns"?: string | undefined | undefined;
    "aria-placeholder"?: string | undefined | undefined;
    "aria-posinset"?: number | undefined | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | undefined;
    "aria-readonly"?: (boolean | "true" | "false") | undefined;
    "aria-relevant"?: "additions" | "additions removals" | "additions text" | "all" | "removals" | "removals additions" | "removals text" | "text" | "text additions" | "text removals" | undefined | undefined;
    "aria-required"?: (boolean | "true" | "false") | undefined;
    "aria-roledescription"?: string | undefined | undefined;
    "aria-rowcount"?: number | undefined | undefined;
    "aria-rowindex"?: number | undefined | undefined;
    "aria-rowindextext"?: string | undefined | undefined;
    "aria-rowspan"?: number | undefined | undefined;
    "aria-selected"?: (boolean | "true" | "false") | undefined;
    "aria-setsize"?: number | undefined | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined | undefined;
    "aria-valuemax"?: number | undefined | undefined;
    "aria-valuemin"?: number | undefined | undefined;
    "aria-valuenow"?: number | undefined | undefined;
    "aria-valuetext"?: string | undefined | undefined;
    dangerouslySetInnerHTML?: {
        __html: string | TrustedHTML;
    } | undefined | undefined;
    onCopy?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCopyCapture?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCut?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCutCapture?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onPaste?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onPasteCapture?: react.ClipboardEventHandler<HTMLButtonElement> | undefined;
    onCompositionEnd?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionEndCapture?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionStart?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionStartCapture?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionUpdate?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onCompositionUpdateCapture?: react.CompositionEventHandler<HTMLButtonElement> | undefined;
    onFocus?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onFocusCapture?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onBlur?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onBlurCapture?: react.FocusEventHandler<HTMLButtonElement> | undefined;
    onChange?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onChangeCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onBeforeInput?: react.InputEventHandler<HTMLButtonElement> | undefined;
    onBeforeInputCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInput?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInputCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onReset?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onResetCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onSubmit?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onSubmitCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInvalid?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onInvalidCapture?: react.FormEventHandler<HTMLButtonElement> | undefined;
    onLoad?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onError?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onErrorCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onKeyDown?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyDownCapture?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyPress?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyPressCapture?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyUp?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onKeyUpCapture?: react.KeyboardEventHandler<HTMLButtonElement> | undefined;
    onAbort?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onAbortCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlay?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlayCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlayThrough?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onCanPlayThroughCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onDurationChange?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onDurationChangeCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEmptied?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEmptiedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEncrypted?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEncryptedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEnded?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onEndedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedData?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedDataCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedMetadata?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadedMetadataCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadStart?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onLoadStartCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPause?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPauseCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlay?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlayCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlaying?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onPlayingCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onProgress?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onProgressCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onRateChange?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onRateChangeCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeeked?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeekedCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeeking?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSeekingCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onStalled?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onStalledCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSuspend?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSuspendCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onTimeUpdate?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onTimeUpdateCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onVolumeChange?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onVolumeChangeCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onWaiting?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onWaitingCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onAuxClick?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onAuxClickCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onClickCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onContextMenu?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onContextMenuCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onDoubleClick?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onDoubleClickCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onDrag?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEnd?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEndCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEnter?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragEnterCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragExit?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragExitCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragLeave?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragLeaveCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragOver?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragOverCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragStart?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDragStartCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDrop?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onDropCapture?: react.DragEventHandler<HTMLButtonElement> | undefined;
    onMouseDown?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseDownCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseEnter?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseLeave?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseMove?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseMoveCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOut?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOutCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOver?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseOverCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseUp?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onMouseUpCapture?: react.MouseEventHandler<HTMLButtonElement> | undefined;
    onSelect?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onSelectCapture?: react.ReactEventHandler<HTMLButtonElement> | undefined;
    onTouchCancel?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchCancelCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchEnd?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchEndCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchMove?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchMoveCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchStart?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onTouchStartCapture?: react.TouchEventHandler<HTMLButtonElement> | undefined;
    onPointerDown?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerDownCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerMove?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerMoveCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerUp?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerUpCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerCancel?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerCancelCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerEnter?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerLeave?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOver?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOverCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOut?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onPointerOutCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onGotPointerCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onGotPointerCaptureCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onLostPointerCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onLostPointerCaptureCapture?: react.PointerEventHandler<HTMLButtonElement> | undefined;
    onScroll?: react.UIEventHandler<HTMLButtonElement> | undefined;
    onScrollCapture?: react.UIEventHandler<HTMLButtonElement> | undefined;
    onWheel?: react.WheelEventHandler<HTMLButtonElement> | undefined;
    onWheelCapture?: react.WheelEventHandler<HTMLButtonElement> | undefined;
    onAnimationStart?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationStartCapture?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationEnd?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationEndCapture?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationIteration?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onAnimationIterationCapture?: react.AnimationEventHandler<HTMLButtonElement> | undefined;
    onTransitionEnd?: react.TransitionEventHandler<HTMLButtonElement> | undefined;
    onTransitionEndCapture?: react.TransitionEventHandler<HTMLButtonElement> | undefined;
}, HTMLElement>;

export { AddToCartButton, type AddToCartButtonProps, BUILDER_CHANNELS, BUILDER_ELEMENTS, BUTTON_RADII, BUTTON_SIZES, BUTTON_VARIANTS, BUY_BUTTON_DEFAULT_LABEL, BUY_BUTTON_UNAVAILABLE_LABEL, type BillingInterval, type BuilderChannel, type BuilderElementDefinition, type BuilderElementKey, type ButtonRadius, type ButtonSize, type ButtonVariant, BuyButton, type BuyButtonProps, BuyLinkButton, type BuyLinkButtonProps, CHECKOUT_CHANNEL_PARAM, CHECKOUT_ID_PLACEHOLDER, CHECKOUT_STATUS_TOKEN_PLACEHOLDER, type CartAvailability, CartButton, type CartButtonProps, type CartData, type CartLineItem, type CartProduct, CartProvider, type CartProviderProps, type CartState, type CartStatus, CartStore, type CartStoreOptions, type CheckoutStatusResult, type CustomerPortalLookup, DEFAULT_BASE_URL, DEFAULT_SNIPPET_API_BASE_URL, type ElementOption, type ElementOptionType, type ElementState, type ElementStyleOptions, FORBIDDEN_PRICE_INPUTS, GRID_MAX_ITEMS, INVALID_KEY_WARNING, type KeyClass, type LinkSummaryState, LivePrice, type LivePriceProps, type LivePriceRenderContext, LiveProductCard, type LiveProductCardProps, type LiveProductState, MANAGE_SUBSCRIPTION_DEFAULT_LABEL, MOUNTED_ATTRIBUTE, ManageSubscriptionLink, type ManageSubscriptionLinkProps, type MountBuilderElementsOptions, type MountRoot, PRICE_DISPLAY_TOGGLES, PRICE_ID_EXCEPTIONS, PRICE_NAME_RE, PRICING_INTERVAL_LABELS, PRICING_MAX_PLANS, type ParsedPaymentLink, type PaymentLinkSummary, type PricingAction, type PricingColumn, type PricingInterval, PricingTable, type PricingTableProps, type PricingTableRenderContext, ProductGrid, type ProductGridProps, type PublicCheckoutStatus, SECRET_KEY_PREFIXES, SECRET_KEY_WARNING, type SummaryResult, THANK_YOU_CONFIRMED_TEXT, THANK_YOU_DEFAULT_HEADING, THANK_YOU_PARAM, THANK_YOU_STATUS_PARAM, ThankYou, type ThankYouProps, type ThankYouState, type UseCartResult, type UseProductResult, type UseProductsResult, assertPublishableKey, buttonClassName, classifyKey, defaultPricingInterval, fetchCheckoutStatus, fetchPaymentLinkSummary, mountBuilderElements, normalizeBuilderChannel, parsePaymentLink, propsFromAttributes, readThankYouState, renderSnippet, resolveSnippetApiBaseUrl, resolveSnippetCheckoutBaseUrl, stripPriceInputs, thankYouSuccessUrl, toggleIntervals, useCart, useCartCount, useCartStore, useLiveProduct, usePaymentLinkSummary, useProduct, useProducts, withChannel };
