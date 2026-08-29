/*
 * normalize.js
 *
 * Shared grocery normalization engine.
 *
 * This file converts different retailer package sizes
 * into common units so the optimizer can make legitimate
 * price comparisons.
 */

function cleanText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}


/*
 * =====================================================
 * UNITS
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
  ct: "each",
  piece: "each",
  pieces: "each",

  "fl oz": "fl_oz",
  floz: "fl_oz",

  pint: "pint",
  pints: "pint",
  pt: "pint",

  quart: "quart",
  quarts: "quart",
  qt: "quart",

  gallon: "gallon",
  gallons: "gallon",
  gal: "gallon"
};


function normalizeUnit(unit) {
  const value = cleanText(unit);
  return UNIT_ALIASES[value] || value;
}


/*
 * =====================================================
 * WEIGHT CONVERSION
 *
 * All weights are internally converted to ounces.
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
 * All liquid measurements are internally converted
 * to fluid ounces.
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

    default:
      return null;
  }
}


function getUnitType(unit) {
  const normalized = normalizeUnit(unit);

  if (
    ["oz", "lb", "g", "kg"].includes(normalized)
  ) {
    return "weight";
  }

  if (
    [
      "fl_oz",
      "pint",
      "quart",
      "gallon"
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
 * RETAIL PACKAGE PARSER
 *
 * Examples:
 *
 * 16 oz
 * 1 lb
 * 3 LB BIG DEAL
 * 3 x 1 lb
 * 3 × 12 oz
 * 4 count
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
   * MULTIPACK
   *
   * Example:
   * 3 x 1 lb
   */

  let match = combined.match(
    /\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces)\b/
  );

  if (match) {
    const count =
      Number(match[1]);

    const eachQty =
      Number(match[2]);

    const unit =
      normalizeUnit(match[3]);

    return {
      type: "weight",

      packageCount: count,

      quantity:
        count * eachQty,

      unit,

      normalizedQuantity:
        round(
          weightToOunces(
            count * eachQty,
            unit
          )
        ),

      normalizedUnit: "oz",

      source:
        "multipack-weight"
    };
  }


  /*
   * DESCRIPTION WEIGHT
   *
   * This is deliberately checked before the
   * retailer's size field.
   *
   * This protects us from situations like Kroger's:
   *
   * Description:
   * "3 LB BIG DEAL"
   *
   * size:
   * "1 lb"
   */

  match = description.match(
    /\b(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces|kg|kilogram|kilograms|g|gram|grams)\b/
  );

  if (!match) {
    match = size.match(
      /\b(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|oz|ounce|ounces|kg|kilogram|kilograms|g|gram|grams)\b/
    );
  }

  if (match) {
    const quantity =
      Number(match[1]);

    const unit =
      normalizeUnit(match[2]);

    return {
      type: "weight",

      packageCount: 1,

      quantity,

      unit,

      normalizedQuantity:
        round(
          weightToOunces(
            quantity,
            unit
          )
        ),

      normalizedUnit: "oz",

      source:
        "weight"
    };
  }


  /*
   * COUNT-BASED PRODUCTS
   *
   * Examples:
   * 4 ct
   * 6 count
   */

  match = combined.match(
    /\b(\d+)\s*(ct|count|piece|pieces)\b/
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
   * No reliable package measurement.
   *
   * Treat it as one retail unit.
   * We do NOT invent a weight.
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
 * User asks:
 * 1 lb organic broccoli
 *
 * Internal representation:
 * 16 oz organic broccoli
 * =====================================================
 */

function normalizeRequest({
  quantity,
  unit,
  description,
  canonicalId,
  attributes = {}
}) {
  const requestedUnit =
    normalizeUnit(unit);

  const unitType =
    getUnitType(requestedUnit);

  let normalizedQuantity =
    Number(quantity);

  let normalizedUnit =
    requestedUnit;


  if (unitType === "weight") {
    normalizedQuantity =
      weightToOunces(
        quantity,
        requestedUnit
      );

    normalizedUnit = "oz";
  }


  if (unitType === "liquid") {
    normalizedQuantity =
      liquidToFluidOunces(
        quantity,
        requestedUnit
      );

    normalizedUnit =
      "fl_oz";
  }


  return {
    canonicalId:
      canonicalId || null,

    description:
      description || "",

    requestedQuantity:
      Number(quantity),

    requestedUnit,

    unitType,

    normalizedQuantity:
      round(normalizedQuantity),

    normalizedUnit,

    attributes
  };
}


/*
 * =====================================================
 * PRODUCT ATTRIBUTES
 * =====================================================
 */

function detectAttributes(text) {
  const value =
    cleanText(text);

  return {
    organic:
      /\borganic\b/.test(value),

    grassFed:
      /\bgrass[\s-]?fed\b/.test(
        value
      ),

    frozen:
      /\bfrozen\b/.test(value),

    fresh:
      /\bfresh\b/.test(value),

    wholeBean:
      /\bwhole[\s-]?bean\b/.test(
        value
      ),

    ground:
      /\bground\b/.test(value),

    lean8515:
      /\b85\s*[/\-]\s*15\b|\b85%\b/.test(
        value
      )
  };
}


/*
 * =====================================================
 * PRODUCT MATCH SCORE
 *
 * This answers:
 *
 * "Is this actually the product the shopper asked for?"
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
      request.description
    );

  const offerText =
    cleanText(
      `${offer.title || ""} ${
        offer.brand || ""
      }`
    );

  const requestedAttributes =
    Object.keys(
      request.attributes || {}
    ).length
      ? request.attributes
      : detectAttributes(
          requestedText
        );

  const offerAttributes =
    offer.attributes ||
    detectAttributes(
      offerText
    );


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
    requestedAttributes.wholeBean
  ) {
    score +=
      offerAttributes.wholeBean
        ? 10
        : -25;
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
   * Compare meaningful words in
   * shopper request with retailer title.
   */

  const stopWords =
    new Set([
      "the",
      "and",
      "with",
      "for",
      "of",
      "a",
      "an",
      "organic",
      "fresh",
      "frozen"
    ]);


  const words =
    [
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
          offerText.includes(word)
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
      `${title || ""} ${
        description || ""
      } ${
        brand || ""
      }`
    );


  const unitPrice =
    packageInfo
      .normalizedQuantity > 0

      ? numericPrice /
        packageInfo
          .normalizedQuantity

      : null;


  return {
    retailer,

    title,

    brand,

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
        "weight"

          ? round(
              unitPrice * 16,
              4
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
 * Example:
 *
 * Shopper needs:
 * 1 lb = 16 oz
 *
 * Retailer package:
 * 12 oz
 *
 * Required purchase:
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
   * We NEVER convert count to weight
   * unless reliable retailer data tells
   * us the actual weight.
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
      request.normalizedQuantity
    );

  const packageQty =
    Number(
      offer.package
        .normalizedQuantity
    );


  if (
    !Number.isFinite(requested) ||
    !Number.isFinite(packageQty) ||
    packageQty <= 0
  ) {
    return null;
  }


  const packagesNeeded =
    Math.ceil(
      requested /
      packageQty
    );


  const suppliedQuantity =
    packagesNeeded *
    packageQty;


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
        suppliedQuantity -
        requested
      ),

    totalCost:
      round(
        packagesNeeded *
        offer.price.total,
        2
      )
  };
}


module.exports = {
  cleanText,
  normalizeUnit,
  getUnitType,
  weightToOunces,
  liquidToFluidOunces,
  parsePackageSize,
  normalizeRequest,
  detectAttributes,
  scoreProductMatch,
  normalizeOffer,
  calculatePackageRequirement
};
