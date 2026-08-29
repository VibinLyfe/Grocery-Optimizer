/*
 * compare.js
 *
 * Grocery Optimizer comparison engine.
 *
 * INTERNAL NORMALIZATION
 * ----------------------
 * Weight -> ounces
 * Liquid -> fluid ounces
 * Count  -> each
 *
 * DATA SOURCES
 * ------------
 * Kroger:
 *   Live official Kroger API
 *
 * Sprouts:
 *   Dated retailer evidence from
 *   data/sprouts-evidence.json
 *
 * ALDI / Earth Fare:
 *   Prototype seed data
 *
 * SPROUTS FRESHNESS
 * -----------------
 * 0–7 days   -> current
 * 8–14 days  -> aging
 * 15+ days   -> stale
 */

const fs = require("fs");
const path = require("path");

const {
  normalizeUnit,
  normalizeRequest,
  normalizeOffer,
  detectAttributes,
  scoreProductMatch,
  calculatePackageRequirement
} = require("./lib/normalize");

const {
  getSproutsOffers,
  SPROUTS_MARKET
} = require("./lib/sprouts");


/*
 * =====================================================
 * CONSTANTS
 * =====================================================
 */

const KROGER_BASE =
  "https://api.kroger.com/v1";

const TARGET_ZIP =
  "37922";

const TARGET_ADDRESS =
  "9225 KINGSTON PIKE";


let tokenCache = {
  token: null,
  expiresAt: 0
};


/*
 * =====================================================
 * RESPONSE
 * =====================================================
 */

function json(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "Content-Type":
        "application/json",

      "Cache-Control":
        "no-store"
    },

    body:
      JSON.stringify(body)
  };
}


/*
 * =====================================================
 * HELPERS
 * =====================================================
 */

function round(
  value,
  decimals = 2
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      number * factor
    ) / factor
  );
}


function cleanText(value) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );
}


/*
 * =====================================================
 * NORMALIZED QUANTITY -> SHOPPER DISPLAY QUANTITY
 * =====================================================
 */

function normalizedToDisplay(
  normalizedQuantity,
  requestedUnit
) {
  const qty =
    Number(
      normalizedQuantity
    );

  if (
    !Number.isFinite(qty)
  ) {
    return null;
  }


  const unit =
    normalizeUnit(
      requestedUnit
    );


  switch (unit) {

    case "lb":
      return qty / 16;

    case "oz":
      return qty;

    case "g":
      return (
        qty *
        28.349523125
      );

    case "kg":
      return (
        qty /
        35.27396195
      );

    case "fl_oz":
      return qty;

    case "pint":
      return qty / 16;

    case "quart":
      return qty / 32;

    case "gallon":
      return qty / 128;

    case "ml":
      return (
        qty *
        29.5735295625
      );

    case "liter":
      return (
        qty /
        33.8140227018
      );

    case "each":
      return qty;

    default:
      return qty;
  }
}


/*
 * =====================================================
 * DISPLAY UNIT
 * =====================================================
 */

function displayUnit(unit) {
  const normalized =
    normalizeUnit(unit);

  if (
    normalized ===
    "fl_oz"
  ) {
    return "fl oz";
  }

  return normalized;
}


/*
 * =====================================================
 * DATE HELPERS
 * =====================================================
 */

function validDateString(value) {
  if (!value) {
    return null;
  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }


  return value;
}


function newestObservedAt(
  offers
) {
  const dates =
    offers
      .map(
        offer =>
          validDateString(
            offer.observedAt ||
            offer.source
              ?.observedAt
          )
      )
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b) -
          new Date(a)
      );


  return (
    dates[0] ||
    null
  );
}


/*
 * =====================================================
 * FRESHNESS SUMMARY
 * =====================================================
 */

function summarizeFreshness(
  offers
) {
  if (
    !Array.isArray(
      offers
    ) ||
    !offers.length
  ) {

    return {
      freshness: null,
      ageDays: null,
      needsRefresh: null
    };
  }


  const freshnessOffers =
    offers.filter(
      offer =>
        offer.freshness ||
        Number.isFinite(
          Number(
            offer.ageDays
          )
        ) ||
        typeof
          offer.needsRefresh ===
          "boolean"
    );


  if (
    !freshnessOffers.length
  ) {

    return {
      freshness: null,
      ageDays: null,
      needsRefresh: null
    };
  }


  const rank = {
    current: 1,
    aging: 2,
    stale: 3,
    unknown: 4
  };


  let freshness =
    "current";


  for (
    const offer of
    freshnessOffers
  ) {

    const candidate =
      offer.freshness ||
      "unknown";


    if (
      (
        rank[candidate] ||
        99
      ) >
      (
        rank[freshness] ||
        0
      )
    ) {
      freshness =
        candidate;
    }
  }


  const ages =
    freshnessOffers
      .map(
        offer =>
          Number(
            offer.ageDays
          )
      )
      .filter(
        Number.isFinite
      );


  const ageDays =
    ages.length
      ? Math.max(
          ...ages
        )
      : null;


  const needsRefresh =
    freshnessOffers.some(
      offer =>
        offer.needsRefresh ===
        true
    );


  return {
    freshness,
    ageDays,
    needsRefresh
  };
}


