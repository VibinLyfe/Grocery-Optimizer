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

const {
  getAldiOffers,
  ALDI_MARKET
} = require("./lib/aldi");

const {
  getEarthFareOffers,
  EARTH_FARE_MARKET
} = require("./lib/earthfare");


/*
 * =====================================================
 * KROGER CONFIG
 * =====================================================
 */

const KROGER_BASE =
  "https://api.kroger.com/v1";

const TARGET_KROGER = {
  address:
    "9225 Kingston Pike",

  city:
    "Knoxville",

  state:
    "TN",

  zip:
    "37922"
};


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

function json(
  statusCode,
  body
) {
  return {
    statusCode,

    headers: {
      "content-type":
        "application/json; charset=utf-8"
    },

    body:
      JSON.stringify(body)
  };
}


function round(
  value,
  decimals = 2
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
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


function cleanText(
  value
) {
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


function normalizedToDisplay(
  quantity,
  normalizedUnit,
  displayUnit
) {
  const qty =
    Number(quantity);

  if (
    !Number.isFinite(qty)
  ) {
    return null;
  }

  if (
    normalizedUnit === "oz" &&
    displayUnit === "lb"
  ) {
    return qty / 16;
  }

  if (
    normalizedUnit === "fl_oz"
  ) {
    switch (
      displayUnit
    ) {
      case "pint":
        return qty / 16;

      case "quart":
        return qty / 32;

      case "gallon":
        return qty / 128;

      case "fl_oz":
        return qty;

      default:
        return qty;
    }
  }

  return qty;
}


function displayUnit(
  unit
) {
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


function validDateString(
  value
) {
  if (!value) {
    return false;
  }

  const date =
    new Date(value);

  return !Number.isNaN(
    date.getTime()
  );
}


function newestObservedAt(
  offers
) {
  const dates =
    (Array.isArray(offers)
      ? offers
      : []
    )
      .map(
        offer =>
          offer.observedAt ||
          offer.source?.observedAt ||
          null
      )
      .filter(
        validDateString
      );

  if (
    !dates.length
  ) {
    return null;
  }

  dates.sort(
    (a, b) =>
      new Date(b).getTime() -
      new Date(a).getTime()
  );

  return dates[0];
}


/*
 * =====================================================
 * FRESHNESS SUMMARY FOR CHOSEN PACKAGES
 * =====================================================
 */

function summarizeFreshness(
  offers
) {
  const safeOffers =
    Array.isArray(offers)
      ? offers
      : [];

  const relevant =
    safeOffers.filter(
      offer =>
        offer &&
        (
          offer.freshness ||
          Number.isFinite(
            Number(
              offer.ageDays
            )
          ) ||
          typeof offer.needsRefresh ===
            "boolean"
        )
    );

  if (
    !relevant.length
  ) {
    return {
      freshness:
        null,

      ageDays:
        null,

      needsRefresh:
        null
    };
  }

  const rank = {
    current: 1,
    aging: 2,
    stale: 3,
    unknown: 4
  };

  let worst =
    "current";

  let maxAge =
    null;

  let needsRefresh =
    false;

  for (
    const offer of
    relevant
  ) {
    const status =
      offer.freshness ||
      "unknown";

    if (
      (
        rank[status] ||
        99
      ) >
      (
        rank[worst] ||
        99
      )
    ) {
      worst =
        status;
    }

    if (
      Number.isFinite(
        Number(
          offer.ageDays
        )
      )
    ) {
      const age =
        Number(
          offer.ageDays
        );

      maxAge =
        maxAge === null
          ? age
          : Math.max(
              maxAge,
              age
            );
    }

    if (
      offer.needsRefresh ===
      true
    ) {
      needsRefresh =
        true;
    }
  }

  return {
    freshness:
      worst,

    ageDays:
      maxAge,

    needsRefresh
  };
}


/*
 * =====================================================
 * REQUEST PARSING
 * =====================================================
 */

function parseRequest(
  text
) {
  const raw =
    String(
      text || ""
    ).trim();

  const lower =
    cleanText(raw);

  let qty = 1;
  let unit = "each";

  /*
   * Weight
   */

  let match =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)\b/
    );

  if (match) {
    qty =
      Number(
        match[1]
      );

    unit =
      "lb";
  } else {

    match =
      lower.match(
        /(\d+(?:\.\d+)?)\s*(oz|ounce|ounces)\b/
      );

    if (match) {
      qty =
        Number(
          match[1]
        );

      unit =
        "oz";
    }
  }


  /*
   * Count
   */

  if (
    unit === "each"
  ) {
    const countMatch =
      lower.match(
        /^(\d+(?:\.\d+)?)\b/
      );

    if (
      countMatch
    ) {
      qty =
        Number(
          countMatch[1]
        );
    }
  }


  /*
   * Canonical product
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
      ) ||
      lower.includes(
        "85%"
      )
    )
  ) {
    canonical =
      "ground-beef-organic-grassfed-85-15";

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
      lower.includes(
        "organic"
      )
        ? "organic mango"
        : "mango";
  }


  const attributes =
    detectAttributes(
      raw
    );


  let normalized =
    null;

  if (
    canonical
  ) {
    normalized =
      normalizeRequest({
        canonicalId:
          canonical,

        description:
          raw,

        quantity:
          qty,

        unit,

        attributes
      });
  }


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
 *
 * Still used as our canonical product registry.
 * Retailer pricing no longer comes from seed data.
 * =====================================================
 */

function loadSeedData() {
  const candidates = [
    path.join(
      process.cwd(),
      "data",
      "seed-prices.json"
    ),

    path.join(
      process.cwd(),
      "data",
      "seedPrices.json"
    ),

    path.join(
      __dirname,
      "..",
      "..",
      "data",
      "seed-prices.json"
    ),

    path.join(
      __dirname,
      "..",
      "..",
      "data",
      "seedPrices.json"
    )
  ];

  for (
    const filePath of
    candidates
  ) {
    try {
      if (
        fs.existsSync(
          filePath
        )
      ) {
        return JSON.parse(
          fs.readFileSync(
            filePath,
            "utf8"
          )
        );
      }
    } catch (
      error
    ) {
      /*
       * Keep checking alternate path.
       */
    }
  }

  throw new Error(
    "Could not load seed pricing registry."
  );
}


/*
 * =====================================================
 * KROGER AUTH
 * =====================================================
 */

let krogerToken =
  null;

let krogerTokenExpiresAt =
  0;


async function getKrogerToken() {
  if (
    krogerToken &&
    Date.now() <
      krogerTokenExpiresAt -
      60000
  ) {
    return krogerToken;
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
      "Kroger API credentials are missing."
    );
  }

  const auth =
    Buffer
      .from(
        `${clientId}:${clientSecret}`
      )
      .toString(
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
            `Basic ${auth}`,

          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({
            grant_type:
              "client_credentials",

            scope:
              "product.compact"
          })
      }
    );

  if (
    !response.ok
  ) {
    const text =
      await response.text();

    throw new Error(
      `Kroger authorization failed: ${response.status} ${text}`
    );
  }

  const payload =
    await response.json();

  krogerToken =
    payload.access_token;

  krogerTokenExpiresAt =
    Date.now() +
    Number(
      payload.expires_in ||
      1800
    ) *
      1000;

  return krogerToken;
}


