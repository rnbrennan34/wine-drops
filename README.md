# Wine Drops

Tracks wine prices daily across independent US shops and shows which discounts are real.

- `npm run daily` pulls every shop in `scripts/stores.mjs`, appends price changes to `data/history.json`, and writes `site/data.json`.
- `site/` is a static page. No server, no accounts. The watchlist lives in the browser.
- A discount counts as real when the price fell at the same shop since tracking began, or the same bottle, vintage and size costs more at another shop today. A shop's own "was" price is shown separately and checked against other shops where possible.
- Add a shop: any Shopify storefront that answers `/products.json` is one line in `scripts/stores.mjs`.
