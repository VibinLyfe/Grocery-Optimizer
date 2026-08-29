/*
 * Toomey Grocery Optimized
 * netlify/functions/evidence-refresh.js
 *
 * Builds the pricing-evidence research / refresh plan.
 *
 * GET
 * ----
 * Uses the permanent catalog in public/products.json.
 *
 * POST
 * ----
 * Uses the permanent catalog PLUS custom products supplied
 * by the browser:
 *
 * {
 *   "customProducts": [...]
 * }
 *
 * This endpoint DOES NOT scrape retailer websites and
 * DOES NOT invent prices.
 *
 * It only determines which products:
 * - already have current evidence
 * - have aging evidence
 * - have stale evidence
 * - have evidence with unknown age
 * - have no evidence at all
 */

const fs = require("fs");
const path = require("path");


/*
 * =====================================================
 * CONSTANTS
 * =====================================================
 */

const MAX_CURRENT_AGE_DAYS = 7;
const MAX_AGING_AGE_DAYS = 14;


const RETAILERS = {
  earthFare: {
    retailer: "Earth Fare",

    evidenceFile:
      "earthfare-evidence.json",

    location: {
      retailer: "Earth Fare",
      city: "Knoxville",
      state: "TN",
      zip: "37934",
      address: "10903 Parkside Dr",
      market: "Knoxville, TN"
    }
  },

  sprouts: {
    retailer: "Sprouts",

    evidenceFile:
      "sprouts-evidence.json",

    location: {
      retailer: "Sprouts",
      city: "Knoxville",
      state: "TN",
      zip: "37922",
      address: "9622 Kingston Pike",
      market: "Knoxville, TN"
    }
  }
};


/*
 * =====================================================
 * RESPONSE HELPERS
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
        "no-store",

      "Access-Control-Allow-Origin":
        "*",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Access-Control-Allow-Methods":
        "GET, POST, OPTIONS"
    },

    body:
      JSON.stringify(
        body,
        null,
        2
      )
  };
}


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

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


function slugify(
  value
) {
  return cleanText(
    value
  )
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}


function titleCase(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


/*
 * =====================================================
 * CUSTOM PRODUCT NAME NORMALIZATION
 *
 * This mirrors the conservative singular/plural behavior
 * now used by compare.js.
 *
 * Example:
 *
 * Organic Japanese yam
 * Organic Japanese yams
 *
 * both become:
 *
 * custom-organic-japanese-yams
 * =====================================================
 */

const MASS_OR_UNCHANGED_WORDS =
  new Set([
    "beef",
    "bread",
    "broccoli",
    "cheese",
    "coffee",
    "fish",
    "milk",
    "oats",
    "oil",
    "quinoa",
    "rice",
    "soap",
    "spinach",
    "turkey",
    "water"
  ]);


const IRREGULAR_PLURALS = {
  potato:
    "potatoes",

  tomato:
    "tomatoes",

  berry:
    "berries",

  cherry:
    "cherries",

  strawberry:
    "strawberries",

  blueberry:
    "blueberries",

  raspberry:
    "raspberries",

  cranberry:
    "cranberries"
};


function pluralizeWord(
  word
) {
  const value =
    cleanText(
      word
    );


  if (!value) {
    return value;
  }


  if (
    MASS_OR_UNCHANGED_WORDS
      .has(value)
  ) {
    return value;
  }


  if (
    IRREGULAR_PLURALS[
      value
    ]
  ) {
    return (
      IRREGULAR_PLURALS[
        value
      ]
    );
  }


  if (
    value.endsWith(
      "ies"
    ) ||
    value.endsWith(
      "oes"
    )
  ) {
    return value;
  }


  if (
    value.endsWith("s") &&
    !value.endsWith("ss")
  ) {
    return value;
  }


  if (
    /[^aeiou]y$/.test(
      value
    )
  ) {
    return (
      value.slice(
        0,
        -1
      ) +
      "ies"
    );
  }


  if (
    /(s|x|z|ch|sh)$/.test(
      value
    )
  ) {
    return (
      value +
      "es"
    );
  }


  return (
    value +
    "s"
  );
}


function normalizeCustomName(
  value
) {
  const words =
    cleanText(
      value
    )
      .split(/\s+/)
      .filter(Boolean);


  if (!words.length) {
    return "";
  }


  const lastIndex =
    words.length - 1;


  words[
    lastIndex
  ] =
    pluralizeWord(
      words[
        lastIndex
      ]
    );


  return words.join(" ");
}


function customCanonicalId(
  value
) {
  const normalized =
    normalizeCustomName(
      value
    );


  return (
    `custom-${slugify(
      normalized
    )}`
  );
}


