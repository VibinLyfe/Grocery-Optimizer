/*
 * evidence-refresh.js
 *
 * Shared evidence ingestion / refresh helper for retailers
 * like Earth Fare and Sprouts.
 *
 * This file does NOT scrape websites and does NOT perform
 * web searches.
 *
 * Its job is to accept candidate public evidence discovered
 * elsewhere, validate it, normalize it, de-duplicate it, and
 * decide whether it is strong enough to be written into a
 * retailer evidence file.
 */

const {
  cleanText,
  calculateAgeDays,
  getFreshnessStatus
} = require("./evidence-retailer");


const DEFAULT_MAX_PRICE_AGE_DAYS = 14;

const DEFAULT_STRONG_SOURCE_TYPES = [
  "retailer-product-page",
  "retailer-weekly-ad",
  "retailer-daily-deal",
  "public-product-record",
  "public-indexed-product-page"
];


/*
 * =====================================================
 * BASIC HELPERS
 * =====================================================
 */

function safeNumber(value) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function safeString(value) {
  return String(
    value || ""
  ).trim();
}


function slugify(value) {
  return cleanText(value)
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}


function clampScore(value) {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        Number(value) || 0
      )
    )
  );
}


function parseDate(value) {
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

  return date;
}


function normalizeObservedAt(value) {
  const date =
    parseDate(value);

  if (!date) {
    return null;
  }

  return date
    .toISOString()
    .slice(
      0,
      10
    );
}


/*
 * =====================================================
 * CANONICAL ID
 *
 * Existing canonicalId wins.
 * Otherwise build one from the product label.
 * =====================================================
 */

function resolveCanonicalId(
  record
) {
  if (
    safeString(
      record?.canonicalId
    )
  ) {
    return safeString(
      record.canonicalId
    );
  }

  const source =
    record?.queryName ||
    record?.title ||
    record?.product ||
    record?.description ||
    "";

  const slug =
    slugify(source);

  return slug
    ? `custom-${slug}`
    : null;
}


/*
 * =====================================================
 * RECORD NORMALIZATION
 * =====================================================
 */

function normalizeEvidenceCandidate(
  record,
  config = {}
) {
  if (!record) {
    return null;
  }

  const retailer =
    safeString(
      record.retailer ||
      config.retailer
    );

  const title =
    safeString(
      record.title ||
      record.product ||
      record.description
    );

  const price =
    safeNumber(
      record.price
    );

  const size =
    safeString(
      record.size ||
      record.packageSize
    );

  const canonicalId =
    resolveCanonicalId(
      record
    );

  if (
    !retailer ||
    !title ||
    !canonicalId ||
    price === null ||
    price <= 0
  ) {
    return null;
  }

  return {
    canonicalId,

    retailer,

    title,

    brand:
      safeString(
        record.brand
      ) || null,

    description:
      safeString(
        record.description
      ) ||
      title,

    size:
      size || null,

    price,

    productId:
      safeString(
        record.productId ||
        record.upc
      ) || null,

    market:
      safeString(
        record.market ||
        config.market
      ) || null,

    locationConfirmed:
      Boolean(
        record.locationConfirmed
      ),

    marketConfirmed:
      Boolean(
        record.marketConfirmed
      ),

    sourceType:
      safeString(
        record.sourceType
      ) ||
      "public-indexed-product-page",

    sourceUrl:
      safeString(
        record.sourceUrl
      ) || null,

    observedAt:
      normalizeObservedAt(
        record.observedAt
      ),

    attributes:
      record.attributes &&
      typeof record.attributes ===
        "object"
        ? record.attributes
        : undefined
  };
}


/*
 * =====================================================
 * QUALITY SCORING
 * =====================================================
 */

function scoreEvidenceCandidate(
  record,
  config = {}
) {
  let score = 0;

  if (
    cleanText(
      record.retailer
    ) ===
    cleanText(
      config.retailer ||
      record.retailer
    )
  ) {
    score += 20;
  }

  if (
    safeNumber(
      record.price
    ) > 0
  ) {
    score += 20;
  }

  if (
    safeString(
      record.size
    )
  ) {
    score += 15;
  }

  if (
    record.locationConfirmed ===
    true
  ) {
    score += 20;

  } else if (
    record.marketConfirmed ===
    true
  ) {
    score += 10;
  }

  const strongSourceTypes =
    Array.isArray(
      config.strongSourceTypes
    )
      ? config.strongSourceTypes
      : DEFAULT_STRONG_SOURCE_TYPES;

  if (
    strongSourceTypes.includes(
      record.sourceType
    )
  ) {
    score += 10;
  }

  if (
    safeString(
      record.sourceUrl
    )
  ) {
    score += 5;
  }

  const freshness =
    getFreshnessStatus(
      record.observedAt
    );

  if (
    freshness.freshness ===
    "current"
  ) {
    score += 10;

  } else if (
    freshness.freshness ===
    "aging"
  ) {
    score += 5;
  }

  return clampScore(
    score
  );
}


/*
 * =====================================================
 * VALIDATION
 * =====================================================
 */

