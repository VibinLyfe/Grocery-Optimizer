/*
 * normalize.js
 *
 * Shared grocery normalization engine.
 *
 * This file converts retailer package sizes into common
 * units so Grocery Optimizer can compare actual purchase cost.
 *
 * Internal normalization:
 * - Weight  -> ounces
 * - Liquid  -> fluid ounces
 * - Count   -> each
 */


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

function cleanText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function round(value, decimals = 4) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  const factor = 10 ** decimals;

  return Math.round(number * factor) / factor;
}


/*
 * =====================================================
 * UNIT ALIASES
 * =====================================================
 */

const UNIT_ALIASES = {
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",

  oz: "oz",
  ounce: "oz",
  ounces: "oz",

  g: "g",
  gram: "g",
  grams: "g",

  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",

  each: "each",
  ea: "each",
  count: "each",
  counts: "each",
  ct: "each",
  piece: "each",
  pieces: "each",
  item: "each",
  items: "each",

  "fl oz": "fl_oz",
  "fl. oz": "fl_oz",
  "fl. oz.": "fl_oz",
  floz: "fl_oz",
  "fluid ounce": "fl_oz",
  "fluid ounces": "fl_oz",

  pint: "pint",
  pints: "pint",
  pt: "pint",
  pts: "pint",

  quart: "quart",
  quarts: "quart",
  qt: "quart",
  qts: "quart",

  gallon: "gallon",
  gallons: "gallon",
  gal: "gallon",
  gals: "gallon",

  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",

  l: "liter",
  liter: "liter",
  liters: "liter",
  litre: "liter",
  litres: "liter"
};


function normalizeUnit(unit) {
  const cleaned = cleanText(unit);

  return UNIT_ALIASES[cleaned] || cleaned;
}


/*
 * =====================================================
 * UNIT TYPE
 * =====================================================
 */

function getUnitType(unit) {
  const normalized = normalizeUnit(unit);

  if (
    [
      "oz",
      "lb",
      "g",
      "kg"
    ].includes(normalized)
  ) {
    return "weight";
  }

  if (
    [
      "fl_oz",
      "pint",
      "quart",
      "gallon",
      "ml",
      "liter"
    ].includes(normalized)
  ) {
    return "liquid";
  }

  if (normalized === "each") {
    return "count";
  }

  return "unknown";
}


/*
 * =====================================================
 * WEIGHT CONVERSION
 *
 * All weight is normalized to ounces.
 * =====================================================
 */

function weightToOunces(quantity, unit) {
  const qty = Number(quantity);

  if (!Number.isFinite(qty)) {
    return null;
  }

  switch (normalizeUnit(unit)) {
    case "oz":
      return qty;

    case "lb":
      return qty * 16;

    case "g":
      return qty * 0.0352739619;

    case "kg":
      return qty * 35.2739619;

    default:
      return null;
  }
}


/*
 * =====================================================
 * LIQUID CONVERSION
 *
 * All liquid is normalized to fluid ounces.
 * =====================================================
 */

function liquidToFluidOunces(quantity, unit) {
  const qty = Number(quantity);

  if (!Number.isFinite(qty)) {
    return null;
  }

  switch (normalizeUnit(unit)) {
    case "fl_oz":
      return qty;

    case "pint":
      return qty * 16;

    case "quart":
      return qty * 32;

    case "gallon":
      return qty * 128;

    case "ml":
      return qty * 0.0338140227;

    case "liter":
      return qty * 33.8140227;

    default:
      return null;
  }
}


/*
 * =====================================================
 * NORMALIZED QUANTITY HELPER
 * =====================================================
 */

function normalizeQuantity(quantity, unit) {
  const unitType = getUnitType(unit);

  if (unitType === "weight") {
    return {
      type: "weight",
      normalizedQuantity: round(
        weightToOunces(quantity, unit)
      ),
      normalizedUnit: "oz"
    };
  }

  if (unitType === "liquid") {
    return {
      type: "liquid",
      normalizedQuantity: round(
        liquidToFluidOunces(
          quantity,
          unit
        )
      ),
      normalizedUnit: "fl_oz"
    };
  }

  if (unitType === "count") {
    return {
      type: "count",
      normalizedQuantity: round(
        Number(quantity)
      ),
      normalizedUnit: "each"
    };
  }

  return null;
}


