type CartSessionResponse = {
    data: CartSession;
};
type CartSession = {
    id: string;
    object: "cart_session";
    merchant_id: string;
    customer_id: string | null;
    currency: string;
    mode: string;
    status: CartSessionStatus;
    line_items: Array<CartLineItem>;
    add_ons_offered: Array<string>;
    add_ons_selected: Array<string>;
    discount_code: string | null;
    /**
     * Captured customer email for recovery, if provided.
     */
    email: string | null;
    promotional_consent: boolean | null;
    sms_consent: boolean | null;
    subtotal_minor: number;
    total_minor: number;
    metadata: {
        [key: string]: unknown;
    } | null;
    converted_to_checkout_session_id: string | null;
    /**
     * Anon-access token. Use to build /c/[cart_session_id]?token=... URLs for customer-facing cart checkout. Open carts can be reviewed and edited; unexpired abandoned carts can be reviewed and converted as-is. Expired and converted carts are inaccessible.
     */
    public_token: string;
    created_at: string;
    updated_at: string;
    expires_at: string;
};
type CartSessionStatus = "open" | "converted" | "abandoned" | "expired";
type CartLineItem = {
    id: string;
    product_id: string;
    name: string;
    quantity: number;
    unit_price_minor: number;
    currency: string;
    recurring: CartLineItemRecurring;
    billing_max_cycles?: number | null;
    trial_period_days?: number | null;
    start_rule?: CartStartRule;
    billing_anchor_rule?: CartBillingAnchorRule;
    billing_anchor_day?: number | null;
    due_today_minor?: number | null;
    first_charge_minor?: number | null;
    first_renewal_at?: string | null;
    effective_start_rule?: CartStartRule;
    metadata?: {
        [key: string]: unknown;
    } | null;
};
type CartLineItemRecurring = {
    interval: "day" | "week" | "month" | "year";
    interval_count: number;
} | null;
type CartStartRule = "immediate" | "next_anchor" | "prorate" | null;
type CartBillingAnchorRule = "same_day" | "day_of_month" | "last_day" | null;
type CreateCartSessionInput = {
    currency: string;
    mode?: "payment" | "subscription" | "mixed";
    customer_id?: string;
    line_items?: Array<CartLineItemInput>;
    add_ons_offered?: Array<string>;
    metadata?: {
        [key: string]: unknown;
    };
    /**
     * Seed this cart from a cart-enabled payment link.
     */
    payment_link_id?: string;
};
type CartLineItemInput = {
    product_id: string;
    name: string;
    quantity: number;
    /**
     * Unit price in minor units (pence, cents).
     */
    unit_price_minor: number;
    currency: string;
    recurring?: CartLineItemRecurring;
    metadata?: {
        [key: string]: unknown;
    };
};
type UpdateCartLineItemInput = {
    quantity: number;
};
type ToggleCartAddOnInput = {
    product_id: string;
    selected: boolean;
};
type ApplyCartDiscountCodeInput = {
    /**
     * Discount code to apply. Pass `null` to clear. Valid discounts are priced into cart totals before checkout handoff.
     */
    code: string | null;
};
type SetCartContactInput = {
    /**
     * Customer email for abandoned-cart recovery. Pass `null` to clear.
     */
    email?: string | null;
    /**
     * Whether the customer consented to marketing/recovery email. Records the consent timestamp when set.
     */
    promotional_consent?: boolean | null;
    /**
     * Whether the customer consented to marketing/recovery SMS. Records the consent timestamp when set.
     */
    sms_consent?: boolean | null;
};
type CartConversionResponse = {
    data: {
        cart_session: CartSession;
        checkout_session: CartCheckoutSession;
    };
};
type CartCheckoutSession = {
    id: string;
    object: "checkout_session";
    merchant_id: string;
    customer_id: string | null;
    session_token: string | null;
    /**
     * Hosted checkout URL for this session, built server-side from the configured RevKeen checkout origin. Redirect the customer here. Null when the session has no token.
     */
    checkout_url?: string | null;
    status: string;
    mode: string | null;
    amount_minor: number | null;
    currency: string | null;
    line_items: Array<CartLineItem>;
    metadata: {
        [key: string]: unknown;
    } | null;
    expires_at: string | null;
    created_at: string | null;
    updated_at: string | null;
};
type StorefrontProductListResponse = {
    data: Array<StorefrontProduct>;
};
/**
 * Browser-safe product projection for headless storefronts: display data, active prices, and derived availability only.
 */