function validateEvidenceCandidate(
  rawRecord,
  config = {}
) {
  const record =
    normalizeEvidenceCandidate(
      rawRecord,
      config
    );

  if (!record) {
    return {
      accepted: false,
      reason:
        "normalization-failed",
      record: null,
      qualityScore: 0
    };
  }

  if (
    config.retailer &&
    cleanText(
      record.retailer
    ) !==
    cleanText(
      config.retailer
    )
  ) {
    return {
      accepted: false,
      reason:
        "retailer-mismatch",
      record,
      qualityScore: 0
    };
  }

  const qualityScore =
    scoreEvidenceCandidate(
      record,
      config
    );

  const minimumQualityScore =
    Number.isFinite(
      Number(
        config.minimumQualityScore
      )
    )
      ? Number(
          config.minimumQualityScore
        )
      : 55;

  if (
    qualityScore <
    minimumQualityScore
  ) {
    return {
      accepted: false,
      reason:
        "quality-score-too-low",
      record,
      qualityScore
    };
  }

  const maxAgeDays =
    Number.isFinite(
      Number(
        config.maxAgeDays
      )
    )
      ? Number(
          config.maxAgeDays
        )
      : DEFAULT_MAX_PRICE_AGE_DAYS;

  const ageDays =
    calculateAgeDays(
      record.observedAt
    );

  if (
    ageDays !== null &&
    ageDays >
      maxAgeDays
  ) {
    return {
      accepted: false,
      reason:
        "evidence-too-old",
      record,
      qualityScore,
      ageDays
    };
  }

  return {
    accepted: true,
    reason: null,
    record,
    qualityScore,
    ageDays
  };
}


/*
 * =====================================================
 * DUPLICATE IDENTITY
 *
 * Prefer productId.
 * Otherwise fall back to canonicalId + title + size.
 * =====================================================
 */

function buildEvidenceIdentity(
  record
) {
  if (
    safeString(
      record.productId
    )
  ) {
    return [
      cleanText(
        record.retailer
      ),
      "product",
      safeString(
        record.productId
      )
    ].join("|");
  }

  return [
    cleanText(
      record.retailer
    ),
    record.canonicalId,
    cleanText(
      record.title
    ),
    cleanText(
      record.size
    )
  ].join("|");
}


/*
 * =====================================================
 * CHOOSE BETTER DUPLICATE
 *
 * Preference:
 * 1. exact location confirmation
 * 2. market confirmation
 * 3. newer evidence
 * 4. higher quality
 * =====================================================
 */

function choosePreferredRecord(
  left,
  right,
  config = {}
) {
  if (
    Boolean(
      right.locationConfirmed
    ) !==
    Boolean(
      left.locationConfirmed
    )
  ) {
    return right.locationConfirmed
      ? right
      : left;
  }

  if (
    Boolean(
      right.marketConfirmed
    ) !==
    Boolean(
      left.marketConfirmed
    )
  ) {
    return right.marketConfirmed
      ? right
      : left;
  }

  const leftDate =
    parseDate(
      left.observedAt
    );

  const rightDate =
    parseDate(
      right.observedAt
    );

  if (
    leftDate &&
    rightDate &&
    leftDate.getTime() !==
      rightDate.getTime()
  ) {
    return (
      rightDate.getTime() >
      leftDate.getTime()
    )
      ? right
      : left;
  }

  if (
    rightDate &&
    !leftDate
  ) {
    return right;
  }

  if (
    leftDate &&
    !rightDate
  ) {
    return left;
  }

  const leftScore =
    scoreEvidenceCandidate(
      left,
      config
    );

  const rightScore =
    scoreEvidenceCandidate(
      right,
      config
    );

  return rightScore >
    leftScore
      ? right
      : left;
}


/*
 * =====================================================
 * MERGE EXISTING + DISCOVERED
 * =====================================================
 */

function mergeEvidenceRecords({
  existingRecords,
  discoveredRecords,
  config = {}
}) {
  const map =
    new Map();

  const acceptedNew = [];
  const rejectedNew = [];

  const existing =
    Array.isArray(
      existingRecords
    )
      ? existingRecords
      : [];

  const discovered =
    Array.isArray(
      discoveredRecords
    )
      ? discoveredRecords
      : [];


  /*
   * Load existing evidence first.
   */

  for (
    const raw of
    existing
  ) {
    const normalized =
      normalizeEvidenceCandidate(
        raw,
        config
      );

    if (!normalized) {
      continue;
    }

    map.set(
      buildEvidenceIdentity(
        normalized
      ),
      normalized
    );
  }


  /*
   * Validate and merge new evidence.
   */

  for (
    const raw of
    discovered
  ) {
    const validation =
      validateEvidenceCandidate(
        raw,
        config
      );

    if (
      !validation.accepted
    ) {
      rejectedNew.push({
        title:
          raw?.title ||
          raw?.product ||
          null,

        sourceUrl:
          raw?.sourceUrl ||
          null,

        reason:
          validation.reason,

        qualityScore:
          validation.qualityScore ??
          0
      });

      continue;
    }

    const record =
      validation.record;

    const identity =
      buildEvidenceIdentity(
        record
      );

    if (
      map.has(
        identity
      )
    ) {
      const preferred =
        choosePreferredRecord(
          map.get(identity),
          record,
          config
        );

      map.set(
        identity,
        preferred
      );

    } else {
      map.set(
        identity,
        record
      );
    }

    acceptedNew.push({
      ...record,
      qualityScore:
        validation.qualityScore
    });
  }


  const records =
    Array.from(
      map.values()
    );


  records.sort(
    (a, b) => {
      const canonicalCompare =
        String(
          a.canonicalId ||
          ""
        ).localeCompare(
          String(
            b.canonicalId ||
            ""
          )
        );

      if (
        canonicalCompare !==
        0
      ) {
        return canonicalCompare;
      }

      return String(
        a.title ||
        ""
      ).localeCompare(
        String(
          b.title ||
          ""
        )
      );
    }
  );


  return {
    records,

    acceptedNew,

    rejectedNew,

    summary: {
      existingCount:
        existing.length,

      discoveredCount:
        discovered.length,

      acceptedNewCount:
        acceptedNew.length,

      rejectedNewCount:
        rejectedNew.length,

      finalRecordCount:
        records.length
    }
  };
}


