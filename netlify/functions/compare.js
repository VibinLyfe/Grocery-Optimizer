/*
 * compare.js
 *
 * Grocery Optimizer comparison engine.
 *
 * CURRENT DATA MODES
 * ------------------
 * Kroger:
 *   Live official Kroger API.
 *
 * Sprouts:
 *   Runs through the new Sprouts adapter and shared
 *   normalization/confidence architecture.
 *   Until an approved automatic Sprouts retrieval source
 *   is connected, Sprouts evidence comes from our existing
 *   prototype data and is clearly labeled as such.
 *
 * ALDI / Earth Fare:
 *   Prototype seed data for now.
 *
 * IMPORTANT
 * ---------
 * All retailer offers are normalized before comparison.
 * Weight is compared as ounces.
 * Liquid is compared as fluid ounces.
 * Count is compared as each.
 */

const fs = require("fs");
const path = require("path");

const {
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
 * RESPONSE HELPER
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
 * BASIC HELPERS
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
 * USER REQUEST PARSER
 *
 * We still recognize the original prototype products,
 * but the request is now handed to normalize.js after
 * parsing.
 *
 * Examples:
 *
 * 3 lb organic grass-fed 85/15 ground beef
 * 2 organic broccoli
 * 1 lb organic baby carrots
 * 4 organic cucumbers
 * 3 mangoes
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
   * -------------------------
   * WEIGHT
   * -------------------------
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
   * -------------------------
   * LIQUID
   * -------------------------
   */

  const gallonMatch =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:gallon|gallons|gal)\b/
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
      /(\d+(?:\.\d+)?)\s*(?:liter|liters|litre|litres|l)\b/
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

    unit = "lb";

  } else if (ozMatch) {
    qty =
      Number(
        ozMatch[1]
      );

    unit = "oz";

  } else if (kgMatch) {
    qty =
      Number(
        kgMatch[1]
      );

    unit = "kg";

  } else if (gramMatch) {
    qty =
      Number(
        gramMatch[1]
      );

    unit = "g";

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

    /*
     * Count-based request.
     *
     * Example:
     * 4 organic broccoli
     */

    const leading =
      lower.match(
        /^\s*(\d+(?:\.\d+)?)\b/
      );

    if (leading) {
      qty =
        Number(
          leading[1]
        );
    }

    unit = "each";
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

    /*
     * Ground beef prototype is
     * weight-based.
     */

    if (
      unit === "each"
    ) {
      unit = "lb";
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

    /*
     * Existing prototype carrots
     * are weight-based.
     */

    if (
      unit === "each"
    ) {
      unit = "lb";
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
    detectAttributes(raw);


  const normalized =
    normalizeRequest({
      quantity: qty,
      unit,
      description: raw,
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
  const dataPath =
    path.join(
      process.cwd(),
      "data",
      "seed-prices.json"
    );

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
 * FIND TARGET KROGER
 *
 * Preferred store:
 * 9225 Kingston Pike
 * Knoxville, TN 37922
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
    payload.data || [];


  if (
    !stores.length
  ) {
    throw new Error(
      `No Kroger locations returned near ${TARGET_ZIP}.`
    );
  }


  /*
   * Exact address first.
   */

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
            .filter(
              Boolean
            )
            .join(" ")
            .toUpperCase();


        return (
          address.includes(
            TARGET_ADDRESS
          )
        );
      }
    );


  /*
   * Cedar Bluff / Kingston Pike
   * fallback.
   */

  const cedarBluff =
    stores.find(
      store => {

        const text =
          `${store.name || ""} ${
            store.address
              ?.addressLine1 ||
            ""
          }`.toUpperCase();


        return (
          text.includes(
            "CEDAR"
          ) ||
          text.includes(
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
 * KROGER PRICE EXTRACTION
 * =====================================================
 */

function extractPrice(item) {
  const price =
    item?.price || {};


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
 * KROGER PRODUCT MATCH
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
 *
 * Kroger products are immediately converted into the
 * shared normalized offer format.
 *
 * This is where the old special 3 LB package bug is now
 * handled by normalize.js:
 *
 * description:
 * "3 LB BIG DEAL!"
 *
 * size:
 * "1 lb"
 *
 * normalize.js checks the description weight before
 * falling back to size.
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
    payload.data || [];


  const candidates = [];


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
      const item of items
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


      const matchScore =
        scoreProductMatch(
          parsed.normalized,
          normalizedOffer
        );


      /*
       * Reject weak matches.
       */

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


      /*
       * This rejects incompatible
       * measurement types.
       *
       * Example:
       * request = 1 lb
       * offer = 1 each
       */

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
    (a, b) => {

      const matchDifference =
        b.matchScore -
        a.matchScore;

      if (
        matchDifference !== 0
      ) {
        return (
          matchDifference
        );
      }


      return (
        a.requirement
          .totalCost -
        b.requirement
          .totalCost
      );
    }
  );


  return {
    store,

    offers:
      candidates
  };
}


/*
 * =====================================================
 * MULTI-PACKAGE OPTIMIZER
 *
 * This is important.
 *
 * Suppose the shopper wants 4 lb.
 *
 * Store offers:
 *
 * 1 lb = $8
 * 3 lb = $20
 *
 * The optimizer can choose:
 *
 * 1 x 3 lb
 * +
 * 1 x 1 lb
 *
 * rather than blindly buying:
 *
 * 2 x 3 lb
 *
 * This preserves the good behavior from the original
 * compare.js while using normalized quantities.
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


  /*
   * Quantities are normalized:
   *
   * weight -> oz
   * liquid -> fl oz
   * count  -> each
   *
   * Scale by 100 so decimal
   * quantities remain usable.
   */

  const scale =
    100;


  const target =
    Math.max(
      1,

      Math.ceil(
        Number(
          requestedNormalizedQty
        ) *
          scale
      )
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


  /*
   * Allow enough headroom for
   * reasonable overbuy.
   */

  const max =
    Math.ceil(
      (
        Number(
          requestedNormalizedQty
        ) +
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
          dp[nextIndex].cost
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
 * PACKAGE SUMMARY
 *
 * Combine repeated identical packages so the response
 * is easier for the front end to display.
 * =====================================================
 */

function summarizePackages(
  picks
) {
  const grouped =
    new Map();


  for (
    const offer of
    picks
  ) {

    const key =
      [
        offer.retailer,
        offer.productId ||
          offer.title,
        offer.package
          ?.normalizedQuantity,
        offer.price
          ?.total
      ].join("|");


    if (
      !grouped.has(
        key
      )
    ) {
      grouped.set(
        key,
        {
          count: 0,
          offer
        }
      );
    }


    grouped.get(
      key
    ).count += 1;
  }


  return [
    ...grouped.values()
  ].map(
    entry => {

      const offer =
        entry.offer;


      return {
        quantityToBuy:
          entry.count,

        product:
          offer.title,

        brand:
          offer.brand ||
          null,

        size:
          offer.package
            ?.quantity != null
              ? `${
                  offer.package
                    .quantity
                } ${
                  offer.package
                    .unit ||
                  ""
                }`.trim()
              : null,

        originalSizeText:
          offer.description ||
          null,

        packageNormalizedQuantity:
          offer.package
            ?.normalizedQuantity ??
          null,

        packageNormalizedUnit:
          offer.package
            ?.normalizedUnit ??
          null,

        priceEach:
          round(
            offer.price
              ?.total,
            2
          ),

        extendedPrice:
          round(
            Number(
              offer.price
                ?.total
            ) *
              entry.count,
            2
          ),

        matchScore:
          offer.matchScore ??
          null,

        confidenceScore:
          offer.confidenceScore ??
          null,

        sourceType:
          offer.source
            ?.type ||
          offer.sourceType ||
          null,

        productId:
          offer.productId ||
          null,

        regularPrice:
          offer.regularPrice ??
          offer.source
            ?.regularPrice ??
          null,

        priceType:
          offer.priceType ||
          offer.source
            ?.priceType ||
          null
      };
    }
  );
}


/*
 * =====================================================
 * BUILD NORMALIZED RETAILER RESULT
 * =====================================================
 */

function buildNormalizedRetailerResult({
  retailer,
  offers,
  request,
  dataMode,
  confidenceMode = null,
  location = null
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


  /*
   * Measurement types must agree.
   */

  const compatibleOffers =
    offers.filter(
      offer =>
        offer
          ?.package
          ?.normalizedUnit ===
        request.normalizedUnit
    );


  if (
    !compatibleOffers.length
  ) {
    return null;
  }


  const best =
    bestNormalizedPackageCombo(
      compatibleOffers,
      request.normalizedQuantity
    );


  if (
    !best
  ) {
    return null;
  }


  const averageMatch =
    best.picks.length
      ? best.picks.reduce(
          (
            total,
            offer
          ) =>
            total +
            Number(
              offer.matchScore ||
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
            offer.confidenceScore
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
            total + value,
          0
        ) /
        confidenceValues.length
      : null;


  const requestedNormalized =
    Number(
      request.normalizedQuantity
    );


  const excessNormalized =
    best.suppliedNormalizedQty -
    requestedNormalized;


  return {
    retailer,

    requestedQty:
      request
        .requestedQuantity,

    requestedUnit:
      request
        .requestedUnit,

    normalizedRequest: {
      quantity:
        requestedNormalized,

      unit:
        request
          .normalizedUnit
    },

    totalQty:
      round(
        best
          .suppliedNormalizedQty,
        4
      ),

    totalUnit:
      request
        .normalizedUnit,

    excessQty:
      round(
        excessNormalized,
        4
      ),

    estimatedCost:
      round(
        best.cost,
        2
      ),

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

    match:
      averageMatch >= 90
        ? "exact"
        : averageMatch >= 75
        ? "strong"
        : "possible",

    dataMode,

    confidenceMode,

    location,

    packages:
      summarizePackages(
        best.picks
      )
  };
}


/*
 * =====================================================
 * CONVERT OLD SEED OFFER TO SHARED NORMALIZED OFFER
 *
 * Existing seed data uses:
 *
 * product
 * package_qty
 * package_unit
 * price
 * retailer
 *
 * normalize.js expects:
 *
 * title
 * size
 * price
 * retailer
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


  return normalized;
}


/*
 * =====================================================
 * SPROUTS EVIDENCE BRIDGE
 *
 * sprouts.js is designed to accept retailer evidence.
 *
 * For now we feed the existing Sprouts prototype rows
 * into that adapter. This proves the end-to-end adapter
 * architecture without pretending that the values are
 * live.
 *
 * Later, the only thing we replace is the evidence
 * retrieval source.
 * =====================================================
 */

function buildSproutsEvidence(
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

          location:
            "Knoxville, TN",

          market:
            "Knoxville, TN",

          marketConfirmed:
            true,

          locationConfirmed:
            false,

          /*
           * We intentionally do not give
           * prototype seed evidence a fake
           * recent observation date.
           */

          observedAt:
            null
        };
      }
    );
}


/*
 * =====================================================
 * SPROUTS ADAPTER RESULT CONVERTER
 *
 * sprouts.js returns normalized offers plus match,
 * confidence and package requirement information.
 *
 * This helper tolerates either:
 *
 * offer.matchScore
 *
 * or
 *
 * offer.match_score
 *
 * and similar naming differences.
 * =====================================================
 */

function extractSproutsNormalizedOffers(
  sproutsResult
) {
  const rawOffers =
    Array.isArray(
      sproutsResult?.offers
    )
      ? sproutsResult.offers
      : [];


  const normalizedOffers = [];


  for (
    const item of rawOffers
  ) {

    /*
     * sprouts.js may return the normalized
     * offer directly or wrap it.
     */

    const offer =
      item.offer ||
      item.normalizedOffer ||
      item;


    if (
      !offer ||
      !offer.package ||
      !offer.price
    ) {
      continue;
    }


    const matchScore =
      Number(
        item.matchScore ??
        item.match_score ??
        offer.matchScore ??
        0
      );


    const confidenceScore =
      Number(
        item.confidenceScore ??
        item.confidence_score ??
        item.confidence ??
        offer.confidenceScore ??
        0
      );


    normalizedOffers.push({
      ...offer,

      matchScore:
        Number.isFinite(
          matchScore
        )
          ? matchScore
          : 0,

      confidenceScore:
        Number.isFinite(
          confidenceScore
        )
          ? confidenceScore
          : 0,

      requirement:
        item.requirement ||
        offer.requirement ||
        null
    });
  }


  return normalizedOffers;
}


/*
 * =====================================================
 * MAIN NETLIFY HANDLER
 * =====================================================
 */

exports.handler =
  async function (
    event
  ) {

    try {

      /*
       * =================================================
       * READ QUERY
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
       * VALIDATE PRODUCT
       * =================================================
       */

      if (
        !parsed.canonical
      ) {
        return json(
          200,
          {
            ok: false,

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
            item.canonical_id ===
            parsed.canonical
        );


      if (
        !product
      ) {
        return json(
          200,
          {
            ok: false,

            parsed,

            message:
              "The requested product is not currently configured in the prototype seed data."
          }
        );
      }


      const results = [];


/*
 * =====================================================
 * KROGER
 * =====================================================
 */

      let krogerStatus = {
        live: false,

        mode:
          "live-api",

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

          const krogerResult =
            buildNormalizedRetailerResult({
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

              location: {
                locationId:
                  live.store
                    .locationId,

                name:
                  live.store.name ||
                  "Kroger",

                address:
                  live.store
                    .address ||
                  null
              }
            });


          if (
            krogerResult
          ) {
            results.push(
              krogerResult
            );
          }


          krogerStatus = {
            live: true,

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
            live: true,

            mode:
              "official-api",

            message:
              "Kroger API connected, but no sufficiently relevant compatible priced product was returned."
          };
        }

      } catch (error) {

        krogerStatus = {
          live: false,

          mode:
            "official-api",

          message:
            error.message
        };
      }


/*
 * =====================================================
 * SPROUTS
 *
 * NEW ADAPTER PATH
 * =====================================================
 */

      let sproutsStatus = {
        live: false,

        mode:
          "adapter-prototype-evidence",

        message:
          "Sprouts adapter was not attempted."
      };


      try {

        const sproutsEvidence =
          buildSproutsEvidence(
            product
          );


        if (
          sproutsEvidence.length
        ) {

          const sproutsAdapterResult =
            await getSproutsOffers(
              parsed.normalized,
              sproutsEvidence
            );


          const sproutsOffers =
            extractSproutsNormalizedOffers(
              sproutsAdapterResult
            );


          if (
            sproutsOffers.length
          ) {

            const sproutsResult =
              buildNormalizedRetailerResult({
                retailer:
                  "Sprouts",

                offers:
                  sproutsOffers,

                request:
                  parsed.normalized,

                dataMode:
                  "prototype-evidence",

                confidenceMode:
                  "sprouts-adapter",

                location:
                  SPROUTS_MARKET ||
                  {
                    retailer:
                      "Sprouts",

                    city:
                      "Knoxville",

                    state:
                      "TN",

                    zip:
                      "37922",

                    address:
                      "9622 Kingston Pike"
                  }
              });


            if (
              sproutsResult
            ) {
              results.push(
                sproutsResult
              );
            }


            sproutsStatus = {
              live: false,

              mode:
                "adapter-prototype-evidence",

              message:
                "Sprouts is now running through the retailer adapter and shared normalization engine. Automatic live Sprouts retrieval is not connected yet.",

              candidateCount:
                sproutsOffers.length,

              location:
                SPROUTS_MARKET ||
                null
            };

          } else {

            sproutsStatus = {
              live: false,

              mode:
                "adapter-prototype-evidence",

              message:
                "Sprouts adapter ran, but no sufficiently relevant compatible offer passed match/confidence requirements."
            };
          }

        } else {

          sproutsStatus = {
            live: false,

            mode:
              "adapter-no-evidence",

            message:
              "No Sprouts prototype evidence exists for this product yet."
          };
        }

      } catch (error) {

        sproutsStatus = {
          live: false,

          mode:
            "adapter-error",

          message:
            error.message
        };
      }


/*
 * =====================================================
 * ALDI / EARTH FARE
 *
 * Keep these on seed data for now.
 *
 * IMPORTANT:
 * Sprouts is skipped here because it now has its own
 * adapter path above.
 *
 * Kroger is skipped because it must come from the
 * official live API.
 * =====================================================
 */

      const remainingRetailers =
        {};


      for (
        const seedOffer of
        product.offers
      ) {

        const retailer =
          seedOffer.retailer;


        if (
          retailer ===
            "Kroger" ||
          retailer ===
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


        remainingRetailers[
          retailer
        ] ??= [];


        remainingRetailers[
          retailer
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
          remainingRetailers
        )
      ) {

        const result =
          buildNormalizedRetailerResult({
            retailer,

            offers,

            request:
              parsed.normalized,

            dataMode:
              "prototype-seed",

            confidenceMode:
              "low-prototype",

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
 * SORT RESULTS
 *
 * Cheapest actual purchase cost first.
 * =====================================================
 */

      results.sort(
        (a, b) =>
          a.estimatedCost -
          b.estimatedCost
      );


/*
 * =====================================================
 * WINNER
 * =====================================================
 */

      const winner =
        results[0] ||
        null;


/*
 * =====================================================
 * RESPONSE
 * =====================================================
 */

      return json(
        200,
        {
          ok: true,

          parsed: {
            raw:
              parsed.raw,

            quantity:
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

          normalization: {
            enabled: true,

            weightBaseUnit:
              "oz",

            liquidBaseUnit:
              "fl_oz",

            countBaseUnit:
              "each",

            note:
              "Retailer package sizes are normalized before cost comparison. The optimizer calculates how many packages must actually be purchased and will not compare incompatible measurement types."
          },

          disclaimer:
            "Kroger uses live official API data. Sprouts now runs through the new retailer adapter and shared normalization/confidence system, but its automatic live retrieval source is not connected yet. ALDI and Earth Fare remain prototype seed data.",

          connectors: {
            kroger:
              krogerStatus,

            sprouts:
              sproutsStatus,

            aldi: {
              live: false,

              mode:
                "prototype-seed"
            },

            earthFare: {
              live: false,

              mode:
                "prototype-seed"
            }
          },

          results,

          winner
        }
      );


    } catch (error) {

      return json(
        500,
        {
          ok: false,

          error:
            error.message,

          stack:
            process.env
              .NODE_ENV ===
              "development"
                ? error.stack
                : undefined
        }
      );
    }
  };
