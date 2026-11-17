export type Example = {
  label: string;
  input: string;
  response?: { status: number; body: string };
};

const order = {
  id: "ord_9fK2mQ7xLp",
  status: "pending",
  currency: "USD",
  total: 64.5,
  items: [
    { sku: "TEE-BLK-M", name: "Heavyweight Tee, Black, M", qty: 2, unitPrice: 24, subtotal: 48 },
    { sku: "MUG-CERAMIC", name: "Ceramic Mug", qty: 1, unitPrice: 16.5, subtotal: 16.5 },
  ],
  customer: { id: "8f1c2d3e-6b7a-4c1d-9e2f-3a4b5c6d7e8f", email: "nino@example.com" },
  shipping: { method: "standard", estimatedDelivery: "2026-11-24", trackingUrl: null },
  createdAt: "2026-11-17T14:22:08Z",
};

export const examples: Example[] = [
  {
    label: "Create an order",
    input: `curl -X POST 'https://api.acme.dev/v1/users/8f1c2d3e-6b7a-4c1d-9e2f-3a4b5c6d7e8f/orders?expand=items&notify=true' \\
  -H 'Authorization: Bearer sk_live_51HkQ2xYz' \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: 0f9e8d7c-1a2b-4c3d-8e9f-a1b2c3d4e5f6' \\
  --data-raw '{"items":[{"sku":"TEE-BLK-M","qty":2,"note":"Gift wrap please"},{"sku":"MUG-CERAMIC","qty":1}],"shipping":{"name":"Nino Beridze","line1":"12 Rustaveli Ave","city":"Tbilisi","zip":"0108","country":"GE"},"coupon":null}'`,
    response: { status: 201, body: JSON.stringify(order) },
  },
  { label: "GitHub repo", input: "https://api.github.com/repos/vercel-labs/json-render" },
  { label: "Post comments", input: "https://jsonplaceholder.typicode.com/posts/1/comments" },
  {
    label: "Validation error",
    input: `curl -X PATCH 'https://api.acme.dev/v1/products/42' -H 'X-API-Key: key_live_9999' --json '{"price":-5,"tags":[]}'`,
    response: {
      status: 422,
      body: JSON.stringify({
        error: { code: "validation_failed", message: "Some fields are invalid.", fields: [{ field: "price", reason: "must be greater than 0" }] },
        requestId: "req_7Hc1Vb93",
      }),
    },
  },
];