/*
 * =====================================================
 * USER REQUEST PARSER
 * =====================================================
 */

function parseRequest(text) {
  const raw =
    String(
      text || ""
    ).trim();

  const lower =
    raw.toLowerCase();


  let qty = 1;
  let unit = "each";


  /*
   * WEIGHT
   */

  const lbMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/
    );

  const ozMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:oz|ounce|ounces)\b/
    );

  const kgMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:kg|kilogram|kilograms)\b/
    );

  const gramMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:g|gram|grams)\b/
    );


  /*
   * LIQUID
   */

  const gallonMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:gallon|gallons|gal|gals)\b/
    );

  const quartMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:quart|quarts|qt|qts)\b/
    );

  const pintMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:pint|pints|pt|pts)\b/
    );

  const fluidOunceMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz\.?|floz|fluid ounces?)\b/
    );

  const literMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:liter|liters|litre|litres)\b/
    );

  const mlMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:ml|milliliter|milliliters)\b/
    );


  if (lbMatch) {

    qty =
      Number(
        lbMatch[1]
      );

    unit =
      "lb";

  } else if (
    ozMatch
  ) {

    qty =
      Number(
        ozMatch[1]
      );

    unit =
      "oz";

  } else if (
    kgMatch
  ) {

    qty =
      Number(
        kgMatch[1]
      );

    unit =
      "kg";

  } else if (
    gramMatch
  ) {

    qty =
      Number(
        gramMatch[1]
      );

    unit =
      "g";

  } else if (
    gallonMatch
  ) {

    qty =
      Number(
        gallonMatch[1]
      );

    unit =
      "gallon";

  } else if (
    quartMatch
  ) {

    qty =
      Number(
        quartMatch[1]
      );

    unit =
      "quart";

  } else if (
    pintMatch
  ) {

    qty =
      Number(
        pintMatch[1]
      );

    unit =
      "pint";

  } else if (
    fluidOunceMatch
  ) {

    qty =
      Number(
        fluidOunceMatch[1]
      );

    unit =
      "fl oz";

  } else if (
    literMatch
  ) {

    qty =
      Number(
        literMatch[1]
      );

    unit =
      "liter";

  } else if (
    mlMatch
  ) {

    qty =
      Number(
        mlMatch[1]
      );

    unit =
      "ml";

  } else {

    const leading =
      lower.match(
        /^\s*(\d+(?:\.\d+)?)\b/
      );


    if (
      leading
    ) {
      qty =
        Number(
          leading[1]
        );
    }


    unit =
      "each";
  }


  /*
   * ===================================================
   * PRODUCT RECOGNITION
   * ===================================================
   */

  let canonical =
    null;

  let krogerTerm =
    raw;


  if (
    lower.includes(
      "ground beef"
    ) &&
    lower.includes(
      "organic"
    ) &&
    lower.includes(
      "grass"
    ) &&
    (
      lower.includes(
        "85/15"
      ) ||
      lower.includes(
        "85 15"
      )
    )
  ) {

    canonical =
      "ground-beef-organic-grassfed-85-15";


    if (
      unit ===
      "each"
    ) {
      unit =
        "lb";
    }


    krogerTerm =
      "organic grass fed 85/15 ground beef";

  } else if (
    lower.includes(
      "broccoli"
    ) &&
    lower.includes(
      "organic"
    )
  ) {

    canonical =
      "organic-broccoli";

    krogerTerm =
      "organic broccoli";

  } else if (
    lower.includes(
      "cucumber"
    ) &&
    lower.includes(
      "organic"
    )
  ) {

    canonical =
      "organic-cucumber";

    krogerTerm =
      "organic cucumber";

  } else if (
    lower.includes(
      "baby carrot"
    ) &&
    lower.includes(
      "organic"
    )
  ) {

    canonical =
      "organic-baby-carrots";


    if (
      unit ===
      "each"
    ) {
      unit =
        "lb";
    }


    krogerTerm =
      "organic baby carrots";

  } else if (
    lower.includes(
      "mango"
    )
  ) {

    canonical =
      "mango";

    krogerTerm =
      "mango";
  }


  const attributes =
    detectAttributes(
      raw
    );


  const normalized =
    normalizeRequest({
      quantity:
        qty,

      unit,

      description:
        raw,

      canonicalId:
        canonical,

      attributes
    });


  return {
    raw,
    qty,
    unit,
    canonical,
    krogerTerm,
    attributes,
    normalized
  };
}