/*
 * =====================================================
 * PACKAGE PARSER
 *
 * Supported examples:
 *
 * Weight:
 * 16 oz
 * 1 lb
 * 3 LB BIG DEAL
 * 3 x 1 lb
 * 3 × 12 oz
 *
 * Liquid:
 * 32 fl oz
 * 1 quart
 * 1 gallon
 * 946 ml
 * 1 liter
 *
 * Count:
 * 4 ct
 * 6 count
 * =====================================================
 */

function parsePackageSize(
  sizeText,
  descriptionText = ""
) {
  const size = cleanText(sizeText);

  const description =
    cleanText(descriptionText);

  const combined =
    `${description} ${size}`.trim();


  /*
   * ===================================================
   * MULTIPACK WEIGHT
   *
   * Examples:
   * 3 x 1 lb
   * 2 x 12 oz
   * ===================================================
   */

  let match = combined.match(
    /\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces|kg|kilogram|kilograms|g|gram|grams)\b/
  );

  if (match) {
    const packageCount =
      Number(match[1]);

    const eachQuantity =
      Number(match[2]);

    const unit =
      normalizeUnit(match[3]);

    const totalQuantity =
      packageCount *
      eachQuantity;

    const normalized =
      normalizeQuantity(
        totalQuantity,
        unit
      );

    if (normalized) {
      return {
        type:
          normalized.type,

        packageCount,

        quantity:
          totalQuantity,

        unit,

        eachQuantity,

        normalizedQuantity:
          normalized
            .normalizedQuantity,

        normalizedUnit:
          normalized
            .normalizedUnit,

        source:
          "multipack-weight"
      };
    }
  }


  /*
   * ===================================================
   * MULTIPACK LIQUID
   *
   * Examples:
   * 6 x 12 fl oz
   * 4 x 16.9 fl oz
   * ===================================================
   */

  match = combined.match(
    /\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|floz|fluid ounces?|pints?|pts?|quarts?|qts?|gallons?|gals?|ml|milliliters?|liters?|litres?)\b/
  );

  if (match) {
    const packageCount =
      Number(match[1]);

    const eachQuantity =
      Number(match[2]);

    const unit =
      normalizeUnit(match[3]);

    const totalQuantity =
      packageCount *
      eachQuantity;

    const normalized =
      normalizeQuantity(
        totalQuantity,
        unit
      );

    if (normalized) {
      return {
        type:
          normalized.type,

        packageCount,

        quantity:
          totalQuantity,

        unit,

        eachQuantity,

        normalizedQuantity:
          normalized
            .normalizedQuantity,

        normalizedUnit:
          normalized
            .normalizedUnit,

        source:
          "multipack-liquid"
      };
    }
  }


  /*
   * ===================================================
   * DESCRIPTION WEIGHT
   *
   * Description is checked before the retailer size field.
   *
   * This protects against retailer metadata like:
   *
   * Description:
   * "3 LB BIG DEAL"
   *
   * Size:
   * "1 lb"
   * ===================================================
   */

  match = description.match(
    /\b(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces|kg|kilogram|kilograms|g|gram|grams)\b/
  );

  if (match) {
    const quantity =
      Number(match[1]);

    const unit =
      normalizeUnit(match[2]);

    const normalized =
      normalizeQuantity(
        quantity,
        unit
      );

    if (normalized) {
      return {
        type:
          normalized.type,

        packageCount: 1,

        quantity,

        unit,

        normalizedQuantity:
          normalized
            .normalizedQuantity,

        normalizedUnit:
          normalized
            .normalizedUnit,

        source:
          "description-weight"
      };
    }
  }


  /*
   * ===================================================
   * SIZE FIELD WEIGHT
   * ===================================================
   */

  match = size.match(
    /\b(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces|kg|kilogram|kilograms|g|gram|grams)\b/
  );

  if (match) {
    const quantity =
      Number(match[1]);

    const unit =
      normalizeUnit(match[2]);

    const normalized =
      normalizeQuantity(
        quantity,
        unit
      );

    if (normalized) {
      return {
        type:
          normalized.type,

        packageCount: 1,

        quantity,

        unit,

        normalizedQuantity:
          normalized
            .normalizedQuantity,

        normalizedUnit:
          normalized
            .normalizedUnit,

        source:
          "size-weight"
      };
    }
  }


  /*
   * ===================================================
   * DESCRIPTION LIQUID
   * ===================================================
   */

  match = description.match(
    /\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|floz|fluid ounces?|pints?|pts?|quarts?|qts?|gallons?|gals?|ml|milliliters?|liters?|litres?)\b/
  );

  if (match) {
    const quantity =
      Number(match[1]);

    const unit =
      normalizeUnit(match[2]);

    const normalized =
      normalizeQuantity(
        quantity,
        unit
      );

    if (normalized) {
      return {
        type:
          normalized.type,

        packageCount: 1,

        quantity,

        unit,

        normalizedQuantity:
          normalized
            .normalizedQuantity,

        normalizedUnit:
          normalized
            .normalizedUnit,

        source:
          "description-liquid"
      };
    }
  }


  /*
   * ===================================================
   * SIZE FIELD LIQUID
   * ===================================================
   */

  match = size.match(
    /\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz\.?|floz|fluid ounces?|pints?|pts?|quarts?|qts?|gallons?|gals?|ml|milliliters?|liters?|litres?)\b/
  );

  if (match) {
    const quantity =
      Number(match[1]);

    const unit =
      normalizeUnit(match[2]);

    const normalized =
      normalizeQuantity(
        quantity,
        unit
      );

    if (normalized) {
      return {
        type:
          normalized.type,

        packageCount: 1,

        quantity,

        unit,

        normalizedQuantity:
          normalized
            .normalizedQuantity,

        normalizedUnit:
          normalized
            .normalizedUnit,

        source:
          "size-liquid"
      };
    }
  }


  /*
   * ===================================================
   * COUNT
   *
   * Examples:
   * 4 ct
   * 6 count
   * 12 pieces
   * ===================================================
   */

  match = combined.match(
    /\b(\d+)\s*(ct|count|counts|piece|pieces|item|items)\b/
  );

  if (match) {
    const quantity =
      Number(match[1]);

    return {
      type: "count",

      packageCount: 1,

      quantity,

      unit: "each",

      normalizedQuantity:
        quantity,

      normalizedUnit:
        "each",

      source:
        "count"
    };
  }


  /*
   * ===================================================
   * NO RELIABLE PACKAGE SIZE
   *
   * We deliberately do not invent weight or volume.
   *
   * This is treated as one purchasable unit.
   * ===================================================
   */

  return {
    type: "count",

    packageCount: 1,

    quantity: 1,

    unit: "each",

    normalizedQuantity: 1,

    normalizedUnit:
      "each",

    source:
      "inferred-single-package"
  };
}


