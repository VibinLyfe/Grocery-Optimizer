const fs = require("fs");
const path = require("path");

const {
  normalizeUnit,
  normalizeRequest,
  normalizeOffer,
  detectAttributes,
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


function cleanText(
  value
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function normalizedToDisplay(
  quantity,
  normalizedUnit,
  requestedDisplayUnit
) {
  const qty =
    Number(quantity);

  if (
    !Number.isFinite(qty)
  ) {
    return null;
  }

  const display =
    normalizeUnit(
      requestedDisplayUnit
    );

  if (
    normalizedUnit === "oz"
  ) {
    switch (display) {
      case "lb":
        return qty / 16;

      case "oz":
        return qty;

      case "g":
        return qty * 28.349523125;

      case "kg":
        return (
          qty *
          28.349523125 /
          1000
        );

      default:
        return qty;
    }
  }

  if (
    normalizedUnit === "fl_oz"
  ) {
    switch (display) {
      case "fl_oz":
        return qty;

      case "pint":
        return qty / 16;

      case "quart":
        return qty / 32;

      case "gallon":
        return qty / 128;

      case "ml":
        return qty * 29.5735295625;

      case "liter":
        return (
          qty *
          29.5735295625 /
          1000
        );

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
    normalized === "fl_oz"
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
    (
      Array.isArray(offers)
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
 * FRESHNESS SUMMARY
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
    String(text || "")
      .trim();

  const lower =
    cleanText(raw);

  let qty = 1;
  let unit = "each";

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
    detectAttributes(raw);

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
 * PRODUCT REGISTRY
 *
 * Seed file remains only as the canonical product
 * registry. Retailer prices do not come from seed data.
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
       * Try the next path.
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
 * KROGER PRICE
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


/*
 * =====================================================
 * KROGER PRODUCT MATCH
 * =====================================================
 */

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

  let score = 0;

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
       * Product description is intentionally included
       * before item.size. normalize.js uses that to
       * correctly detect multipacks such as:
       *
       * 3 LB BIG DEAL
       * size: 3 ct / 1 lb
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

        product:
          normalized.title,

        title:
          normalized.title,

        brand:
          normalized.brand ||
          null,

        productId:
          normalized.productId ||
          null,

        package:
          normalized.package,

        package_qty:
          normalized.package
            ?.quantity ??
          null,

        package_unit:
          normalized.package
            ?.displayUnit ||
          normalized.package
            ?.unit ||
          null,

        normalized_package_qty:
          normalized.package
            ?.normalizedQuantity ??
          null,

        normalized_package_unit:
          normalized.package
            ?.normalizedUnit ||
          null,

        rawSize:
          normalized.package
            ?.raw ||
          item.size ||
          null,

        size:
          normalized.package
            ?.raw ||
          item.size ||
          null,

        price:
          priceInfo.amount,

        normalizedPrice:
          normalized.price,

        regularPrice:
          priceInfo.regular,

        priceType:
          priceInfo.type,

        match:
          "exact",

        matchScore:
          100,

        confidenceScore:
          100,

        source_type:
          "kroger-live-api",

        sourceType:
          "kroger-live-api",

        source: {
          type:
            "kroger-live-api",

          observedAt:
            null
        },

        observedAt:
          null,

        freshness:
          null,

        ageDays:
          null,

        needsRefresh:
          null,

        location: {
          locationId:
            store.locationId,

          name:
            store.name,

          address:
            store.address
        },

        score,

        purchasePlan:
          packagePlan,

        totalCost:
          packagePlan.totalCost
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
 * EVIDENCE OFFER -> COMMON OFFER SHAPE
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

      package:
        offer.package ||
        null,

      package_qty:
        offer.package
          ?.quantity ??
        null,

      package_unit:
        offer.package
          ?.displayUnit ||
        offer.package
          ?.unit ||
        null,

      normalized_package_qty:
        offer.package
          ?.normalizedQuantity ??
        null,

      normalized_package_unit:
        offer.package
          ?.normalizedUnit ||
        null,

      rawSize:
        offer.rawSize ||
        offer.package
          ?.raw ||
        null,

      size:
        offer.rawSize ||
        offer.package
          ?.raw ||
        null,

      price:
        Number(
          offer.price
            ?.total
        ),

      normalizedPrice:
        offer.price ||
        null,

      regularPrice:
        null,

      priceType:
        null,

      source_type:
        offer.sourceType ||
        offer.source
          ?.type ||
        "retailer-evidence",

      sourceType:
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
 * PACKAGE DISPLAY
 * =====================================================
 */

function buildPackageDisplay(
  pick
) {
  const packageInfo =
    pick.package ||
    null;

  const plan =
    pick.purchasePlan ||
    null;

  const packageQty =
    Number(
      pick.package_qty ??
      packageInfo?.quantity ??
      1
    );

  const packageUnit =
    pick.package_unit ||
    packageInfo?.displayUnit ||
    packageInfo?.unit ||
    null;

  const size =
    pick.rawSize ||
    pick.size ||
    packageInfo?.raw ||
    (
      Number.isFinite(
        packageQty
      ) &&
      packageUnit
        ? `${packageQty} ${packageUnit}`
        : null
    );

  let price =
    Number(
      pick.price
    );

  if (
    !Number.isFinite(price)
  ) {
    price =
      Number(
        pick.normalizedPrice
          ?.total
      );
  }

  const packagesNeeded =
    Math.max(
      1,
      Number(
        plan?.packagesNeeded ||
        1
      )
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
      Number.isFinite(
        packageQty
      )
        ? packageQty
        : 1,

    packageUnit,

    size,

    price:
      Number.isFinite(price)
        ? price
        : null,

    regularPrice:
      pick.regularPrice ||
      null,

    priceType:
      pick.priceType ||
      null,

    sourceType:
      pick.source_type ||
      pick.sourceType ||
      pick.source?.type ||
      null,

    observedAt:
      pick.observedAt ||
      pick.source
        ?.observedAt ||
      null,

    sourceUrl:
      pick.sourceUrl ||
      pick.source
        ?.url ||
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


/*
 * =====================================================
 * RETAILER RESULT
 * =====================================================
 */

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

  /*
   * Preserve the existing frontend contract:
   * one entry for every physical package required.
   */

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

  const requestedNormalized =
    request.normalized
      .normalizedQuantity;

  const suppliedNormalized =
    Number(
      plan
        .suppliedNormalizedQuantity ??
      plan
        .suppliedQuantity ??
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
      request.unit
    );

  const suppliedDisplay =
    normalizedToDisplay(
      suppliedNormalized,
      normalizedUnit,
      request.unit
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
        request.unit
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
      best.sourceType ||
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
 * EVIDENCE CONNECTOR STATUS
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
 * MAIN HANDLER
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
       * KROGER
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
            parsed
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
       * SPROUTS
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
       * ALDI
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
       * EARTH FARE
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
       * SORT
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