async function krogerFetch(
  url
) {
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

  if (
    !response.ok
  ) {
    const text =
      await response.text();

    throw new Error(
      `Kroger API request failed: ${response.status} ${text}`
    );
  }

  return response.json();
}


/*
 * =====================================================
 * KROGER LOCATION
 * =====================================================
 */

async function findTargetKroger() {
  const params =
    new URLSearchParams({
      "filter.zipCode.near":
        TARGET_KROGER.zip,

      "filter.limit":
        "20"
    });

  const payload =
    await krogerFetch(
      `${KROGER_BASE}/locations?${params.toString()}`
    );

  const stores =
    Array.isArray(
      payload.data
    )
      ? payload.data
      : [];

  const targetAddress =
    cleanText(
      TARGET_KROGER.address
    );

  const exact =
    stores.find(
      store => {
        const address =
          cleanText(
            store.address
              ?.addressLine1
          );

        return (
          address ===
          targetAddress
        );
      }
    );

  const store =
    exact ||
    stores[0];

  if (
    !store
  ) {
    throw new Error(
      "Could not find the target Kroger location."
    );
  }

  return {
    locationId:
      store.locationId,

    name:
      store.name ||
      "Kroger",

    address:
      store.address ||
      null
  };
}


/*
 * =====================================================
 * KROGER PRODUCT HELPERS
 * =====================================================
 */

