# @revkeen/js

The RevKeen browser client. Use it in the browser with a **publishable key**
(`rk_pk_…`) to build carts and list storefront products.

```ts
import { RevKeenEnvironment, RevKeenPublishableClient } from "@revkeen/js";

const revkeen = new RevKeenPublishableClient({
  publishableKey: "rk_pk_…",
  environment: RevKeenEnvironment.Production,
});

const products = await revkeen.storefront.productsList();
```

Secret keys are rejected. For server code, use
[`@revkeen/sdk`](https://www.npmjs.com/package/@revkeen/sdk). For React
components, use [`@revkeen/react`](https://www.npmjs.com/package/@revkeen/react),
which builds on this package.