/*
 * =====================================================
 * USER REQUEST NORMALIZATION
 *
 * Example:
 *
 * Shopper:
 * 2 lb organic broccoli
 *
 * Internal:
 * 32 oz organic broccoli
 * =====================================================
 */

function normalizeRequest({
  quantity,
  unit,
  description,
  canonicalId = null,
  attributes = {}
}) {
  const requestedUnit =
    normalizeUnit(unit);

  const unitType =
    getUnitType(
      requestedUnit
    );


  const normalized =
    normalizeQuantity(
      quantity,
      requestedUnit
    );


  if (!normalized) {
    return {
      canonicalId,

      description:
        description || "",

      requestedQuantity:
        Number(quantity),

      requestedUnit,

      unitType:
        "unknown",

      normalizedQuantity:
        Number(quantity),

      normalizedUnit:
        requestedUnit,

      attributes
    };
  }


  return {
    canonicalId,

    description:
      description || "",

    requestedQuantity:
      Number(quantity),

    requestedUnit,

    unitType:
      normalized.type,

    normalizedQuantity:
      normalized
        .normalizedQuantity,

    normalizedUnit:
      normalized
        .normalizedUnit,

    attributes
  };
}


/*
 * =====================================================
 * PRODUCT ATTRIBUTE DETECTION
 * =====================================================
 */