function extractPrice(
  item
) {
  const price =
    item?.price;

  if (
    !price
  ) {
    return null;
  }

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

      regular:
        Number.isFinite(
          regular
        )
          ? regular
          : null,

      type:
        "promo"
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

      regular,

      type:
        "regular"
    };
  }

  return null;
}


function scoreKrogerProduct(
  product,
  parsed
) {
  const text =
    cleanText(
      [
        product.description,
        product.brand
      ]
        .filter(Boolean)
        .join(" ")
    );

  let score =
    0;

  const canonical =
    parsed.canonical;


  if (
    canonical ===
    "ground-beef-organic-grassfed-85-15"
  ) {
    if (
      text.includes(
        "ground beef"
      )
    ) {
      score += 8;
    }

    if (
      text.includes(
        "organic"
      )
    ) {
      score += 5;
    }

    if (
      text.includes(
        "grass"
      )
    ) {
      score += 5;
    }

    if (
      text.includes(
        "85"
      )
    ) {
      score += 4;
    }

    if (
      text.includes(
        "15"
      )
    ) {
      score += 3;
    }

    return score;
  }


  if (
    canonical ===
    "organic-broccoli"
  ) {
    if (
      text.includes(
        "broccoli"
      )
    ) {
      score += 10;
    }

    if (
      text.includes(
        "organic"
      )
    ) {
      score += 6;
    }

    return score;
  }


  if (
    canonical ===
    "organic-cucumber"
  ) {
    if (
      text.includes(
        "cucumber"
      )
    ) {
      score += 10;
    }

    if (
      text.includes(
        "organic"
      )
    ) {
      score += 6;
    }

    return score;
  }


  if (
    canonical ===
    "organic-baby-carrots"
  ) {
    if (
      text.includes(
        "carrot"
      )
    ) {
      score += 10;
    }

    if (
      text.includes(
        "baby"
      )
    ) {
      score += 4;
    }

    if (
      text.includes(
        "organic"
      )
    ) {
      score += 6;
    }

    return score;
  }


  if (
    canonical ===
    "mango"
  ) {
    if (
      text.includes(
        "mango"
      )
    ) {
      score += 12;
    }

    if (
      parsed.attributes
        ?.organic &&
      text.includes(
        "organic"
      )
    ) {
      score += 5;
    }

    return score;
  }


  return score;
}


/*
 * =====================================================
 * KROGER OFFER NORMALIZATION
 * =====================================================
 */