/*
 * =====================================================
 * SEED DATA
 * =====================================================
 */

function loadSeedData() {
  const possiblePaths = [
    path.join(
      process.cwd(),
      "data",
      "seed-prices.json"
    ),

    path.join(
      process.cwd(),
      "data",
      "seedPrices.json"
    )
  ];


  const dataPath =
    possiblePaths.find(
      candidate =>
        fs.existsSync(
          candidate
        )
    );


  if (
    !dataPath
  ) {
    throw new Error(
      "Seed price file could not be found."
    );
  }


  return JSON.parse(
    fs.readFileSync(
      dataPath,
      "utf8"
    )
  );
}


/*
 * =====================================================
 * KROGER OAUTH
 * =====================================================
 */

async function getKrogerToken() {
  const now =
    Date.now();


  if (
    tokenCache.token &&
    now <
      tokenCache.expiresAt
  ) {
    return (
      tokenCache.token
    );
  }


  const clientId =
    process.env
      .KROGER_CLIENT_ID;

  const clientSecret =
    process.env
      .KROGER_CLIENT_SECRET;


  if (
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "Kroger environment variables are missing in Netlify."
    );
  }


  const basic =
    Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString(
      "base64"
    );


  const response =
    await fetch(
      `${KROGER_BASE}/connect/oauth2/token`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Basic ${basic}`,

          "Content-Type":
            "application/x-www-form-urlencoded",

          Accept:
            "application/json"
        },

        body:
          new URLSearchParams({
            grant_type:
              "client_credentials",

            scope:
              "product.compact"
          }).toString()
      }
    );


  const text =
    await response.text();


  if (
    !response.ok
  ) {
    throw new Error(
      `Kroger OAuth failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }


  const data =
    JSON.parse(text);


  tokenCache.token =
    data.access_token;


  tokenCache.expiresAt =
    now +
    Math.max(
      60,

      Number(
        data.expires_in ||
        1800
      ) - 60
    ) *
      1000;


  return (
    tokenCache.token
  );
}


/*
 * =====================================================
 * KROGER FETCH
 * =====================================================
 */