function detectAttributes(text) {
  const value =
    cleanText(text);

  return {
    organic:
      /\borganic\b/.test(
        value
      ),

    grassFed:
      /\bgrass[\s-]?fed\b/.test(
        value
      ),

    frozen:
      /\bfrozen\b/.test(
        value
      ),

    fresh:
      /\bfresh\b/.test(
        value
      ),

    wholeBean:
      /\bwhole[\s-]?bean\b/.test(
        value
      ),

    ground:
      /\bground\b/.test(
        value
      ),

    lean8515:
      /\b85\s*[/\-]\s*15\b|\b85%\b/.test(
        value
      ),

    lean9010:
      /\b90\s*[/\-]\s*10\b|\b90%\b/.test(
        value
      ),

    lean9317:
      /\b93\s*[/\-]\s*7\b|\b93%\b/.test(
        value
      )
  };
}


/*
 * =====================================================
 * PRODUCT MATCH SCORE
 *
 * Match score answers:
 *
 * "How closely does this product match the shopper request?"
 *
 * This is separate from source confidence.
 * =====================================================
 */

function scoreProductMatch(
  request,
  offer
) {
  let score = 50;

  const requestedText =
    cleanText(
      request?.description
    );

  const offerText =
    cleanText(
      [
        offer?.title,
        offer?.brand,
        offer?.description
      ]
        .filter(Boolean)
        .join(" ")
    );


  const requestedAttributes =
    request &&
    request.attributes &&
    Object.keys(
      request.attributes
    ).length

      ? request.attributes

      : detectAttributes(
          requestedText
        );


  const offerAttributes =
    offer?.attributes ||
    detectAttributes(
      offerText
    );


  /*
   * ===================================================
   * REQUIRED ATTRIBUTES
   * ===================================================
   */

  if (
    requestedAttributes.organic
  ) {
    score +=
      offerAttributes.organic
        ? 15
        : -35;
  }


  if (
    requestedAttributes.grassFed
  ) {
    score +=
      offerAttributes.grassFed
        ? 10
        : -25;
  }


  if (
    requestedAttributes.lean8515
  ) {
    score +=
      offerAttributes.lean8515
        ? 10
        : -25;
  }


  if (
    requestedAttributes.lean9010
  ) {
    score +=
      offerAttributes.lean9010
        ? 10
        : -25;
  }


  if (
    requestedAttributes.lean9317
  ) {
    score +=
      offerAttributes.lean9317
        ? 10
        : -25;
  }


  if (
    requestedAttributes.wholeBean
  ) {
    score +=
      offerAttributes.wholeBean
        ? 10
        : -25;
  }


  if (
    requestedAttributes.ground &&
    !offerAttributes.ground
  ) {
    score -= 15;
  }


  if (
    requestedAttributes.frozen &&
    !offerAttributes.frozen
  ) {
    score -= 20;
  }


  if (
    requestedAttributes.fresh &&
    offerAttributes.frozen
  ) {
    score -= 25;
  }


  /*
   * ===================================================
   * WORD OVERLAP
   * ===================================================
   */

  const stopWords =
    new Set([
      "the",
      "and",
      "with",
      "for",
      "from",
      "into",
      "of",
      "a",
      "an",
      "organic",
      "fresh",
      "frozen",
      "grass",
      "fed",
      "each",
      "count",
      "ct",
      "lb",
      "lbs",
      "oz"
    ]);


  const words = [
    ...new Set(
      requestedText
        .split(/\W+/)
        .filter(
          word =>
            word.length >= 3 &&
            !stopWords.has(word)
        )
    )
  ];


  if (words.length) {
    const hits =
      words.filter(
        word =>
          offerText.includes(
            word
          )
      ).length;


    score +=
      (
        hits /
        words.length
      ) * 20;
  }


  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}