async function searchLiveKroger(
  parsed,
  productSeed
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
    Array.isArray(
      payload.data
    )
      ? payload.data
      : [];

  const candidates =
    [];

  for (
    const product of
    products
  ) {
    const score =
      scoreKrogerProduct(
        product,
        parsed
      );

    if (
      score <= 0
    ) {
      continue;
    }

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

      /*
       * Important:
       * description is passed before size so normalize.js
       * can correctly detect products such as the Kroger
       * 3 lb ground-beef multipack.
       */

      const normalized =
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
            [
              product.description,
              item.size
            ]
              .filter(Boolean)
              .join(" "),

          size:
            item.size ||
            "",

          price:
            priceInfo.amount,

          productId:
            product.productId ||
            product.upc ||
            null,

          attributes:
            detectAttributes(
              product.description ||
              ""
            ),

          location: {
            locationId:
              store.locationId,

            name:
              store.name,

            address:
              store.address,

            confirmed:
              true
          },

          source: {
            type:
              "kroger-live-api",

            observedAt:
              null
          }
        });

      if (
        !normalized ||
        !parsed.normalized
      ) {
        continue;
      }

      const packagePlan =
        calculatePackageRequirement(
          parsed.normalized,
          normalized
        );

      if (
        !packagePlan
      ) {
        continue;
      }

      candidates.push({
        retailer:
          "Kroger",

        title:
          normalized.title,

        brand:
          normalized.brand,

        productId:
          normalized.productId,

        package:
          normalized.package,

        price:
          normalized.price,

        matchScore:
          100,

        confidenceScore:
          100,

        totalCost:
          packagePlan.totalCost,

        purchasePlan:
          packagePlan,

        regularPrice:
          priceInfo.regular,

        priceType:
          priceInfo.type,

        sourceType:
          "kroger-live-api",

        source:
          {
            type:
              "kroger-live-api"
          },

        location:
          {
            locationId:
              store.locationId,

            name:
              store.name,

            address:
              store.address
          },

        score
      });
    }
  }

  candidates.sort(
    (a, b) =>
      b.score -
        a.score ||
      a.totalCost -
        b.totalCost
  );

  const bestScore =
    candidates[0]
      ?.score ??
    0;

  return {
    store,

    offers:
      candidates
        .filter(
          candidate =>
            candidate.score >=
            Math.max(
              8,
              bestScore - 5
            )
        )
        .slice(
          0,
          8
        )
  };
}


/*
 * =====================================================
 * EVIDENCE OFFER -> COMPARISON OFFER
 * =====================================================
 */

function extractEvidenceOffers(
  adapterResult
) {
  const offers =
    Array.isArray(
      adapterResult
        ?.offers
    )
      ? adapterResult.offers
      : [];

  return offers.map(
    offer => ({
      retailer:
        offer.retailer,

      product:
        offer.title,

      title:
        offer.title,

      brand:
        offer.brand ||
        null,

      productId:
        offer.productId ||
        null,

      package_qty:
        offer.package
          ?.quantity,

      package_unit:
        offer.package
          ?.displayUnit ||
        offer.package
          ?.unit ||
        null,

      normalized_package_qty:
        offer.package
          ?.normalizedQuantity,

      normalized_package_unit:
        offer.package
          ?.normalizedUnit,

      size:
        offer.rawSize ||
        offer.package
          ?.raw ||
        null,

      price:
        offer.price
          ?.total,

      regularPrice:
        null,

      priceType:
        null,

      source_type:
        offer.sourceType ||
        offer.source
          ?.type ||
        "retailer-evidence",

      sourceUrl:
        offer.sourceUrl ||
        offer.source
          ?.url ||
        null,

      observedAt:
        offer.observedAt ||
        offer.source
          ?.observedAt ||
        null,

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
        typeof offer.needsRefresh ===
        "boolean"
          ? offer.needsRefresh
          : null,

      match:
        offer.matchScore >=
        90
          ? "exact"
          : offer.matchScore >=
            60
          ? "estimated"
          : "possible",

      matchScore:
        offer.matchScore,

      confidenceScore:
        offer.confidenceScore,

      totalCost:
        offer.totalCost,

      purchasePlan:
        offer.purchasePlan,

      location:
        offer.location ||
        adapterResult.market ||
        null
    })
  );
}


/*
 * =====================================================
 * RESULT BUILDING
 * =====================================================
 */