type StorefrontProduct = {
    id: string;
    object: "product";
    product_id: string | null;
    slug: string | null;
    name: string;
    description: string | null;
    kind: string;
    pricing_model: string;
    currency: string;
    image_url: string | null;
    default_price_id: string | null;
    prices: Array<StorefrontPrice>;
    trial_days: number;
    usage_meter_id: string | null;
    tax_behavior: string | null;
    tax_code: string | null;
    availability: StorefrontAvailability;
    /**
     * Merchant tags for store filters and search.
     */
    tags: Array<string>;
    /**
     * Extra images in display order. image_url stays the main image.
     */
    images: Array<StorefrontProductImage>;
    /**
     * Page title for search and social. Null means use the name.
     */
    seo_title: string | null;
    /**
     * Meta description. Null means use the description.
     */
    seo_description: string | null;
};
/**
 * Active price summary for storefront display. Amounts are minor units.
 */
type StorefrontPrice = {
    id: string;
    product_id: string;
    currency: string;
    unit_amount: number | null;
    unit_amount_decimal: string | null;
    type: string | null;
    interval: string | null;
    interval_count: number | null;
    billing_scheme: string;
    usage_type: string | null;
    package_size: number | null;
    trial_period_days: number | null;
    /**
     * The variant's options, e.g. {"Size":"M"}. Null when the price is not a variant.
     */
    option_values?: {
        [key: string]: string;
    } | null;
    /**
     * The variant's SKU. Null when not set.
     */
    sku?: string | null;
    /**
     * The variant's image as a browser URL. Null when not set.
     */
    image_url?: string | null;
};
/**
 * Derived availability (capacity + oversell − reserved − confirmed). `unknown` when the product does not track availability.
 */
type StorefrontAvailability = {
    status: "unknown" | "plenty" | "low" | "soldout";
    remaining: number | null;
    display_mode: string;
    low_stock_threshold: number | null;
};
/**
 * An extra product image as a browser URL. Show the photographer credit and link when present (required for Pexels images).
 */
type StorefrontProductImage = {
    url: string;
    alt: string | null;
    source: string;
    photographer: string | null;
    attribution_url: string | null;
};
type StorefrontProductResponse = {
    data: StorefrontProduct;
};
type StorefrontOriginListResponse = {
    data: Array<StorefrontOrigin>;
};
/**
 * A registered storefront origin allowed for publishable-key browser calls.
 */
type StorefrontOrigin = {
    id: string;
    object: "storefront_origin";
    origin: string;
    created_at: string;
};
type StorefrontOriginCreateResponse = {
    data: StorefrontOrigin;
};
type StorefrontOriginCreateRequest = {
    /**
     * Exact origin, e.g. https://shop.example.com or http://localhost:3000.
     */
    origin: string;
};
type StorefrontOriginDeleteResponse = {
    data: {
        id: string;
        deleted: true;
    };
};
type StorefrontStatusResponse = {
    data: StorefrontStatus;
};
type StorefrontStatus = {
    object: "storefront_status";
    ready: boolean;
    checks: Array<StorefrontStatusCheck>;
    cart: {
        enabled: boolean;
        profile: string;
    };
    keys: {
        publishable: StorefrontKeyStatus;
        secret: StorefrontKeyStatus;
    };
    origins: {
        count: number;
        origins: Array<string>;
    };
    product_read: {
        active_products: number;
        priced_products: number;
        ready: boolean;
    };
    webhooks: {
        active_endpoints: number;
        unreachable_endpoints: number;
    };
    availability: {
        tracked_products: number;
        mode: "enabled" | "not_configured";
    };
};
type StorefrontStatusCheck = {
    id: "cart_enabled" | "keys" | "origins" | "product_read" | "webhooks" | "availability";
    status: "pass" | "warn" | "fail";
    code?: "CART_DISABLED" | "KEYS_MISSING" | "ORIGIN_MISSING" | "PRODUCT_READ_UNAVAILABLE" | "WEBHOOK_MISSING" | "WEBHOOK_UNREACHABLE";
    message: string;
    next_action?: string;
};
/**
 * Managed Cart key presence. Key material is never returned.
 */
