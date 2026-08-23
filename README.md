# Grocery Optimizer — Prototype 0.1

A deliberately small proof of concept for a Knoxville grocery-price optimizer.

## What works now

- Natural-language parsing for five prototype grocery types.
- Quantity extraction (for example, `3 lb organic grass-fed 85/15 ground beef`).
- Retailer offer comparison.
- Package-size optimization. If Kroger has a 3 lb package, the engine can choose it instead of blindly multiplying the 1 lb price.
- Netlify-ready serverless comparison endpoint.
- Mobile-friendly one-screen tester.

## Important

The values in `data/seed-prices.json` are **prototype seed data**, not guaranteed live shelf prices. The next milestone is replacing seed offers retailer-by-retailer with permitted live data connectors.

## Recognized prototype requests

- `3 lb organic grass-fed 85/15 ground beef`
- `4 organic broccoli`
- `2 organic cucumbers`
- `1 lb organic baby carrots`
- `2 mangoes`

## Local run

```bash
npm install
npx netlify dev
```

Then open the local Netlify URL shown in the terminal.

## Deploy

1. Create a new GitHub repository.
2. Upload/push the contents of this folder.
3. Create a new Netlify site from that repository.
4. Netlify will use `netlify.toml` automatically.

## Architecture

`public/`
- UI only.

`netlify/functions/compare.js`
- Parses the grocery request.
- Finds the canonical product.
- Groups retailer offers.
- Runs package optimization.
- Returns ranked retailer results.

`data/seed-prices.json`
- Temporary prototype data.
- Later replaced or supplemented by retailer adapters.

## Next milestone

Create a connector interface such as:

```js
searchOffer({
  retailer,
  market: "Knoxville, TN",
  query: {
    product: "ground beef",
    organic: true,
    grassFed: true,
    leanRatio: "85/15",
    quantity: 3,
    unit: "lb"
  }
})
```

Each retailer adapter should return normalized offers:

```js
{
  retailer: "Example",
  product: "Exact product title",
  packageQty: 1,
  packageUnit: "lb",
  price: 5.99,
  match: "exact",
  sourceUrl: "...",
  observedAt: "..."
}
```

The optimizer should not care where the offer came from. That separation is what lets us add Kroger, ALDI, Sprouts, and Earth Fare independently.