function buildPackageDisplay(
  pick
) {
  const plan =
    pick.purchasePlan ||
    null;

  const packagesNeeded =
    Number(
      plan
        ?.packagesNeeded ||
      1
    );

  const packageQty =
    Number(
      pick.package_qty ||
      1
    );

  return {
    product:
      pick.product ||
      pick.title ||
      "Product",

    brand:
      pick.brand ||
      null,

    packageQty:
      packageQty,

    packageUnit:
      pick.package_unit ||
      null,

    size:
      pick.size ||
      null,

    price:
      Number(
        pick.price
      ),

    regularPrice:
      pick.regularPrice ||
      null,

    priceType:
      pick.priceType ||
      null,

    sourceType:
      pick.source_type ||
      null,

    observedAt:
      pick.observedAt ||
      null,

    sourceUrl:
      pick.sourceUrl ||
      null,

    productId:
      pick.productId ||
      null,

    matchScore:
      Number.isFinite(
        Number(
          pick.matchScore
        )
      )
        ? Number(
            pick.matchScore
          )
        : null,

    confidenceScore:
      Number.isFinite(
        Number(
          pick.confidenceScore
        )
      )
        ? Number(
            pick.confidenceScore
          )
        : null,

    freshness:
      pick.freshness ||
      null,

    ageDays:
      Number.isFinite(
        Number(
          pick.ageDays
        )
      )
        ? Number(
            pick.ageDays
          )
        : null,

    needsRefresh:
      typeof pick.needsRefresh ===
      "boolean"
        ? pick.needsRefresh
        : null,

    packagesNeeded
  };
}


function buildRetailerResult(
  retailer,
  offers,
  request,
  dataMode,
  options = {}
) {
  if (
    !Array.isArray(
      offers
    ) ||
    !offers.length ||
    !request?.normalized
  ) {
    return null;
  }

  /*
   * Every normalized evidence/API offer already includes
   * its required purchase plan for the full request.
   *
   * Choose the lowest actual total cost.
   */

  const sorted =
    [...offers].sort(
      (a, b) =>
        Number(
          a.totalCost
        ) -
        Number(
          b.totalCost
        ) ||
        Number(
          b.matchScore ||
          0
        ) -
        Number(
          a.matchScore ||
          0
        ) ||
        Number(
          b.confidenceScore ||
          0
        ) -
        Number(
          a.confidenceScore ||
          0
        )
    );

  const best =
    sorted[0];

  if (
    !best ||
    !best.purchasePlan
  ) {
    return null;
  }

  const plan =
    best.purchasePlan;

  const packageCount =
    Math.max(
      1,
      Number(
        plan.packagesNeeded ||
        1
      )
    );

  const picks =
    Array.from(
      {
        length:
          packageCount
      },

      () => best
    );

  const freshness =
    summarizeFreshness(
      picks
    );

  const normalizedUnit =
    request.normalized
      .normalizedUnit;

  const display =
    request.unit;

  const requestedNormalized =
    request.normalized
      .normalizedQuantity;

  const suppliedNormalized =
    Number(
      plan.suppliedNormalizedQuantity ??
      plan.suppliedQuantity ??
      (
        best.package
          ?.normalizedQuantity *
        packageCount
      )
    );

  const requestedDisplay =
    normalizedToDisplay(
      requestedNormalized,
      normalizedUnit,
      display
    );

  const suppliedDisplay =
    normalizedToDisplay(
      suppliedNormalized,
      normalizedUnit,
      display
    );

  const matchScore =
    Number(
      best.matchScore ??
      (
        retailer ===
        "Kroger"
          ? 100
          : 0
      )
    );

  const confidenceScore =
    Number(
      best.confidenceScore ??
      (
        retailer ===
        "Kroger"
          ? 100
          : 0
      )
    );

  return {
    retailer,

    requestedQty:
      round(
        requestedDisplay,
        2
      ),

    requestedUnit:
      displayUnit(
        display
      ),

    totalQty:
      round(
        suppliedDisplay,
        2
      ),

    estimatedCost:
      round(
        plan.totalCost ??
        best.totalCost,
        2
      ),

    match:
      best.match ||
      (
        matchScore >= 90
          ? "exact"
          : "estimated"
      ),

    dataMode,

    matchScore,

    confidenceScore,

    confidenceMode:
      options.confidenceMode ||
      null,

    retrievalSource:
      options.retrievalSource ||
      best.source_type ||
      null,

    observedAt:
      newestObservedAt(
        picks
      ),

    freshness:
      freshness.freshness,

    ageDays:
      freshness.ageDays,

    needsRefresh:
      freshness.needsRefresh,

    location:
      options.location ||
      best.location ||
      null,

    normalized: {
      requestedQty:
        round(
          requestedNormalized,
          4
        ),

      suppliedQty:
        round(
          suppliedNormalized,
          4
        ),

      unit:
        normalizedUnit
    },

    packages:
      picks.map(
        buildPackageDisplay
      )
  };
}