type StorefrontKeyStatus = {
    present: boolean;
    active: boolean;
    created_at: string | null;
    last_used_at: string | null;
};
type CartApiKeysStatus200ResponseData = {
    publishable: {
        kind: "publishable" | "secret";
        present: boolean;
        active: boolean;
        id: string | null;
        scopes: Array<string>;
        created_at: string | null;
        last_used_at: string | null;
        revoked_at: string | null;
    };
    secret: {
        kind: "publishable" | "secret";
        present: boolean;
        active: boolean;
        id: string | null;
        scopes: Array<string>;
        created_at: string | null;
        last_used_at: string | null;
        revoked_at: string | null;
    };
    ready: boolean;
    created?: Array<"publishable" | "secret">;
    publishable_api_key?: string;
    secret_api_key?: string;
};
type CartApiKeysRotate200ResponseData = {
    api_key: string;
    id: string;
    key_kind: "publishable" | "secret";
    rolled_from: string | null;
    old_key_expires_at: string | null;
    grace_hours: number;
};
type CartSessionsCreateData = {
    body?: CreateCartSessionInput;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path?: never;
    query?: never;
    url: "/cart-sessions";
};
type CartSessionsCreateResponses = {
    /**
     * Cart session created
     */
    201: CartSessionResponse;
};
type CartSessionsCreateResponse = CartSessionsCreateResponses[keyof CartSessionsCreateResponses];
type CartSessionsGetData = {
    body?: never;
    path: {
        id: string;
    };
    query?: never;
    url: "/cart-sessions/{id}";
};
type CartSessionsGetResponses = {
    /**
     * Cart session
     */
    200: CartSessionResponse;
};
type CartSessionsGetResponse = CartSessionsGetResponses[keyof CartSessionsGetResponses];
type CartSessionsAddLineItemData = {
    body?: CartLineItemInput;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/line-items";
};
type CartSessionsAddLineItemResponses = {
    /**
     * Line item added; updated cart returned
     */
    201: CartSessionResponse;
};
type CartSessionsAddLineItemResponse = CartSessionsAddLineItemResponses[keyof CartSessionsAddLineItemResponses];
type CartSessionsRemoveLineItemData = {
    body?: never;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
        /**
         * Cart line item id (the `id` field returned on `cart_session.line_items[]`).
         */
        lineId: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/line-items/{lineId}";
};
type CartSessionsRemoveLineItemResponses = {
    /**
     * Cart session
     */
    200: CartSessionResponse;
};
type CartSessionsRemoveLineItemResponse = CartSessionsRemoveLineItemResponses[keyof CartSessionsRemoveLineItemResponses];
type CartSessionsUpdateLineItemData = {
    body?: UpdateCartLineItemInput;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
        /**
         * Cart line item id (the `id` field returned on `cart_session.line_items[]`).
         */
        lineId: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/line-items/{lineId}";
};
type CartSessionsUpdateLineItemResponses = {
    /**
     * Cart session
     */
    200: CartSessionResponse;
};
type CartSessionsUpdateLineItemResponse = CartSessionsUpdateLineItemResponses[keyof CartSessionsUpdateLineItemResponses];
type CartSessionsToggleAddOnData = {
    body?: ToggleCartAddOnInput;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/add-ons";
};
type CartSessionsToggleAddOnResponses = {
    /**
     * Cart session
     */
    200: CartSessionResponse;
};
type CartSessionsToggleAddOnResponse = CartSessionsToggleAddOnResponses[keyof CartSessionsToggleAddOnResponses];
type CartSessionsApplyDiscountCodeData = {
    body?: ApplyCartDiscountCodeInput;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/discount-code";
};
type CartSessionsApplyDiscountCodeResponses = {
    /**
     * Cart session
     */
    200: CartSessionResponse;
};
type CartSessionsApplyDiscountCodeResponse = CartSessionsApplyDiscountCodeResponses[keyof CartSessionsApplyDiscountCodeResponses];
type CartSessionsSetContactData = {
    body?: SetCartContactInput;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/contact";
};
type CartSessionsSetContactResponses = {
    /**
     * Cart session
     */
    200: CartSessionResponse;
};
type CartSessionsSetContactResponse = CartSessionsSetContactResponses[keyof CartSessionsSetContactResponses];
type CartSessionsConvertData = {
    body?: never;
    headers?: {
        /**
         * Stable caller-owned key for this logical mutation. Reuse only with an identical request.
         */
        "Idempotency-Key"?: string;
    };
    path: {
        id: string;
    };
    query?: never;
    url: "/cart-sessions/{id}/convert";
};
type CartSessionsConvertResponses = {
    /**
     * Cart converted; updated cart + new checkout session returned
     */
    201: CartConversionResponse;
};
type CartSessionsConvertResponse = CartSessionsConvertResponses[keyof CartSessionsConvertResponses];
type CartApiKeysStatusResponses = {
    /**
     * Cart key status
     */
    200: {
        success: boolean;
        data: CartApiKeysStatus200ResponseData;
    };
};
type CartApiKeysStatusResponse = CartApiKeysStatusResponses[keyof CartApiKeysStatusResponses];
type CartApiKeysEnsureResponses = {
    /**
     * Cart keys are present or were created
     */
    200: {
        success: boolean;
        data: CartApiKeysStatus200ResponseData;
    };
};
type CartApiKeysEnsureResponse = CartApiKeysEnsureResponses[keyof CartApiKeysEnsureResponses];
type CartApiKeysRotateData = {
    body?: {
        grace_hours?: number;
    };
    path: {
        kind: "publishable" | "secret";
    };
    query?: never;
    url: "/cart-api-keys/{kind}/rotate";
};
type CartApiKeysRotateResponses = {
    /**
     * Cart key rotated
     */
    200: {
        success: boolean;
        data: CartApiKeysRotate200ResponseData;
    };
};
type CartApiKeysRotateResponse = CartApiKeysRotateResponses[keyof CartApiKeysRotateResponses];
type StorefrontProductsListData = {
    body?: never;
    path?: never;
    query?: {
        /**
         * Maximum products to return (default 50, max 100).
         */
        limit?: number;
        /**
         * Products to skip, for pagination.
         */
        offset?: number | null;
        /**
         * Only products in this product collection (id or URL handle).
         */
        collection?: string;
        /**
         * Only products carrying this tag.
         */
        tag?: string;
        /**
         * Case-insensitive match on product name or description.
         */
        search?: string;
        /**
         * featured (collection order, else newest), newest, name, price_asc or price_desc.
         */
        sort?: "featured" | "newest" | "name" | "price_asc" | "price_desc";
    };
    url: "/storefront/products";
};
type StorefrontProductsListResponses = {
    /**
     * Browser-safe product list
     */
    200: StorefrontProductListResponse;
};
type StorefrontProductsListResponse = StorefrontProductsListResponses[keyof StorefrontProductsListResponses];
type StorefrontProductsGetData = {
    body?: never;
    path: {
        /**
         * Product UUID, URL handle (slug), or merchant product reference.
         */
        productId: string;
    };
    query?: never;
    url: "/storefront/products/{productId}";
};
type StorefrontProductsGetResponses = {
    /**
     * Browser-safe product
     */
    200: StorefrontProductResponse;
};
type StorefrontProductsGetResponse = StorefrontProductsGetResponses[keyof StorefrontProductsGetResponses];
type StorefrontOriginsListResponses = {
    /**
     * Registered origins
     */
    200: StorefrontOriginListResponse;
};
type StorefrontOriginsListResponse = StorefrontOriginsListResponses[keyof StorefrontOriginsListResponses];
type StorefrontOriginsCreateData = {
    body?: StorefrontOriginCreateRequest;
    path?: never;
    query?: never;
    url: "/storefront/origins";
};
type StorefrontOriginsCreateResponses = {
    /**
     * Origin registered
     */
    201: StorefrontOriginCreateResponse;
};
type StorefrontOriginsCreateResponse = StorefrontOriginsCreateResponses[keyof StorefrontOriginsCreateResponses];
type StorefrontOriginsDeleteData = {
    body?: never;
    path: {
        /**
         * Storefront origin id.
         */
        originId: string;
    };
    query?: never;
    url: "/storefront/origins/{originId}";
};
type StorefrontOriginsDeleteResponses = {
    /**
     * Origin removed
     */
    200: StorefrontOriginDeleteResponse;
};
type StorefrontOriginsDeleteResponse = StorefrontOriginsDeleteResponses[keyof StorefrontOriginsDeleteResponses];
type StorefrontStatusGetResponses = {
    /**
     * Integration status report
     */
    200: StorefrontStatusResponse;
};
type StorefrontStatusGetResponse = StorefrontStatusGetResponses[keyof StorefrontStatusGetResponses];