/*
 * =====================================================
 * FILE PATH HELPERS
 * =====================================================
 */

function candidatePaths(
  ...parts
) {
  return [
    path.join(
      process.cwd(),
      ...parts
    ),

    path.join(
      __dirname,
      "..",
      "..",
      ...parts
    )
  ];
}


function readJSONFromPaths(
  paths
) {
  let lastError =
    null;


  for (
    const filePath of
    paths
  ) {
    try {
      if (
        !fs.existsSync(
          filePath
        )
      ) {
        continue;
      }


      return {
        data:
          JSON.parse(
            fs.readFileSync(
              filePath,
              "utf8"
            )
          ),

        error:
          null,

        filePath
      };

    } catch (
      error
    ) {
      lastError =
        error.message;
    }
  }


  return {
    data:
      null,

    error:
      lastError ||
      "File was not found.",

    filePath:
      null
  };
}


/*
 * =====================================================
 * STATIC PRODUCT CATALOG
 * =====================================================
 */

function loadBaseCatalog() {
  const result =
    readJSONFromPaths(
      candidatePaths(
        "public",
        "products.json"
      )
    );


  if (
    !Array.isArray(
      result.data
    )
  ) {
    return {
      products: [],
      error:
        result.error ||
        "products.json did not contain an array."
    };
  }


  return {
    products:
      result.data,

    error:
      null
  };
}


/*
 * =====================================================
 * EVIDENCE FILE
 * =====================================================
 */

function loadEvidence(
  filename
) {
  const result =
    readJSONFromPaths(
      candidatePaths(
        "data",
        filename
      )
    );


  if (
    !Array.isArray(
      result.data
    )
  ) {
    return {
      records: [],

      error:
        result.error ||
        `${filename} did not contain an array.`
    };
  }


  return {
    records:
      result.data,

    error:
      null
  };
}


/*
 * =====================================================
 * CATALOG NORMALIZATION
 * =====================================================
 */

function normalizeBaseProduct(
  product
) {
  if (!product) {
    return null;
  }


  const id =
    product.id ||
    product.canonicalId ||
    product.canonical_id ||
    null;


  const label =
    product.label ||
    product.name ||
    product.queryName ||
    id;


  if (
    !id ||
    !label
  ) {
    return null;
  }


  return {
    id:
      String(id),

    label:
      String(label),

    category:
      product.category ||
      "Other",

    queryName:
      product.queryName ||
      product.query ||
      cleanText(
        label
      ),

    defaultUnit:
      product.defaultUnit ||
      product.unit ||
      "each",

    allowedUnits:
      Array.isArray(
        product.allowedUnits
      )
        ? product.allowedUnits
        : [
            product.defaultUnit ||
            product.unit ||
            "each"
          ],

    custom:
      false
  };
}


function normalizeCustomProduct(
  product
) {
  if (!product) {
    return null;
  }


  const rawName =
    product.queryName ||
    product.label ||
    product.name ||
    "";


  if (
    !cleanText(
      rawName
    )
  ) {
    return null;
  }


  const normalizedName =
    normalizeCustomName(
      rawName
    );


  const id =
    customCanonicalId(
      rawName
    );


  const defaultUnit =
    product.defaultUnit ||
    product.unit ||
    (
      Array.isArray(
        product.allowedUnits
      )
        ? product.allowedUnits[0]
        : null
    ) ||
    "each";


  return {
    id,

    label:
      product.label ||
      product.name ||
      titleCase(
        normalizedName
      ),

    category:
      product.category ||
      "Other",

    /*
     * Keep the shopper's useful wording for searches.
     * The ID is normalized for identity, but the query
     * does not need artificial pluralization.
     */

    queryName:
      cleanText(
        rawName
      ),

    defaultUnit,

    allowedUnits:
      Array.isArray(
        product.allowedUnits
      ) &&
      product.allowedUnits.length
        ? product.allowedUnits
        : [
            defaultUnit
          ],

    custom:
      true,

    originalId:
      product.id ||
      null
  };
}


/*
 * =====================================================
 * MERGE CATALOG
 * =====================================================
 */

function mergeCatalog(
  baseProducts,
  customProducts
) {
  const merged =
    new Map();


  for (
    const rawProduct of
    baseProducts
  ) {
    const product =
      normalizeBaseProduct(
        rawProduct
      );


    if (!product) {
      continue;
    }


    merged.set(
      product.id,
      product
    );
  }


  for (
    const rawProduct of
    customProducts
  ) {
    const product =
      normalizeCustomProduct(
        rawProduct
      );


    if (!product) {
      continue;
    }


    /*
     * Do not replace a permanent catalog product if a
     * custom product happens to normalize to its ID.
     */

    if (
      !merged.has(
        product.id
      )
    ) {
      merged.set(
        product.id,
        product
      );
    }
  }


  return [
    ...merged.values()
  ];
}