/*
 * =====================================================
 * CONNECTOR STATUS
 * =====================================================
 */

function buildEvidenceConnectorStatus(
  retailer,
  adapterResult,
  market
) {
  const retrieval =
    adapterResult
      ?.retrieval ||
    {};

  const offers =
    Array.isArray(
      adapterResult
        ?.offers
    )
      ? adapterResult.offers
      : [];

  return {
    live:
      false,

    mode:
      "dated-retailer-evidence",

    retrievalSource:
      retrieval.source ||
      null,

    message:
      `${retailer} pricing was loaded from the dated ${retailer} evidence file and processed through the shared normalization, confidence and freshness engine.`,

    observedAt:
      newestObservedAt(
        offers
      ),

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

    freshness:
      retrieval.freshness ||
      {
        current: 0,
        aging: 0,
        stale: 0,
        unknown: 0,
        needsRefresh: 0
      },

    location:
      market
  };
}


/*
 * =====================================================
 * HANDLER
 * =====================================================
 */

exports.handler =
  async function (
    event
  ) {
    try {
      const text =
        event
          .queryStringParameters
          ?.q ||
        "";

      const parsed =
        parseRequest(
          text
        );


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


      const seed =
        loadSeedData();


      const product =
        seed.products.find(
          item =>
            item.canonical_id ===
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

            message:
              "The requested product is not currently configured in the product registry."
          }
        );
      }


      const results =
        [];


      /*
       * =================================================
       * KROGER LIVE API
       * =================================================
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
            parsed,
            product
          );


        if (
          live.offers.length
        ) {
          const result =
            buildRetailerResult(
              "Kroger",

              live.offers,

              parsed,

              "live",

              {
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
              }
            );


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
              "Kroger API connected, but no sufficiently relevant priced product was returned."
          };
        }

      } catch (
        error
      ) {
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
       * =================================================
       * SPROUTS EVIDENCE
       * =================================================
       */

      let sproutsStatus = {
        live:
          false,

        mode:
          "dated-retailer-evidence",

        retrievalSource:
          null,

        message:
          "Sprouts evidence connector was not attempted."
      };


      try {
        const adapterResult =
          await getSproutsOffers(
            parsed.normalized
          );


        const offers =
          extractEvidenceOffers(
            adapterResult
          );


        sproutsStatus =
          buildEvidenceConnectorStatus(
            "Sprouts",

            adapterResult,

            SPROUTS_MARKET
          );


        const result =
          buildRetailerResult(
            "Sprouts",

            offers,

            parsed,

            "dated-retailer-evidence",

            {
              confidenceMode:
                "dated-public-retailer-evidence",

              retrievalSource:
                adapterResult
                  ?.retrieval
                  ?.source ||
                "sprouts-evidence-file",

              location:
                SPROUTS_MARKET
            }
          );


        if (
          result
        ) {
          results.push(
            result
          );
        }

      } catch (
        error
      ) {
        sproutsStatus = {
          live:
            false,

          mode:
            "dated-retailer-evidence",

          retrievalSource:
            "sprouts-evidence-file",

          message:
            error.message,

          location:
            SPROUTS_MARKET
        };
      }


      /*
       * =================================================
       * ALDI EVIDENCE
       * =================================================
       */

      let aldiStatus = {
        live:
          false,

        mode:
          "dated-retailer-evidence",

        retrievalSource:
          null,

        message:
          "ALDI evidence connector was not attempted."
      };


      try {
        const adapterResult =
          await getAldiOffers(
            parsed.normalized
          );


        const offers =
          extractEvidenceOffers(
            adapterResult
          );


        aldiStatus =
          buildEvidenceConnectorStatus(
            "ALDI",

            adapterResult,

            ALDI_MARKET
          );


        const result =
          buildRetailerResult(
            "ALDI",

            offers,

            parsed,

            "dated-retailer-evidence",

            {
              confidenceMode:
                "dated-public-retailer-evidence",

              retrievalSource:
                adapterResult
                  ?.retrieval
                  ?.source ||
                "aldi-evidence-file",

              location:
                ALDI_MARKET
            }
          );


        if (
          result
        ) {
          results.push(
            result
          );
        }

      } catch (
        error
      ) {
        aldiStatus = {
          live:
            false,

          mode:
            "dated-retailer-evidence",

          retrievalSource:
            "aldi-evidence-file",

          message:
            error.message,

          location:
            ALDI_MARKET
        };
      }


      /*
       * =================================================
       * EARTH FARE EVIDENCE
       * =================================================
       */

      let earthFareStatus = {
        live:
          false,

        mode:
          "dated-retailer-evidence",

        retrievalSource:
          null,

        message:
          "Earth Fare evidence connector was not attempted."
      };


      try {
        const adapterResult =
          await getEarthFareOffers(
            parsed.normalized
          );


        const offers =
          extractEvidenceOffers(
            adapterResult
          );


        earthFareStatus =
          buildEvidenceConnectorStatus(
            "Earth Fare",

            adapterResult,

            EARTH_FARE_MARKET
          );


        const result =
          buildRetailerResult(
            "Earth Fare",

            offers,

            parsed,

            "dated-retailer-evidence",

            {
              confidenceMode:
                "dated-public-retailer-evidence",

              retrievalSource:
                adapterResult
                  ?.retrieval
                  ?.source ||
                "earthfare-evidence-file",

              location:
                EARTH_FARE_MARKET
            }
          );


        if (
          result
        ) {
          results.push(
            result
          );
        }

      } catch (
        error
      ) {
        earthFareStatus = {
          live:
            false,

          mode:
            "dated-retailer-evidence",

          retrievalSource:
            "earthfare-evidence-file",

          message:
            error.message,

          location:
            EARTH_FARE_MARKET
        };
      }


      /*
       * =================================================
       * SORT BY ACTUAL PURCHASE COST
       * =================================================
       */

      results.sort(
        (a, b) =>
          a.estimatedCost -
          b.estimatedCost
      );


      /*
       * =================================================
       * RESPONSE
       * =================================================
       */

      return json(
        200,
        {
          ok:
            true,

          parsed,

          product:
            product.name,

          market:
            "Knoxville, TN",

          disclaimer:
            "Kroger uses live official API data. Sprouts, ALDI, and Earth Fare use dated retailer evidence with shared freshness and confidence scoring. Evidence is current for 0-7 days, aging for 8-14 days, and stale after 14 days.",

          connectors: {
            kroger:
              krogerStatus,

            sprouts:
              sproutsStatus,

            aldi:
              aldiStatus,

            earthFare:
              earthFareStatus
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
              parsed.unit
          },

          results,

          winner:
            results[0] ||
            null
        }
      );

    } catch (
      error
    ) {
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