/*
 * =====================================================
 * NORMALIZE RETAILER OFFER
 * =====================================================
 */

function normalizeOffer({
  retailer,
  title,
  brand = null,
  description = "",
  size = "",
  price,
  location = null,
  source = {},
  attributes = null,
  productId = null
}) {
  const numericPrice =
    Number(price);


  if (
    !Number.isFinite(
      numericPrice
    ) ||
    numericPrice <= 0
  ) {
    return null;
  }


  const packageInfo =
    parsePackageSize(
      size,
      description || title
    );


  const detectedAttributes =
    attributes ||
    detectAttributes(
      [
        title,
        description,
        brand
      ]
        .filter(Boolean)
        .join(" ")
    );


  const normalizedPackageQty =
    Number(
      packageInfo
        .normalizedQuantity
    );


  const unitPrice =
    Number.isFinite(
      normalizedPackageQty
    ) &&
    normalizedPackageQty > 0

      ? numericPrice /
        normalizedPackageQty

      : null;


  return {
    retailer,

    title,

    brand,

    description,

    productId,

    package:
      packageInfo,

    price: {
      total:
        round(
          numericPrice,
          2
        ),

      perNormalizedUnit:
        unitPrice === null
          ? null
          : round(
              unitPrice,
              6
            ),

      normalizedUnit:
        packageInfo
          .normalizedUnit,

      perPound:
        packageInfo.type ===
          "weight" &&
        unitPrice !== null

          ? round(
              unitPrice * 16,
              4
            )

          : null,

      perFluidOunce:
        packageInfo.type ===
          "liquid" &&
        unitPrice !== null

          ? round(
              unitPrice,
              6
            )

          : null
    },

    attributes:
      detectedAttributes,

    location,

    source
  };
}


/*
 * =====================================================
 * PACKAGE REQUIREMENT
 *
 * This calculates how many packages must actually
 * be purchased.
 *
 * Example:
 *
 * Shopper wants:
 * 16 oz
 *
 * Retailer package:
 * 12 oz
 *
 * Shopper must buy:
 * 2 packages = 24 oz
 * =====================================================
 */

function calculatePackageRequirement(
  request,
  offer
) {
  if (
    !request ||
    !offer ||
    !offer.package
  ) {
    return null;
  }


  /*
   * Never compare unlike measurement types.
   *
   * Examples rejected:
   *
   * 1 lb request
   * vs
   * 1 each retailer package
   *
   * We do not invent a weight.
   */

  if (
    request.normalizedUnit !==
    offer.package
      .normalizedUnit
  ) {
    return null;
  }


  const requested =
    Number(
      request
        .normalizedQuantity
    );


  const packageQuantity =
    Number(
      offer.package
        .normalizedQuantity
    );


  if (
    !Number.isFinite(
      requested
    ) ||
    requested <= 0 ||
    !Number.isFinite(
      packageQuantity
    ) ||
    packageQuantity <= 0
  ) {
    return null;
  }


  const packagesNeeded =
    Math.ceil(
      requested /
      packageQuantity
    );


  const suppliedQuantity =
    packagesNeeded *
    packageQuantity;


  const excessQuantity =
    suppliedQuantity -
    requested;


  const totalCost =
    packagesNeeded *
    offer.price.total;


  return {
    packagesNeeded,

    requestedQuantity:
      round(requested),

    suppliedQuantity:
      round(
        suppliedQuantity
      ),

    normalizedUnit:
      request.normalizedUnit,

    excessQuantity:
      round(
        excessQuantity
      ),

    fulfillmentRatio:
      round(
        suppliedQuantity /
        requested,
        4
      ),

    totalCost:
      round(
        totalCost,
        2
      )
  };
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  cleanText,
  round,
  normalizeUnit,
  getUnitType,
  weightToOunces,
  liquidToFluidOunces,
  normalizeQuantity,
  parsePackageSize,
  normalizeRequest,
  detectAttributes,
  scoreProductMatch,
  normalizeOffer,
  calculatePackageRequirement
};