/*
 * =====================================================
 * FRESHNESS
 * =====================================================
 */

function calculateAgeDays(
  observedAt
) {
  if (!observedAt) {
    return null;
  }


  const observed =
    new Date(
      observedAt
    );


  if (
    Number.isNaN(
      observed.getTime()
    )
  ) {
    return null;
  }


  return Math.max(
    0,
    Math.floor(
      (
        Date.now() -
        observed.getTime()
      ) /
      86400000
    )
  );
}


function getFreshnessStatus(
  observedAt
) {
  const ageDays =
    calculateAgeDays(
      observedAt
    );


  if (
    ageDays === null
  ) {
    return {
      freshness:
        "unknown",

      ageDays:
        null,

      needsRefresh:
        true
    };
  }


  if (
    ageDays <=
    MAX_CURRENT_AGE_DAYS
  ) {
    return {
      freshness:
        "current",

      ageDays,

      needsRefresh:
        false
    };
  }


  if (
    ageDays <=
    MAX_AGING_AGE_DAYS
  ) {
    return {
      freshness:
        "aging",

      ageDays,

      needsRefresh:
        true
    };
  }


  return {
    freshness:
      "stale",

    ageDays,

    needsRefresh:
      true
  };
}


/*
 * =====================================================
 * PRODUCT EVIDENCE LOOKUP
 * =====================================================
 */

function recordsForProduct(
  product,
  evidenceRecords
) {
  return (
    evidenceRecords
      .filter(
        record => {
          if (!record) {
            return false;
          }


          const canonical =
            record.canonicalId ||
            record.canonical_id ||
            null;


          return (
            canonical ===
            product.id
          );
        }
      )
  );
}


/*
 * =====================================================
 * PICK BEST EVIDENCE STATE
 * =====================================================
 */

function evidenceState(
  product,
  evidenceRecords
) {
  const records =
    recordsForProduct(
      product,
      evidenceRecords
    );


  if (!records.length) {
    return {
      reason:
        "missing-evidence",

      freshness:
        "missing",

      ageDays:
        null,

      evidenceCount:
        0,

      observedAt:
        null
    };
  }


  const evaluated =
    records.map(
      record => {
        const state =
          getFreshnessStatus(
            record.observedAt
          );


        return {
          record,
          ...state
        };
      }
    );


  /*
   * Any current evidence means the product does not
   * need to become a refresh target.
   */

  const current =
    evaluated
      .filter(
        item =>
          item.freshness ===
          "current"
      )
      .sort(
        (a, b) =>
          (
            a.ageDays ??
            Number.MAX_SAFE_INTEGER
          ) -
          (
            b.ageDays ??
            Number.MAX_SAFE_INTEGER
          )
      );


  if (
    current.length
  ) {
    return {
      reason:
        "current-evidence",

      freshness:
        "current",

      ageDays:
        current[0]
          .ageDays,

      evidenceCount:
        records.length,

      observedAt:
        current[0]
          .record
          .observedAt ||
        null
    };
  }


  const aging =
    evaluated
      .filter(
        item =>
          item.freshness ===
          "aging"
      )
      .sort(
        (a, b) =>
          a.ageDays -
          b.ageDays
      );


  if (
    aging.length
  ) {
    return {
      reason:
        "aging-evidence",

      freshness:
        "aging",

      ageDays:
        aging[0]
          .ageDays,

      evidenceCount:
        records.length,

      observedAt:
        aging[0]
          .record
          .observedAt ||
        null
    };
  }


  const stale =
    evaluated
      .filter(
        item =>
          item.freshness ===
          "stale"
      )
      .sort(
        (a, b) =>
          a.ageDays -
          b.ageDays
      );


  if (
    stale.length
  ) {
    return {
      reason:
        "stale-evidence",

      freshness:
        "stale",

      ageDays:
        stale[0]
          .ageDays,

      evidenceCount:
        records.length,

      observedAt:
        stale[0]
          .record
          .observedAt ||
        null
    };
  }


  return {
    reason:
      "unknown-evidence-age",

    freshness:
      "unknown",

    ageDays:
      null,

    evidenceCount:
      records.length,

    observedAt:
      null
  };
}


/*
 * =====================================================
 * DISCOVERY SEARCH QUERIES
 * =====================================================
 */

