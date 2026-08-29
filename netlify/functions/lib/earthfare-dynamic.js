/*
 * earthfare-dynamic.js
 *
 * Earth Fare-specific dynamic search adapter.
 *
 * This file does NOT scrape Earth Fare and does NOT
 * perform a web search directly.
 *
 * It configures the shared dynamic-search engine so
 * Earth Fare results from a future permitted search
 * provider can be validated, normalized, scored,
 * and safely passed into the Grocery Optimizer.
 */

const {
  createDynamicSearchAdapter
} = require("./dynamic-search");


/*
 * =====================================================
 * EARTH FARE MARKET
 * =====================================================
 */

const EARTH_FARE_DYNAMIC_MARKET = {
  retailer: "Earth Fare",
  city: "Knoxville",
  state: "TN",
  zip: "37934",
  address: "10903 Parkside Dr",
  market: "Knoxville, TN"
};


/*
 * =====================================================
 * SEARCH PROVIDER PLACEHOLDER
 *
 * We intentionally do not configure a provider yet.
 *
 * When we later connect a permitted public-search
 * provider, that provider will be injected here.
 *
 * Expected provider return shape:
 *
 * {
 *   source: "provider-name",
 *   records: [
 *     {
 *       retailer: "Earth Fare",
 *       title: "Organic Japanese Sweet Potato",
 *       brand: null,
 *       description: "...",
 *       size: "1 lb",
 *       price: 4.49,
 *       productId: "...",
 *       sourceUrl: "...",
 *       sourceType: "public-search-result",
 *       observedAt: "2026-08-29",
 *       marketConfirmed: true,
 *       locationConfirmed: false,
 *       attributes: {
 *         organic: true
 *       }
 *     }
 *   ]
 * }
 *
 * =====================================================
 */

const searchProvider = null;


/*
 * =====================================================
 * ADAPTER
 * =====================================================
 */

const earthFareDynamicAdapter =
  createDynamicSearchAdapter({
    retailer:
      EARTH_FARE_DYNAMIC_MARKET.retailer,

    city:
      EARTH_FARE_DYNAMIC_MARKET.city,

    state:
      EARTH_FARE_DYNAMIC_MARKET.state,

    zip:
      EARTH_FARE_DYNAMIC_MARKET.zip,

    address:
      EARTH_FARE_DYNAMIC_MARKET.address,

    market:
      EARTH_FARE_DYNAMIC_MARKET.market,

    /*
     * Dynamic search should be somewhat stricter than
     * our manually curated evidence files.
     */

    minimumMatchScore:
      60,

    minimumConfidenceScore:
      55,

    trustedSourceTypes: [
      "retailer-product-page",
      "retailer-search-result",
      "public-product-record",
      "public-search-result"
    ],

    searchProvider
  });


/*
 * =====================================================
 * PUBLIC FUNCTIONS
 * =====================================================
 */

async function searchEarthFareDynamic(
  request
) {
  return earthFareDynamicAdapter.search(
    request
  );
}


/*
 * =====================================================
 * HELPER STATUS
 * =====================================================
 */

function buildEarthFareDynamicStatus(
  result
) {
  const retrieval =
    result?.retrieval ||
    {};

  return {
    retailer:
      "Earth Fare",

    mode:
      "dynamic-public-search",

    attempted:
      Boolean(
        retrieval.attempted
      ),

    source:
      retrieval.source ||
      null,

    recordCount:
      Number(
        retrieval.recordCount ||
        0
      ),

    acceptedCount:
      Number(
        retrieval.acceptedCount ||
        0
      ),

    rejectedCount:
      Number(
        retrieval.rejectedCount ||
        0
      ),

    queries:
      Array.isArray(
        retrieval.queries
      )
        ? retrieval.queries
        : [],

    message:
      retrieval.message ||
      null,

    location:
      EARTH_FARE_DYNAMIC_MARKET
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  EARTH_FARE_DYNAMIC_MARKET,

  earthFareDynamicAdapter,

  searchEarthFareDynamic,

  buildEarthFareDynamicStatus
};
