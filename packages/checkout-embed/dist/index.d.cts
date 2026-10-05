/**
 * @revkeen/checkout-embed — thin loader for the RevKeen embeddable DD capture
 * surface, for merchants on a bundler/npm stack.
 *
 * Mirrors the `@stripe/stripe-js` model: this package does NOT contain the runtime
 * — it injects the CDN-hosted, RevKeen-served bundle
 * (`https://releases.revkeen.com/embed/v{N}/checkout.js`) and resolves with the global
 * `RevKeenEmbed` API. Merchants must never self-host or re-bundle the runtime
 * (the bundle captures bank details and is served from a RevKeen origin only).
 *
 * Types here are intentionally standalone (no internal deps) so the package is
 * publishable; they mirror the public mount surface of `@revkeen/dd-capture`.
 */
interface MandateResult {
    id: string;
    mandateRef: string;
    accountHolderName: string;
    /** Masked, e.g. `XX-XX-**`. */
    sortCode: string;
    accountNumberLast4: string;
    bankName?: string;
    firstCollectionDate?: string;
}
/** Public options for `RevKeenEmbed.mountDD`. `merchantSlug` is required. */
interface MountDDOptions {
    merchantSlug: string;
    merchantId?: string;
    customerId?: string;
    requestToken?: string;
    /** RevKeen-hosted checkout origin serving `/api/dd/*`. Defaults server-side. */
    apiBaseUrl?: string;
    accentColor?: string;
    merchantName?: string;
    merchantLogo?: string;
    captureSource?: "standalone" | "checkout" | "portal";
    onSuccess?: (mandate: MandateResult) => void;
    onError?: (error: string) => void;
}
interface EmbedInstance {
    unmount(): void;
}
interface CartLineItem {
    id: string;
    product_id: string;
    price_id?: string | null;
    name: string;
    quantity: number;
    unit_price_minor: number;
    currency: string;
    recurring?: {
        interval: "day" | "week" | "month" | "year";
        interval_count: number;
    } | null;
    billing_max_cycles?: number | null;
    trial_period_days?: number | null;
    start_rule?: "immediate" | "next_anchor" | "prorate" | null;
    billing_anchor_rule?: "same_day" | "day_of_month" | "last_day" | null;
    billing_anchor_day?: number | null;
    due_today_minor?: number | null;
    first_charge_minor?: number | null;
    first_renewal_at?: string | null;
    effective_start_rule?: "immediate" | "next_anchor" | "prorate" | null;
    tax_behavior?: "exclusive" | "inclusive" | "location" | string | null;
    tax_code?: string | null;
    tax_inclusive?: boolean | null;
    metadata?: Record<string, unknown> | null;
}
interface ResolvedAddOn {
    product_id: string;
    name: string;
    price_minor: number;
    currency: string;
    recurring: null;
    quantity?: number | null;
    parent_line_id?: string | null;
    metadata?: Record<string, unknown> | null;
}
interface CartData {
    id: string;
    merchant_id: string;
    customer_id: string | null;
    currency: string;
    mode: string;
    status: string;
    line_items: CartLineItem[];
    add_ons_offered: ResolvedAddOn[];
    add_ons_selected: ResolvedAddOn[];
    discount_code: string | null;
    subtotal_minor: number;
    total_minor: number;
    metadata: Record<string, unknown> | null;
    converted_to_checkout_session_id: string | null;
    expires_at: string;
}
interface CartProductRef {
    productId: string;
    priceId?: string | null;
    quantity?: number;
}
interface MountCartOptions {
    /**
     * Publishable Cart key (`rk_pk_live_*` / `rk_pk_sandbox_*`). Required for
     * `/public/embed` create, mutate and convert; slug-only callers are
     * deprecated (sunset 6 Oct 2026). Never pass a secret key — the runtime
     * refuses anything that is not `rk_pk_*`. The page's origin must be
     * registered for the merchant (`/v2/storefront/origins`).
     */
    publishableKey?: string;
    merchantId?: string;
    merchantSlug?: string;
    apiBaseUrl?: string;
    /** Hosted checkout/pay-domain origin used after cart conversion. */
    checkoutBaseUrl?: string;
    /** Optional PostHog project key for direct cart funnel capture. */
    posthogKey?: string;
    /** PostHog ingest host. Defaults to the EU cloud host. */
    posthogHost?: string;
    /** Optional stable PostHog distinct id supplied by the merchant page. */
    posthogDistinctId?: string;
    currency?: string;
    accentColor?: string;
    merchantName?: string;
    logoUrl?: string;
    drawerPosition?: "left" | "right";
    /** Inject RevKeen's default fixed bottom-right floating cart button. */
    floatingButton?: boolean;
    /** Accessible base label for the injected floating button. */
    floatingButtonLabel?: string;
    /** Merchant terms URL rendered in the drawer footer. Omitted → no link. */
    termsUrl?: string;
    /** Merchant privacy policy URL rendered in the drawer footer. Omitted → no link. */
    privacyUrl?: string;
    /** URL of the merchant's full cart page; the drawer links to it ("View full cart"). */
    cartPageUrl?: string;
    addOnsOffered?: string[];
    metadata?: Record<string, unknown>;
    onCartChange?: (cart: CartData | null) => void;
    onCheckout?: (detail: {
        sessionToken: string;
        checkoutUrl: string;
    }) => boolean | void;
    onError?: (error: Error) => void;
}
interface CartDrawerInstance extends DrawerInstance {
    addItem(item: CartProductRef): Promise<CartData | null>;
    checkoutItem(item: CartProductRef): Promise<void>;
    getCart(): CartData | null;
    getCount(): number;
    subscribeCount(listener: CartCountListener): () => void;
    attachTrigger(target: string | HTMLElement, options?: AttachCartTriggerOptions): () => void;
    /**
     * Render the full cart page into a host element, showing the same cart
     * session as this drawer. Bundles released before this method existed do
     * not have it, so feature-detect before calling.
     */
    mountCartPage(target: string | HTMLElement, options?: MountCartPageOptions): EmbedInstance;
}
/** Options for a cart page rendered by `mountCartPage`. */
interface MountCartPageOptions {
    /** Where "Continue shopping" and "Keep browsing" go. Defaults to "/". */
    continueShoppingUrl?: string;
}
interface CartCountDetail {
    count: number;
    cart: CartData | null;
}
type CartCountListener = (detail: CartCountDetail) => void;
interface AttachCartTriggerOptions {
    label?: string;
    updateCount?: boolean;
}
/**
 * Options for `RevKeenEmbed.mountCheckout` — the hosted checkout for one
 * session, iframed into the merchant page (`/p/{token}?embed=true`). Which
 * origins may embed it is enforced server-side by `frame-ancestors`.
 */