function buildQueries(
  retailer,
  product
) {
  const queryName =
    product.queryName ||
    product.label;


  return [
    `${retailer} ${queryName} Knoxville TN price`,

    `"${queryName}" "${retailer}"`,

    `${retailer} ${queryName} weekly ad`
  ];
}


/*
 * =====================================================
 * RETAILER PLAN
 * =====================================================
 */

function buildRetailerPlan(
  retailerConfig,
  catalog
) {
  const evidence =
    loadEvidence(
      retailerConfig
        .evidenceFile
    );


  const targets =
    [];


  const coverage = {
    current:
      0,

    missing:
      0,

    aging:
      0,

    stale:
      0,

    unknown:
      0
  };


  for (
    const product of
    catalog
  ) {
    const state =
      evidenceState(
        product,
        evidence.records
      );


    if (
      state.freshness ===
      "current"
    ) {
      coverage.current +=
        1;

      continue;
    }


    if (
      state.freshness ===
      "missing"
    ) {
      coverage.missing +=
        1;

    } else if (
      state.freshness ===
      "aging"
    ) {
      coverage.aging +=
        1;

    } else if (
      state.freshness ===
      "stale"
    ) {
      coverage.stale +=
        1;

    } else {
      coverage.unknown +=
        1;
    }


    targets.push({
      id:
        product.id,

      label:
        product.label,

      category:
        product.category,

      queryName:
        product.queryName,

      defaultUnit:
        product.defaultUnit,

      custom:
        Boolean(
          product.custom
        ),

      reason:
        state.reason,

      freshness:
        state.freshness,

      ageDays:
        state.ageDays,

      observedAt:
        state.observedAt,

      evidenceCount:
        state.evidenceCount,

      queries:
        buildQueries(
          retailerConfig
            .retailer,
          product
        )
    });
  }


  return {
    retailer:
      retailerConfig
        .retailer,

    location:
      retailerConfig
        .location,

    evidenceRecordCount:
      evidence.records
        .length,

    loadError:
      evidence.error,

    summary: {
      /*
       * Keep totalTargets for compatibility with the
       * existing frontend / diagnostic output.
       */

      totalTargets:
        targets.length,

      current:
        coverage.current,

      missing:
        coverage.missing,

      aging:
        coverage.aging,

      stale:
        coverage.stale,

      unknown:
        coverage.unknown
    },

    targets
  };
}


/*
 * =====================================================
 * REQUEST BODY
 * =====================================================
 */

function parseBody(
  event
) {
  if (
    !event.body
  ) {
    return {};
  }


  try {
    return (
      JSON.parse(
        event.body
      ) ||
      {}
    );

  } catch {
    return {};
  }
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
      const method =
        String(
          event.httpMethod ||
          "GET"
        )
          .toUpperCase();


      if (
        method ===
        "OPTIONS"
      ) {
        return json(
          200,
          {
            ok:
              true
          }
        );
      }


      if (
        method !==
          "GET" &&
        method !==
          "POST"
      ) {
        return json(
          405,
          {
            ok:
              false,

            message:
              "Use GET or POST."
          }
        );
      }


      const base =
        loadBaseCatalog();


      if (
        base.error
      ) {
        return json(
          500,
          {
            ok:
              false,

            message:
              "Could not load the permanent grocery catalog.",

            error:
              base.error
          }
        );
      }


      const body =
        method ===
        "POST"
          ? parseBody(
              event
            )
          : {};


      const suppliedCustomProducts =
        Array.isArray(
          body.customProducts
        )
          ? body.customProducts
          : [];


      const catalog =
        mergeCatalog(
          base.products,
          suppliedCustomProducts
        );


      const normalizedBaseCount =
        base.products
          .map(
            normalizeBaseProduct
          )
          .filter(Boolean)
          .length;


      const customCatalogCount =
        catalog.filter(
          product =>
            product.custom
        ).length;


      const earthFare =
        buildRetailerPlan(
          RETAILERS
            .earthFare,
          catalog
        );


      const sprouts =
        buildRetailerPlan(
          RETAILERS
            .sprouts,
          catalog
        );


      return json(
        200,
        {
          ok:
            true,

          generatedAt:
            new Date()
              .toISOString(),

          requestMode:
            method ===
            "POST"
              ? "catalog-plus-custom-products"
              : "static-catalog-only",

          catalog: {
            productCount:
              catalog.length,

            baseProductCount:
              normalizedBaseCount,

            customProductCount:
              customCatalogCount,

            receivedCustomProductCount:
              suppliedCustomProducts
                .length
          },

          retailers: {
            earthFare,

            sprouts
          }
        }
      );

    } catch (
      error
    ) {
      console.error(
        "Evidence refresh error:",
        error
      );


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
