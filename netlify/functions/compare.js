const fs = require("fs");
const path = require("path");

const KROGER_BASE = "https://api.kroger.com/v1";
const TARGET_ZIP = "37922";
const TARGET_ADDRESS = "9225 KINGSTON PIKE";

let tokenCache = {
  token: null,
  expiresAt: 0
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function parseRequest(text) {
  const raw = (text || "").trim();
  const lower = raw.toLowerCase();

  let qty = 1;
  let unit = "each";

  const lbMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/
  );

  if (lbMatch) {
    qty = Number(lbMatch[1]);
    unit = "lb";
  } else {
    const leading = lower.match(/^\s*(\d+(?:\.\d+)?)\b/);
    if (leading) qty = Number(leading[1]);
  }

  let canonical = null;
  let krogerTerm = raw;

  if (
    lower.includes("ground beef") &&
    lower.includes("organic") &&
    lower.includes("grass") &&
    (lower.includes("85/15") || lower.includes("85 15"))
  ) {
    canonical = "ground-beef-organic-grassfed-85-15";
    unit = "lb";
    krogerTerm = "organic grass fed 85/15 ground beef";
  } else if (
    lower.includes("broccoli") &&
    lower.includes("organic")
  ) {
    canonical = "organic-broccoli";
    krogerTerm = "organic broccoli";
  } else if (
    lower.includes("cucumber") &&
    lower.includes("organic")
  ) {
    canonical = "organic-cucumber";
    krogerTerm = "organic cucumber";
  } else if (
    lower.includes("baby carrot") &&
    lower.includes("organic")
  ) {
    canonical = "organic-baby-carrots";
    unit = "lb";
    krogerTerm = "organic baby carrots";
  } else if (lower.includes("mango")) {
    canonical = "mango";
    krogerTerm = "mango";
  }

  return {
    raw,
    qty,
    unit,
    canonical,
    krogerTerm
  };
}

function loadSeedData() {
  const dataPath = path.join(
    process.cwd(),
    "data",
    "seed-prices.json"
  );

  return JSON.parse(
    fs.readFileSync(dataPath, "utf8")
  );
}

