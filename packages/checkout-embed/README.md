# @revkeen/checkout-embed

Thin loader for the RevKeen **embeddable Direct Debit capture** surface, for
merchants on a bundler / npm stack. REV-3943.

Like [`@stripe/stripe-js`](https://github.com/stripe/stripe-js), this package does
**not** contain the runtime — it injects the CDN-hosted, RevKeen-served bundle
(`https://releases.revkeen.com/embed/v{N}/checkout.js`) and resolves with the global
`RevKeenEmbed` API. The runtime captures bank details and is served from a RevKeen
origin only; **never self-host or re-bundle it.**

## Install

```bash
npm install @revkeen/checkout-embed
```

## Usage

```ts
import { loadRevKeenEmbed } from "@revkeen/checkout-embed";

const embed = await loadRevKeenEmbed(); // injects releases.revkeen.com/embed/v1/checkout.js
const instance = embed.mountDD("#dd", {
  merchantSlug: "acme",
  apiBaseUrl: "https://checkout.revkeen.com",
  onSuccess: (mandate) => console.log("mandate", mandate.mandateRef),
});

// later
instance.unmount();
```

Pin a different major version:

```ts
const embed = await loadRevKeenEmbed({ version: "v2" });
```

For plain HTML (no bundler), drop the `<script>` tag directly and use the
`data-revkeen-dd` auto-mount instead — see `apps/checkout-embed`.

## Notes

- Idempotent: concurrent `loadRevKeenEmbed()` calls share one in-flight load; an
  already-present global resolves immediately.
- The form calls RevKeen's hosted `/api/dd/*` cross-origin; the merchant's origin
  must be on the DD embed CORS allow-list (REV-3946).