async function krogerFetch(url) {
  const token =
    await getKrogerToken();


  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json"
        }
      }
    );


  const text =
    await response.text();


  if (
    !response.ok
  ) {
    throw new Error(
      `Kroger API failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }


  return (
    JSON.parse(text)
  );
}


/*
 * =====================================================
 * TARGET KROGER
 * =====================================================
 */

async function findTargetKroger() {
  const params =
    new URLSearchParams({
      "filter.zipCode.near":
        TARGET_ZIP,

      "filter.radiusInMiles":
        "10",

      "filter.limit":
        "20",

      "filter.chain":
        "Kroger"
    });


  const payload =
    await krogerFetch(
      `${KROGER_BASE}/locations?${params.toString()}`
    );


  const stores =
    payload.data ||
    [];


  if (
    !stores.length
  ) {
    throw new Error(
      `No Kroger locations returned near ${TARGET_ZIP}.`
    );
  }


  const exact =
    stores.find(
      store => {

        const address =
          [
            store.address
              ?.addressLine1,

            store.address
              ?.city,

            store.address
              ?.state,

            store.address
              ?.zipCode
          ]
            .filter(Boolean)
            .join(" ")
            .toUpperCase();


        return (
          address.includes(
            TARGET_ADDRESS
          )
        );
      }
    );


  const cedarBluff =
    stores.find(
      store => {

        const value =
          `${store.name || ""} ${
            store.address
              ?.addressLine1 ||
            ""
          }`.toUpperCase();


        return (
          value.includes(
            "CEDAR"
          ) ||
          value.includes(
            "KINGSTON"
          )
        );
      }
    );


  return (
    exact ||
    cedarBluff ||
    stores[0]
  );
}


/*
 * =====================================================
 * KROGER PRICE
 * =====================================================
 */

function extractPrice(item) {
  const price =
    item?.price ||
    {};


  const promo =
    Number(
      price.promo
    );

  const regular =
    Number(
      price.regular
    );


  if (
    Number.isFinite(
      promo
    ) &&
    promo > 0
  ) {

    return {
      amount:
        promo,

      type:
        "promo",

      regular:
        Number.isFinite(
          regular
        ) &&
        regular > 0
          ? regular
          : null
    };
  }


  if (
    Number.isFinite(
      regular
    ) &&
    regular > 0
  ) {

    return {
      amount:
        regular,

      type:
        "regular",

      regular
    };
  }


  return null;
}


/*
 * =====================================================
 * KROGER PRODUCT TEXT
 * =====================================================
 */

function productText(
  product,
  item
) {
  return [
    product?.description,
    product?.brand,
    product
      ?.categories
      ?.join(" "),
    item?.size
  ]
    .filter(Boolean)
    .join(" ");
}


/*
 * =====================================================
 * LIVE KROGER SEARCH
 * =====================================================
 */

async function searchLiveKroger(
  parsed
) {
  const store =
    await findTargetKroger();


  const params =
    new URLSearchParams({
      "filter.term":
        parsed.krogerTerm,

      "filter.locationId":
        store.locationId,

      "filter.limit":
        "20"
    });


  const payload =
    await krogerFetch(
      `${KROGER_BASE}/products?${params.toString()}`
    );


  const products =
    payload.data ||
    [];


  const candidates =
    [];


  for (
    const product of
    products
  ) {

    const items =
      Array.isArray(
        product.items
      )
        ? product.items
        : [];


    for (
      const item of
      items
    ) {

      const priceInfo =
        extractPrice(
          item
        );


      if (
        !priceInfo
      ) {
        continue;
      }


      const description =
        productText(
          product,
          item
        );


      const normalizedOffer =
        normalizeOffer({
          retailer:
            "Kroger",

          title:
            product.description ||
            "Kroger product",

          brand:
            product.brand ||
            null,

          description:
            product.description ||
            description,

          size:
            item.size ||
            "",

          price:
            priceInfo.amount,

          productId:
            product.productId ||
            product.upc ||
            null,

          location: {
            locationId:
              store.locationId,

            name:
              store.name ||
              "Kroger",

            address:
              store.address ||
              null
          },

          source: {
            type:
              "kroger-live-api",

            live:
              true,

            priceType:
              priceInfo.type,

            regularPrice:
              priceInfo.regular,

            aisleLocations:
              item.aisleLocations ||
              []
          }
        });


      if (
        !normalizedOffer
      ) {
        continue;
      }


      normalizedOffer.rawSize =
        item.size ||
        null;


      const matchScore =
        scoreProductMatch(
          parsed.normalized,
          normalizedOffer
        );


      if (
        matchScore < 60
      ) {
        continue;
      }


      const requirement =
        calculatePackageRequirement(
          parsed.normalized,
          normalizedOffer
        );


      if (
        !requirement
      ) {
        continue;
      }


      candidates.push({
        ...normalizedOffer,

        matchScore,

        confidenceScore:
          100,

        requirement,

        regularPrice:
          priceInfo.regular,

        priceType:
          priceInfo.type
      });
    }
  }


  candidates.sort(
    (a, b) =>
      b.matchScore -
        a.matchScore ||
      a.requirement
        .totalCost -
        b.requirement
          .totalCost
  );


  const bestScore =
    candidates[0]
      ?.matchScore ??
    0;


  const offers =
    candidates
      .filter(
        candidate =>
          candidate.matchScore >=
          Math.max(
            60,
            bestScore - 8
          )
      )
      .slice(
        0,
        8
      );


  return {
    store,
    offers
  };
}


/*
 * =====================================================
 * MULTI-PACKAGE OPTIMIZER
 * =====================================================
 */

function bestNormalizedPackageCombo(
  offers,
  requestedNormalizedQty
) {
  if (
    !Array.isArray(
      offers
    ) ||
    !offers.length
  ) {
    return null;
  }


  const validOffers =
    offers.filter(
      offer => {

        const packageQty =
          Number(
            offer
              ?.package
              ?.normalizedQuantity
          );

        const price =
          Number(
            offer
              ?.price
              ?.total
          );


        return (
          Number.isFinite(
            packageQty
          ) &&
          packageQty > 0 &&
          Number.isFinite(
            price
          ) &&
          price > 0
        );
      }
    );


  if (
    !validOffers.length
  ) {
    return null;
  }


  const requested =
    Number(
      requestedNormalizedQty
    );


  if (
    !Number.isFinite(
      requested
    ) ||
    requested <= 0
  ) {
    return null;
  }


  const scale =
    100;


  const target =
    Math.ceil(
      requested *
      scale
    );


  const largestPackage =
    Math.max(
      ...validOffers.map(
        offer =>
          Number(
            offer.package
              .normalizedQuantity
          )
      )
    );


  const max =
    Math.ceil(
      (
        requested +
        largestPackage * 3 +
        5
      ) *
        scale
    );


  const dp =
    Array(
      max + 1
    ).fill(null);


  dp[0] = {
    cost: 0,
    picks: []
  };


  for (
    let i = 0;
    i <= max;
    i++
  ) {

    if (
      !dp[i]
    ) {
      continue;
    }


    for (
      const offer of
      validOffers
    ) {

      const step =
        Math.max(
          1,

          Math.round(
            Number(
              offer.package
                .normalizedQuantity
            ) *
              scale
          )
        );


      const nextIndex =
        i + step;


      if (
        nextIndex >
        max
      ) {
        continue;
      }


      const nextCost =
        dp[i].cost +
        Number(
          offer.price.total
        );


      if (
        !dp[nextIndex] ||
        nextCost <
          dp[nextIndex]
            .cost
      ) {

        dp[nextIndex] = {
          cost:
            nextCost,

          picks: [
            ...dp[i].picks,
            offer
          ]
        };
      }
    }
  }


  let best =
    null;


  for (
    let i = target;
    i <= max;
    i++
  ) {

    if (
      !dp[i]
    ) {
      continue;
    }


    const candidate = {
      suppliedNormalizedQty:
        i / scale,

      cost:
        dp[i].cost,

      picks:
        dp[i].picks
    };


    if (
      !best ||
      candidate.cost <
        best.cost ||
      (
        candidate.cost ===
          best.cost &&
        candidate
          .suppliedNormalizedQty <
          best
            .suppliedNormalizedQty
      )
    ) {

      best =
        candidate;
    }
  }


  return best;
}


/*
 * =====================================================
 * PACKAGE DISPLAY
 * =====================================================
 */

function buildPackageDisplay(
  offer
) {
  const packageQty =
    Number(
      offer
        ?.package
        ?.quantity
    );


  const safePackageQty =
    Number.isFinite(
      packageQty
    )
      ? packageQty
      : 1;


  const packageUnit =
    displayUnit(
      offer
        ?.package
        ?.unit ||
      "each"
    );


  const numericPrice =
    Number(
      offer
        ?.price
        ?.total
    );


  return {
    product:
      offer.title ||
      "Product",

    brand:
      offer.brand ||
      null,

    packageQty:
      safePackageQty,

    packageUnit,

    size:
      offer.rawSize ||
      `${
        safePackageQty
      } ${
        packageUnit
      }`,

    price:
      Number.isFinite(
        numericPrice
      )
        ? numericPrice
        : 0,

    regularPrice:
      offer.regularPrice ??
      offer.source
        ?.regularPrice ??
      null,

    priceType:
      offer.priceType ||
      offer.source
        ?.priceType ||
      null,

    sourceType:
      offer.sourceType ||
      offer.source
        ?.type ||
      "unknown",

    observedAt:
      validDateString(
        offer.observedAt ||
        offer.source
          ?.observedAt
      ),

    sourceUrl:
      offer.sourceUrl ||
      offer.source
        ?.url ||
      null,

    productId:
      offer.productId ||
      null,

    matchScore:
      offer.matchScore ??
      null,

    confidenceScore:
      offer.confidenceScore ??
      null,

    /*
     * Sprouts freshness fields.
     *
     * Other retailers will simply return null.
     */

    freshness:
      offer.freshness ||
      null,

    ageDays:
      Number.isFinite(
        Number(
          offer.ageDays
        )
      )
        ? Number(
            offer.ageDays
          )
        : null,

    needsRefresh:
      typeof
        offer.needsRefresh ===
        "boolean"
          ? offer.needsRefresh
          : null
  };
}


/*
 * =====================================================
 * RETAILER RESULT
 * =====================================================
 */

function buildRetailerResult({
  retailer,
  offers,
  request,
  dataMode,
  confidenceMode = null,
  location = null,
  retrievalSource = null
}) {
  if (
    !request ||
    !Array.isArray(
      offers
    ) ||
    !offers.length
  ) {
    return null;
  }


  const compatibleOffers =
    offers.filter(
      offer =>
        offer
          ?.package
          ?.normalizedUnit ===
        request
          .normalizedUnit
    );


  if (
    !compatibleOffers.length
  ) {
    return null;
  }


  const best =
    bestNormalizedPackageCombo(
      compatibleOffers,
      request
        .normalizedQuantity
    );


  if (
    !best
  ) {
    return null;
  }


  const suppliedDisplayQty =
    normalizedToDisplay(
      best
        .suppliedNormalizedQty,

      request
        .requestedUnit
    );


  const requestedDisplayQty =
    Number(
      request
        .requestedQuantity
    );


  const averageMatch =
    best.picks.length
      ? best.picks.reduce(
          (
            total,
            offer
          ) =>
            total +
            Number(
              offer
                .matchScore ||
              0
            ),
          0
        ) /
        best.picks.length
      : 0;


  const confidenceValues =
    best.picks
      .map(
        offer =>
          Number(
            offer
              .confidenceScore
          )
      )
      .filter(
        Number.isFinite
      );


  const averageConfidence =
    confidenceValues.length
      ? confidenceValues.reduce(
          (
            total,
            value
          ) =>
            total +
            value,
          0
        ) /
        confidenceValues.length
      : null;


  const freshness =
    summarizeFreshness(
      best.picks
    );


  return {
    retailer,

    requestedQty:
      requestedDisplayQty,

    requestedUnit:
      displayUnit(
        request
          .requestedUnit
      ),

    totalQty:
      round(
        suppliedDisplayQty,
        4
      ),

    estimatedCost:
      round(
        best.cost,
        2
      ),

    match:
      averageMatch >= 85
        ? "exact"
        : averageMatch >= 70
        ? "estimated"
        : "possible",

    dataMode,

    matchScore:
      Math.round(
        averageMatch
      ),

    confidenceScore:
      averageConfidence ===
        null
          ? null
          : Math.round(
              averageConfidence
            ),

    confidenceMode,

    retrievalSource,

    observedAt:
      newestObservedAt(
        best.picks
      ),

    /*
     * NEW freshness fields.
     */

    freshness:
      freshness.freshness,

    ageDays:
      freshness.ageDays,

    needsRefresh:
      freshness.needsRefresh,

    location,

    normalized: {
      requestedQty:
        request
          .normalizedQuantity,

      suppliedQty:
        best
          .suppliedNormalizedQty,

      unit:
        request
          .normalizedUnit
    },

    packages:
      best.picks.map(
        offer =>
          buildPackageDisplay(
            offer
          )
      )
  };
}


/*
 * =====================================================
 * SEED OFFER -> NORMALIZED OFFER
 * =====================================================
 */

function normalizeSeedOffer(
  offer,
  product
) {
  if (
    !offer
  ) {
    return null;
  }


  const packageQty =
    Number(
      offer.package_qty ||
      1
    );


  const packageUnit =
    offer.package_unit ||
    product.unit ||
    "each";


  const sizeText =
    `${packageQty} ${packageUnit}`;


  const normalized =
    normalizeOffer({
      retailer:
        offer.retailer,

      title:
        offer.product ||
        product.name ||
        offer.retailer,

      brand:
        offer.brand ||
        null,

      description:
        offer.product ||
        product.name ||
        "",

      size:
        sizeText,

      price:
        offer.price,

      productId:
        offer.productId ||
        offer.product_id ||
        null,

      location: {
        market:
          "Knoxville, TN"
      },

      source: {
        type:
          offer.source_type ||
          "prototype-seed",

        live:
          false
      }
    });


  if (
    !normalized
  ) {
    return null;
  }


  normalized.rawSize =
    sizeText;


  return normalized;
}


/*
 * =====================================================
 * SPROUTS FALLBACK EVIDENCE
 * =====================================================
 */

function buildSproutsFallbackEvidence(
  product
) {
  const offers =
    Array.isArray(
      product?.offers
    )
      ? product.offers
      : [];


  return offers
    .filter(
      offer =>
        cleanText(
          offer.retailer
        ) ===
        "sprouts"
    )
    .map(
      offer => {

        const packageQty =
          Number(
            offer.package_qty ||
            1
          );

        const packageUnit =
          offer.package_unit ||
          product.unit ||
          "each";


        return {
          retailer:
            "Sprouts",

          title:
            offer.product ||
            product.name,

          product:
            offer.product ||
            product.name,

          brand:
            offer.brand ||
            null,

          description:
            offer.product ||
            product.name,

          size:
            `${packageQty} ${packageUnit}`,

          price:
            Number(
              offer.price
            ),

          productId:
            offer.productId ||
            offer.product_id ||
            null,

          sourceType:
            "prototype-seed",

          marketConfirmed:
            false,

          locationConfirmed:
            false,

          observedAt:
            null
        };
      }
    );
}


/*
 * =====================================================
 * SPROUTS OFFER EXTRACTION
 * =====================================================
 */

function extractSproutsOffers(
  adapterResult
) {
  const rawOffers =
    Array.isArray(
      adapterResult
        ?.offers
    )
      ? adapterResult.offers
      : [];


  return rawOffers
    .map(
      offer => {

        if (
          !offer ||
          !offer.package ||
          !offer.price
        ) {
          return null;
        }


        const fallbackRawSize =
          offer.package
            ?.quantity != null
              ? `${
                  offer.package
                    .quantity
                } ${
                  displayUnit(
                    offer.package
                      .unit
                  )
                }`
              : null;


        return {
          ...offer,

          /*
           * Preserve evidence package text when available.
           */

          rawSize:
            offer.rawSize ||
            fallbackRawSize,

          matchScore:
            Number(
              offer
                .matchScore ||
              0
            ),

          confidenceScore:
            Number(
              offer
                .confidenceScore ||
              0
            ),

          observedAt:
            offer
              .observedAt ||
            offer.source
              ?.observedAt ||
            null,

          sourceType:
            offer
              .sourceType ||
            offer.source
              ?.type ||
            null,

          /*
           * NEW freshness metadata coming
           * directly from sprouts.js.
           */

          freshness:
            offer
              .freshness ||
            null,

          ageDays:
            Number.isFinite(
              Number(
                offer.ageDays
              )
            )
              ? Number(
                  offer.ageDays
                )
              : null,

          needsRefresh:
            typeof
              offer.needsRefresh ===
              "boolean"
                ? offer.needsRefresh
                : null
        };
      }
    )
    .filter(Boolean);
}


/*
 * =====================================================
 * MAIN HANDLER
 * =====================================================
 */

exports.handler =
  async function(event) {

    try {

      /*
       * =================================================
       * QUERY
       * =================================================
       */

      const text =
        event
          .queryStringParameters
          ?.q ||
        "";


      const parsed =
        parseRequest(
          text
        );


      /*
       * =================================================
       * PRODUCT VALIDATION
       * =================================================
       */

      if (
        !parsed.canonical
      ) {

        return json(
          200,
          {
            ok:
              false,

            parsed,

            message:
              "Prototype currently recognizes: organic grass-fed 85/15 ground beef, organic broccoli, organic cucumber, organic baby carrots, and mango."
          }
        );
      }


      /*
       * =================================================
       * LOAD PRODUCT CONFIG
       * =================================================
       */

      const seed =
        loadSeedData();


      const product =
        seed.products.find(
          item =>
            item
              .canonical_id ===
            parsed.canonical
        );


      if (
        !product
      ) {

        return json(
          200,
          {
            ok:
              false,

            parsed,

            message:
              "The requested product is not currently configured in the prototype seed data."
          }
        );
      }


      const results =
        [];


/*
 * =====================================================
 * KROGER
 * =====================================================
 */

      let krogerStatus = {
        live:
          false,

        mode:
          "official-api",

        message:
          "Kroger live connector was not attempted."
      };


      try {

        const live =
          await searchLiveKroger(
            parsed
          );


        if (
          live.offers.length
        ) {

          const result =
            buildRetailerResult({
              retailer:
                "Kroger",

              offers:
                live.offers,

              request:
                parsed.normalized,

              dataMode:
                "live",

              confidenceMode:
                "official-retailer-api",

              retrievalSource:
                "kroger-live-api",

              location: {
                locationId:
                  live.store
                    .locationId,

                name:
                  live.store
                    .name ||
                  "Kroger",

                address:
                  live.store
                    .address ||
                  null
              }
            });


          if (
            result
          ) {
            results.push(
              result
            );
          }


          krogerStatus = {
            live:
              true,

            mode:
              "official-api",

            message:
              `Live Kroger API connected to ${
                live.store.name ||
                "Kroger"
              }.`,

            locationId:
              live.store
                .locationId,

            address:
              live.store
                .address ||
              null,

            candidateCount:
              live.offers
                .length
          };

        } else {

          krogerStatus = {
            live:
              true,

            mode:
              "official-api",

            message:
              "Kroger API connected, but no sufficiently relevant compatible priced product was returned."
          };
        }

      } catch (error) {

        krogerStatus = {
          live:
            false,

        mode:
          "official-api",

        message:
          error.message
        };
      }


/*
 * =====================================================
 * SPROUTS
 * =====================================================
 */

      let sproutsStatus = {
        live:
          false,

        mode:
          "dated-retailer-evidence",

        message:
          "Sprouts evidence connector was not attempted."
      };


      try {

        const fallbackEvidence =
          buildSproutsFallbackEvidence(
            product
          );


        const adapterResult =
          await getSproutsOffers(
            parsed.normalized,
            fallbackEvidence
          );


        const sproutsOffers =
          extractSproutsOffers(
            adapterResult
          );


        const retrievalSource =
          adapterResult
            ?.retrieval
            ?.source ||
          "unknown";


        let sproutsDataMode =
          "dated-retailer-evidence";

        let confidenceMode =
          "dated-public-retailer-evidence";


        if (
          retrievalSource ===
          "supplied-fallback"
        ) {

          sproutsDataMode =
            "prototype-evidence-fallback";

          confidenceMode =
            "low-prototype";
        }


        if (
          retrievalSource ===
          "none"
        ) {

          sproutsDataMode =
            "no-evidence";
        }


        if (
          sproutsOffers.length
        ) {

          const result =
            buildRetailerResult({
              retailer:
                "Sprouts",

              offers:
                sproutsOffers,

              request:
                parsed.normalized,

              dataMode:
                sproutsDataMode,

              confidenceMode,

              retrievalSource,

              location:
                SPROUTS_MARKET
            });


          if (
            result
          ) {
            results.push(
              result
            );
          }


          const observed =
            newestObservedAt(
              sproutsOffers
            );


          const freshnessSummary =
            adapterResult
              ?.retrieval
              ?.freshness ||
            null;


          if (
            retrievalSource ===
            "sprouts-evidence-file"
          ) {

            sproutsStatus = {
              live:
                false,

              mode:
                "dated-retailer-evidence",

              retrievalSource,

              message:
                "Sprouts pricing was loaded from the dated Sprouts evidence file and processed through the shared normalization, confidence and freshness engine.",

              observedAt:
                observed,

              recordCount:
                adapterResult
                  ?.retrieval
                  ?.recordCount ??
                null,

              acceptedCount:
                adapterResult
                  ?.retrieval
                  ?.acceptedCount ??
                sproutsOffers.length,

              /*
               * NEW:
               * evidence freshness counts.
               */

              freshness:
                freshnessSummary,

              location:
                SPROUTS_MARKET
            };

          } else {

            sproutsStatus = {
              live:
                false,

              mode:
                sproutsDataMode,

              retrievalSource,

              message:
                "No matching dated Sprouts evidence was available, so the adapter used prototype fallback evidence.",

              observedAt:
                observed,

              recordCount:
                adapterResult
                  ?.retrieval
                  ?.recordCount ??
                null,

              acceptedCount:
                sproutsOffers
                  .length,

              freshness:
                freshnessSummary,

              location:
                SPROUTS_MARKET
            };
          }

        } else {

          sproutsStatus = {
            live:
              false,

            mode:
              retrievalSource ===
                "sprouts-evidence-file"
                  ? "dated-retailer-evidence"
                  : "no-usable-evidence",

            retrievalSource,

            message:
              "Sprouts retrieval ran, but no sufficiently relevant compatible offer passed the match and confidence requirements.",

            recordCount:
              adapterResult
                ?.retrieval
                ?.recordCount ??
              0,

            acceptedCount:
              adapterResult
                ?.retrieval
                ?.acceptedCount ??
              0,

            freshness:
              adapterResult
                ?.retrieval
                ?.freshness ||
              null,

            loadError:
              adapterResult
                ?.retrieval
                ?.loadError ||
              null
          };
        }

      } catch (error) {

        sproutsStatus = {
          live:
            false,

          mode:
            "evidence-error",

          message:
            error.message
        };
      }


/*
 * =====================================================
 * ALDI / EARTH FARE
 * =====================================================
 */

      const grouped =
        {};


      for (
        const seedOffer of
        product.offers
      ) {

        if (
          seedOffer.retailer ===
            "Kroger" ||
          seedOffer.retailer ===
            "Sprouts"
        ) {
          continue;
        }


        const normalizedOffer =
          normalizeSeedOffer(
            seedOffer,
            product
          );


        if (
          !normalizedOffer
        ) {
          continue;
        }


        const matchScore =
          scoreProductMatch(
            parsed.normalized,
            normalizedOffer
          );


        if (
          matchScore < 60
        ) {
          continue;
        }


        const requirement =
          calculatePackageRequirement(
            parsed.normalized,
            normalizedOffer
          );


        if (
          !requirement
        ) {
          continue;
        }


        grouped[
          seedOffer.retailer
        ] ??= [];


        grouped[
          seedOffer.retailer
        ].push({
          ...normalizedOffer,

          matchScore,

          confidenceScore:
            25,

          requirement
        });
      }


      for (
        const [
          retailer,
          offers
        ] of Object.entries(
          grouped
        )
      ) {

        const result =
          buildRetailerResult({
            retailer,

            offers,

            request:
              parsed.normalized,

            dataMode:
              "prototype-seed",

            confidenceMode:
              "low-prototype",

            retrievalSource:
              "seed-prices.json",

            location: {
              market:
                "Knoxville, TN"
            }
          });


        if (
          result
        ) {
          results.push(
            result
          );
        }
      }


/*
 * =====================================================
 * SORT BY ACTUAL PURCHASE COST
 * =====================================================
 */

      results.sort(
        (a, b) =>
          a.estimatedCost -
          b.estimatedCost
      );


/*
 * =====================================================
 * RESPONSE
 * =====================================================
 */

      return json(
        200,
        {
          ok:
            true,

          parsed: {
            raw:
              parsed.raw,

            qty:
              parsed.qty,

            unit:
              parsed.unit,

            canonical:
              parsed.canonical,

            krogerTerm:
              parsed.krogerTerm,

            attributes:
              parsed.attributes,

            normalized:
              parsed.normalized
          },

          product:
            product.name,

          market:
            "Knoxville, TN",

          disclaimer:
            "Kroger uses live official API data. Sprouts uses dated retailer evidence with freshness and confidence scoring. Sprouts evidence is classified as current for 0–7 days, aging for 8–14 days, and stale after 14 days. ALDI and Earth Fare remain prototype seed data.",

          connectors: {

            kroger:
              krogerStatus,

            sprouts:
              sproutsStatus,

            aldi: {
              live:
                false,

              mode:
                "prototype-seed"
            },

            earthFare: {
              live:
                false,

              mode:
                "prototype-seed"
            }
          },

          normalization: {
            enabled:
              true,

            internalWeightUnit:
              "oz",

            internalLiquidUnit:
              "fl_oz",

            internalCountUnit:
              "each",

            displayUnit:
              displayUnit(
                parsed.unit
              )
          },

          results,

          winner:
            results[0] ||
            null
        }
      );


    } catch (error) {

      return json(
        500,
        {
          ok:
            false,

          error:
            error.message
        }
      );
    }
  };