/*
 * =====================================================
 * FIND MISSING PRODUCTS
 *
 * Useful for refresh/discovery jobs.
 * =====================================================
 */

function findMissingProducts({
  products,
  evidenceRecords,
  retailer
}) {
  const catalog =
    Array.isArray(products)
      ? products
      : [];

  const evidence =
    Array.isArray(
      evidenceRecords
    )
      ? evidenceRecords
      : [];

  const covered =
    new Set(
      evidence
        .filter(
          record =>
            !retailer ||
            cleanText(
              record.retailer
            ) ===
            cleanText(
              retailer
            )
        )
        .map(
          record =>
            record.canonicalId
        )
        .filter(Boolean)
    );

  return catalog.filter(
    product =>
      product?.id &&
      !covered.has(
        product.id
      )
  );
}


/*
 * =====================================================
 * REFRESH TARGETS
 *
 * Returns products whose evidence is missing, aging,
 * stale, or unknown.
 * =====================================================
 */

function buildRefreshTargets({
  products,
  evidenceRecords,
  retailer
}) {
  const catalog =
    Array.isArray(products)
      ? products
      : [];

  const evidence =
    Array.isArray(
      evidenceRecords
    )
      ? evidenceRecords
      : [];

  const byCanonical =
    new Map();

  for (
    const record of
    evidence
  ) {
    if (
      retailer &&
      cleanText(
        record.retailer
      ) !==
      cleanText(
        retailer
      )
    ) {
      continue;
    }

    if (
      !record.canonicalId
    ) {
      continue;
    }

    if (
      !byCanonical.has(
        record.canonicalId
      )
    ) {
      byCanonical.set(
        record.canonicalId,
        []
      );
    }

    byCanonical
      .get(
        record.canonicalId
      )
      .push(
        record
      );
  }


  return catalog
    .map(
      product => {
        const records =
          byCanonical.get(
            product.id
          ) ||
          [];

        if (
          !records.length
        ) {
          return {
            product,
            reason:
              "missing-evidence",
            freshness:
              "missing"
          };
        }

        let bestFreshness =
          "unknown";

        const rank = {
          current: 0,
          aging: 1,
          stale: 2,
          unknown: 3
        };

        for (
          const record of
          records
        ) {
          const status =
            getFreshnessStatus(
              record.observedAt
            );

          if (
            rank[
              status.freshness
            ] <
            rank[
              bestFreshness
            ]
          ) {
            bestFreshness =
              status.freshness;
          }
        }

        if (
          bestFreshness ===
          "current"
        ) {
          return null;
        }

        return {
          product,
          reason:
            `${bestFreshness}-evidence`,
          freshness:
            bestFreshness
        };
      }
    )
    .filter(Boolean);
}


/*
 * =====================================================
 * BUILD DISCOVERY QUERY
 *
 * This does not execute a search.
 * It simply provides consistent query text for whatever
 * discovery mechanism is used outside this file.
 * =====================================================
 */

function buildDiscoveryQueries({
  product,
  retailer,
  city,
  state
}) {
  if (!product) {
    return [];
  }

  const name =
    product.queryName ||
    product.label ||
    product.id;

  const location =
    [
      city,
      state
    ]
      .filter(Boolean)
      .join(" ");

  return [
    `${retailer} ${name} ${location} price`,
    `"${name}" "${retailer}"`,
    `${retailer} ${name} weekly ad`
  ];
}


/*
 * =====================================================
 * EXPORTS
 * =====================================================
 */

module.exports = {
  DEFAULT_MAX_PRICE_AGE_DAYS,
  DEFAULT_STRONG_SOURCE_TYPES,

  safeNumber,
  safeString,
  slugify,

  resolveCanonicalId,
  normalizeEvidenceCandidate,
  scoreEvidenceCandidate,
  validateEvidenceCandidate,

  buildEvidenceIdentity,
  choosePreferredRecord,

  mergeEvidenceRecords,

  findMissingProducts,
  buildRefreshTargets,
  buildDiscoveryQueries
};