async function getKrogerToken() {
  const now = Date.now();

  if (
    tokenCache.token &&
    now < tokenCache.expiresAt
  ) {
    return tokenCache.token;
  }

  const clientId =
    process.env.KROGER_CLIENT_ID;

  const clientSecret =
    process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Kroger environment variables are missing in Netlify."
    );
  }

  const basic = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(
    `${KROGER_BASE}/connect/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "product.compact"
      }).toString()
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kroger OAuth failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  const data = JSON.parse(text);

  tokenCache.token = data.access_token;

  tokenCache.expiresAt =
    now +
    Math.max(
      60,
      Number(data.expires_in || 1800) - 60
    ) *
      1000;

  return tokenCache.token;
}

async function krogerFetch(url) {
  const token = await getKrogerToken();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kroger API failed (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  return JSON.parse(text);
}

async function findTargetKroger() {
  const params = new URLSearchParams({
    "filter.zipCode.near": TARGET_ZIP,
    "filter.radiusInMiles": "10",
    "filter.limit": "20",
    "filter.chain": "Kroger"
  });

  const payload = await krogerFetch(
    `${KROGER_BASE}/locations?${params.toString()}`
  );

  const stores = payload.data || [];

  if (!stores.length) {
    throw new Error(
      `No Kroger locations returned near ${TARGET_ZIP}.`
    );
  }

  const exact = stores.find((store) => {
    const address = [
      store.address?.addressLine1,
      store.address?.city,
      store.address?.state,
      store.address?.zipCode
    ]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();

    return address.includes(TARGET_ADDRESS);
  });

  const cedarBluff = stores.find((store) => {
    const text = `${store.name || ""} ${
      store.address?.addressLine1 || ""
    }`.toUpperCase();

    return (
      text.includes("CEDAR") ||
      text.includes("KINGSTON")
    );
  });

  return exact || cedarBluff || stores[0];
}

function extractPrice(item) {
  const price = item?.price || {};

  const promo = Number(price.promo);
  const regular = Number(price.regular);

  if (
    Number.isFinite(promo) &&
    promo > 0
  ) {
    return {
      amount: promo,
      type: "promo",
      regular: regular || null
    };
  }

  if (
    Number.isFinite(regular) &&
    regular > 0
  ) {
    return {
      amount: regular,
      type: "regular",
      regular
    };
  }

  return null;
}

function productText(product, item) {
  return [
    product?.description,
    product?.brand,
    product?.categories?.join(" "),
    item?.size
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreProduct(
  product,
  item,
  canonical
) {
  const text = productText(
    product,
    item
  );

  let score = 0;

  if (
    canonical ===
    "ground-beef-organic-grassfed-85-15"
  ) {
    if (text.includes("ground beef"))
      score += 8;

    if (text.includes("organic"))
      score += 6;

    if (text.includes("grass"))
      score += 5;

    if (
      text.includes("85/15") ||
      text.includes("85 15") ||
      text.includes("85%")
    ) {
      score += 7;
    }

    if (
      text.includes("80/20") ||
      text.includes("90/10")
    ) {
      score -= 8;
    }
  } else if (
    canonical === "organic-broccoli"
  ) {
    if (text.includes("broccoli"))
      score += 8;

    if (text.includes("organic"))
      score += 6;
  } else if (
    canonical === "organic-cucumber"
  ) {
    if (text.includes("cucumber"))
      score += 8;

    if (text.includes("organic"))
      score += 6;
  } else if (
    canonical ===
    "organic-baby-carrots"
  ) {
    if (text.includes("baby"))
      score += 4;

    if (text.includes("carrot"))
      score += 8;

    if (text.includes("organic"))
      score += 6;
  } else if (canonical === "mango") {
    if (text.includes("mango"))
      score += 8;
  }

  return score;
}

function inferPackageQty(
  sizeText,
  requestedUnit
) {
  const size = String(
    sizeText || ""
  ).toLowerCase();

  if (requestedUnit === "lb") {
    let m = size.match(
      /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/
    );

    if (m) {
      return Number(m[1]);
    }

    m = size.match(
      /(\d+(?:\.\d+)?)\s*oz\b/
    );

    if (m) {
      return Number(m[1]) / 16;
    }

    m = size.match(
      /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs)\b/
    );

    if (m) {
      return (
        Number(m[1]) *
        Number(m[2])
      );
    }
  }

  return 1;
}

async function searchLiveKroger(
  parsed,
  productSeed
) {
  const store =
    await findTargetKroger();

  const params = new URLSearchParams({
    "filter.term": parsed.krogerTerm,
    "filter.locationId":
      store.locationId,
    "filter.limit": "20"
  });

  const payload = await krogerFetch(
    `${KROGER_BASE}/products?${params.toString()}`
  );

  const products = payload.data || [];
  const candidates = [];

  for (const product of products) {
    const items = Array.isArray(
      product.items
    )
      ? product.items
      : [];

    for (const item of items) {
      const priceInfo =
        extractPrice(item);

      if (!priceInfo) continue;

      const score = scoreProduct(
        product,
        item,
        parsed.canonical
      );

      if (score <= 0) continue;

      candidates.push({
        retailer: "Kroger",
        product:
          product.description ||
          "Kroger product",

        brand:
          product.brand || null,

        productId:
          product.productId ||
          product.upc ||
          null,

        package_qty:
          inferPackageQty(
            item.size,
            productSeed.unit
          ),

        package_unit:
          productSeed.unit,

        size:
          item.size || null,

        price:
          priceInfo.amount,

        regularPrice:
          priceInfo.regular,

        priceType:
          priceInfo.type,

        match:
          score >= 18
            ? "exact"
            : score >= 10
            ? "strong"
            : "possible",

        score,

        source_type:
          "kroger-live-api",

        locationId:
          store.locationId,

        locationName:
          store.name || "Kroger",

        address:
          store.address || null,

        aisleLocations:
          item.aisleLocations || []
      });
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.price - b.price
  );

  const bestScore =
    candidates[0]?.score ?? 0;

  return {
    store,
    offers: candidates
      .filter(
        (c) =>
          c.score >=
          Math.max(
            8,
            bestScore - 5
          )
      )
      .slice(0, 8)
  };
}

function bestPackageCombo(
  offers,
  requestedQty
) {
  if (!offers.length) return null;

  const maxPackage = Math.max(
    ...offers.map((o) =>
      Number(o.package_qty || 1)
    )
  );

  const scale = 100;
  const target = Math.ceil(
    requestedQty * scale
  );

  const max = Math.ceil(
    (requestedQty +
      maxPackage * 3 +
      5) *
      scale
  );

  const dp = Array(max + 1).fill(
    null
  );

  dp[0] = {
    cost: 0,
    picks: []
  };

  for (let i = 0; i <= max; i++) {
    if (!dp[i]) continue;

    for (const offer of offers) {
      const step = Math.max(
        1,
        Math.round(
          Number(
            offer.package_qty || 1
          ) * scale
        )
      );

      const ni = i + step;

      if (ni > max) continue;

      const nextCost =
        dp[i].cost +
        Number(offer.price);

      if (
        !dp[ni] ||
        nextCost < dp[ni].cost
      ) {
        dp[ni] = {
          cost: nextCost,
          picks: [
            ...dp[i].picks,
            offer
          ]
        };
      }
    }
  }

  let best = null;

  for (
    let i = target;
    i <= max;
    i++
  ) {
    if (!dp[i]) continue;

    const candidate = {
      totalQty: i / scale,
      cost: dp[i].cost,
      picks: dp[i].picks
    };

    if (
      !best ||
      candidate.cost < best.cost ||
      (candidate.cost ===
        best.cost &&
        candidate.totalQty <
          best.totalQty)
    ) {
      best = candidate;
    }
  }

  return best;
}

function buildRetailerResult(
  retailer,
  offers,
  requestedQty,
  unit,
  dataMode
) {
  const best = bestPackageCombo(
    offers,
    requestedQty
  );

  if (!best) return null;

  return {
    retailer,
    requestedQty,
    requestedUnit: unit,

    totalQty: Number(
      best.totalQty.toFixed(2)
    ),

    estimatedCost: Number(
      best.cost.toFixed(2)
    ),

    match: best.picks.every(
      (p) => p.match === "exact"
    )
      ? "exact"
      : best.picks.some(
          (p) =>
            p.match === "possible"
        )
      ? "possible"
      : "estimated",

    dataMode,

    packages: best.picks.map(
      (p) => ({
        product: p.product,
        brand: p.brand || null,

        packageQty: Number(
          p.package_qty || 1
        ),

        packageUnit:
          p.package_unit,

        size:
          p.size || null,

        price:
          Number(p.price),

        regularPrice:
          p.regularPrice || null,

        priceType:
          p.priceType || null,

        sourceType:
          p.source_type,

        productId:
          p.productId || null
      })
    )
  };
}

exports.handler = async function (
  event
) {
  try {
    const text =
      event.queryStringParameters?.q ||
      "";

    const parsed =
      parseRequest(text);

    if (!parsed.canonical) {
      return json(200, {
        ok: false,
        parsed,

        message:
          "Prototype currently recognizes: organic grass-fed 85/15 ground beef, organic broccoli, organic cucumber, organic baby carrots, and mango."
      });
    }

    const seed =
      loadSeedData();

    const product =
      seed.products.find(
        (p) =>
          p.canonical_id ===
          parsed.canonical
      );

    const results = [];

    let krogerStatus = {
      live: false,
      message:
        "Kroger live connector was not attempted."
    };

    /*
     * LIVE KROGER
     */
    try {
      const live =
        await searchLiveKroger(
          parsed,
          product
        );

      if (live.offers.length) {
        const result =
          buildRetailerResult(
            "Kroger",
            live.offers,
            parsed.qty,
            product.unit,
            "live"
          );

        if (result) {
          result.location = {
            locationId:
              live.store.locationId,

            name:
              live.store.name ||
              "Kroger",

            address:
              live.store.address ||
              null
          };

          results.push(result);

          krogerStatus = {
            live: true,

            message:
              `Live Kroger API connected to ${
                live.store.name ||
                "Kroger"
              }.`,

            locationId:
              live.store.locationId,

            address:
              live.store.address ||
              null,

            candidateCount:
              live.offers.length
          };
        }
      } else {
        krogerStatus = {
          live: true,

          message:
            "Kroger API connected, but no sufficiently relevant priced product was returned."
        };
      }
    } catch (error) {
      krogerStatus = {
        live: false,
        message: error.message
      };
    }

    /*
     * SEED DATA FOR
     * ALDI / SPROUTS /
     * EARTH FARE
     */
    const grouped = {};

    for (
      const offer of product.offers
    ) {
      if (
        offer.retailer === "Kroger"
      ) {
        continue;
      }

      if (
        offer.package_unit !==
        product.unit
      ) {
        continue;
      }

      grouped[offer.retailer] ??=
        [];

      grouped[offer.retailer].push(
        offer
      );
    }

    for (
      const [retailer, offers] of
      Object.entries(grouped)
    ) {
      const result =
        buildRetailerResult(
          retailer,
          offers,
          parsed.qty,
          product.unit,
          "prototype-seed"
        );

      if (result) {
        results.push(result);
      }
    }

    results.sort(
      (a, b) =>
        a.estimatedCost -
        b.estimatedCost
    );

    return json(200, {
      ok: true,
      parsed,

      product:
        product.name,

      market:
        "Knoxville, TN",

      disclaimer:
        "Kroger uses live API data when available. Other retailers are still prototype seed data and should not be relied on as current shelf prices.",

      connectors: {
        kroger: krogerStatus,

        aldi: {
          live: false,
          mode: "prototype-seed"
        },

        sprouts: {
          live: false,
          mode: "prototype-seed"
        },

        earthFare: {
          live: false,
          mode: "prototype-seed"
        }
      },

      results,

      winner:
        results[0] || null
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: err.message
    });
  }
};
