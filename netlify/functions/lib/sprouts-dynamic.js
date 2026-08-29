/*
 * sprouts-dynamic.js
 *
 * Dynamic-search adapter plumbing for Sprouts.
 *
 * IMPORTANT:
 * This file does NOT scrape Sprouts.
 * It does NOT currently have a live search provider.
 *
 * It gives Sprouts the same architecture as Earth Fare:
 *
 * stored evidence
 *      ↓ no match
 * dynamic adapter
 *      ↓
 * permitted provider when one becomes available
 *
 * For now, custom products can still become available
 * through the evidence-refresh workflow we already built.
 */

const {
  createDynamicSearchAdapter
} = require("./dynamic-search");


/*
 * =====================================================
 * SPROUTS MARKET
 * =====================================================
 */

const SPROUTS_DYNAMIC_MARKET = {
  retailer: "Sprouts",
  city: "Knoxville",
  state: "TN",
  zip: "37922",
  address: "9622 Kingston Pike",
  market: "Knoxville, TN"
};


/*
 * =====================================================
 * SEARCH PROVIDER
 *
 * Intentionally null.
 *
 * We will not plug in:
 * - paid search APIs
 * - prohibited storefront scraping
 * - automated Google/Bing/other SERP scraping
 *
 * The adapter is ready for a future permitted source.
 * =====================================================
 */

const searchProvider = null;


/*
 * =====================================================
 * DYNAMIC ADAPTER
 * =====================================================
 */

const sproutsDynamicAdapter =
  createDynamicSearchAdapter({
    retailer: "Sprouts",

    market:
      SPROUTS_DYNAMIC_MARKET,

    minimumMatchScore:
      60,

    minimumConfidenceScore:
      55,

    trustedSourceTypes: [
      "retailer-product-page",
      "retailer-weekly-ad",
      "retailer-digital-ad",
      "public-product-record",
      "public-indexed-product-page"
    ],

    searchProvider
  });


/*
 * =====================================================
 * SEARCH
 * =====================================================
 */

async function searchSproutsDynamic(
  request
) {
  return sproutsDynamicAdapter.search(
    request
  );
}


/*
 * =====================================================
 * STATUS
 * =====================================================
 */

function buildSproutsDynamicStatus(
  result
) {
  const retrieval =
    result?.retrieval ||
    {};

  const offers =
    Array.isArray(
      result?.offers
    )
      ? result.offers
      : [];

  return {
    retailer:
      "Sprouts",

    configured:
      typeof searchProvider ===
      "function",

    attempted:
      Boolean(
        retrieval.attempted
      ),

    source:
      retrieval.source ||
      "sprouts-dynamic-search",

    acceptedCount:
      offers.length,

    message:
      retrieval.message ||
      (
        typeof searchProvider ===
        "function"
          ? "Sprouts dynamic search provider is configured."
          : "Dynamic search adapter is ready, but no permitted search provider is configured."
      ),

    location:
      SPROUTS_DYNAMIC_MARKET
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  SPROUTS_DYNAMIC_MARKET,

  sproutsDynamicAdapter,

  searchSproutsDynamic,

  buildSproutsDynamicStatus
};