interface MountCheckoutOptions {
    /** Checkout session token (e.g. `rvk_cs_…`). Required. */
    sessionToken: string;
    /** RevKeen checkout origin. Defaults to the hosted checkout origin. */
    apiBaseUrl?: string;
    onReady?: () => void;
    onResize?: (height: number) => void;
    onSuccess?: (detail?: unknown) => void;
    onError?: (detail?: unknown) => void;
}
interface DrawerInstance extends EmbedInstance {
    open(): void;
    close(): void;
}
interface RevKeenEmbedApi {
    mountDD(target: string | HTMLElement, options: MountDDOptions): EmbedInstance;
    mountDDDrawer(options: MountDDOptions): DrawerInstance;
    mountCheckout(target: string | HTMLElement, options: MountCheckoutOptions): EmbedInstance;
    mountCart(options: MountCartOptions): CartDrawerInstance;
    /** Mount a cart (drawer included) and render its full cart page into the target. */
    mountCartPage(target: string | HTMLElement, options: MountCartOptions & MountCartPageOptions): CartDrawerInstance;
    readonly version: string;
}
interface LoadOptions {
    /** Pinned major-version path segment of the CDN bundle. Default `"v1"`. */
    version?: string;
    /** Full script `src` override (advanced / local testing). */
    scriptSrc?: string;
}
declare global {
    interface Window {
        RevKeenEmbed?: RevKeenEmbedApi;
    }
}
/**
 * Inject (once) the CDN-hosted RevKeen embed bundle and resolve with the global
 * `RevKeenEmbed` API. Idempotent: concurrent calls share one in-flight load, and
 * an already-present global resolves immediately.
 */
declare function loadRevKeenEmbed(options?: LoadOptions): Promise<RevKeenEmbedApi>;

export { type AttachCartTriggerOptions, type CartCountDetail, type CartCountListener, type CartData, type CartDrawerInstance, type CartLineItem, type CartProductRef, type DrawerInstance, type EmbedInstance, type LoadOptions, type MandateResult, type MountCartOptions, type MountCartPageOptions, type MountCheckoutOptions, type MountDDOptions, type ResolvedAddOn, type RevKeenEmbedApi, loadRevKeenEmbed };