interface RevKeenRequestOptions {
    /** A caller-owned stable key. The SDK never generates idempotency keys. */
    idempotencyKey?: string;
    /** Optional caller-supplied UUID used for both x-request-id and x-trace-id. */
    requestId?: string;
    /** Time allowed for response headers, in milliseconds. */
    connectTimeout?: number;
    /** Time allowed to consume the response body, in milliseconds. */
    readTimeout?: number;
    /** Per-call retry overrides. Unsafe operations remain single-attempt. */
    retry?: RevKeenRetryOptions;
    /** Cancels the request. Cancellation is never retried. */
    signal?: AbortSignal;
}
interface RevKeenRetryOptions {
    /** Total attempts including the first request. Must be an integer from 1 to 3. */
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
}

/**
 * AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
 *
 * Generated by: pnpm --dir packages/sdk generate:wrapper
 * Source of truth: packages/openapi/sdk-openapi.json
 */

interface CartResource {
    apiKeysEnsure: (requestOptions?: RevKeenRequestOptions) => Promise<CartApiKeysEnsureResponse>;
    apiKeysRotate: (id: NonNullable<CartApiKeysRotateData["path"]>["kind"], body?: NonNullable<CartApiKeysRotateData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartApiKeysRotateResponse>;
    apiKeysStatus: (requestOptions?: RevKeenRequestOptions) => Promise<CartApiKeysStatusResponse>;
    sessionsAddLineItem: (id: NonNullable<CartSessionsAddLineItemData["path"]>["id"], body?: NonNullable<CartSessionsAddLineItemData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsAddLineItemResponse>;
    sessionsApplyDiscountCode: (id: NonNullable<CartSessionsApplyDiscountCodeData["path"]>["id"], body?: NonNullable<CartSessionsApplyDiscountCodeData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsApplyDiscountCodeResponse>;
    sessionsConvert: (id: NonNullable<CartSessionsConvertData["path"]>["id"], requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsConvertResponse>;
    sessionsCreate: (body?: NonNullable<CartSessionsCreateData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsCreateResponse>;
    sessionsGet: (id: NonNullable<CartSessionsGetData["path"]>["id"], requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsGetResponse>;
    sessionsRemoveLineItem: (path: NonNullable<CartSessionsRemoveLineItemData["path"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsRemoveLineItemResponse>;
    sessionsSetContact: (id: NonNullable<CartSessionsSetContactData["path"]>["id"], body?: NonNullable<CartSessionsSetContactData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsSetContactResponse>;
    sessionsToggleAddOn: (id: NonNullable<CartSessionsToggleAddOnData["path"]>["id"], body?: NonNullable<CartSessionsToggleAddOnData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsToggleAddOnResponse>;
    sessionsUpdateLineItem: (params: {
        path: NonNullable<CartSessionsUpdateLineItemData["path"]>;
        body?: NonNullable<CartSessionsUpdateLineItemData["body"]>;
    }, requestOptions?: RevKeenRequestOptions) => Promise<CartSessionsUpdateLineItemResponse>;
}
interface StorefrontResource {
    originsCreate: (body?: NonNullable<StorefrontOriginsCreateData["body"]>, requestOptions?: RevKeenRequestOptions) => Promise<StorefrontOriginsCreateResponse>;
    originsDelete: (id: NonNullable<StorefrontOriginsDeleteData["path"]>["originId"], requestOptions?: RevKeenRequestOptions) => Promise<StorefrontOriginsDeleteResponse>;
    originsList: (requestOptions?: RevKeenRequestOptions) => Promise<StorefrontOriginsListResponse>;
    productsGet: (id: NonNullable<StorefrontProductsGetData["path"]>["productId"], requestOptions?: RevKeenRequestOptions) => Promise<StorefrontProductsGetResponse>;
    productsList: (query?: NonNullable<StorefrontProductsListData["query"]>, requestOptions?: RevKeenRequestOptions) => Promise<StorefrontProductsListResponse>;
    statusGet: (requestOptions?: RevKeenRequestOptions) => Promise<StorefrontStatusGetResponse>;
}

declare enum RevKeenEnvironment {
    Sandbox = "sandbox",
    Production = "production"
}

interface RevKeenClientBaseOptions {
    /** @deprecated Use connectTimeout and readTimeout for explicit phases. */
    timeout?: number;
    connectTimeout?: number;
    readTimeout?: number;
    retry?: RevKeenRetryOptions;
    requestIdFactory?: () => string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
}

interface RevKeenBrowserClientOptions extends RevKeenClientBaseOptions {
    publishableKey: string;
    environment: RevKeenEnvironment;
}
interface RevKeenBrowserCustomBaseUrlClientOptions extends RevKeenClientBaseOptions {
    publishableKey: string;
}
type BrowserCartResource = Pick<CartResource, "sessionsAddLineItem" | "sessionsApplyDiscountCode" | "sessionsConvert" | "sessionsCreate" | "sessionsGet" | "sessionsRemoveLineItem" | "sessionsSetContact" | "sessionsToggleAddOn" | "sessionsUpdateLineItem">;
type BrowserStorefrontResource = Pick<StorefrontResource, "productsGet" | "productsList">;
declare class RevKeenPublishableClient {
    readonly cart: BrowserCartResource;
    readonly storefront: BrowserStorefrontResource;
    constructor({ publishableKey, environment, ...options }: RevKeenBrowserClientOptions);
    static forCustomBaseUrl(baseUrl: string, { publishableKey, ...options }: RevKeenBrowserCustomBaseUrlClientOptions): RevKeenPublishableClient;
}

export { type BrowserCartResource, type BrowserStorefrontResource, RevKeenPublishableClient as RevKeenBrowserClient, type RevKeenBrowserClientOptions, type RevKeenBrowserCustomBaseUrlClientOptions, RevKeenEnvironment, RevKeenPublishableClient, type RevKeenRequestOptions };
