const fs = require("fs");
const path = require("path");

function parseRequest(text) {
  const raw = (text || "").trim();
  const lower = raw.toLowerCase();

  let qty = 1;
  let unit = "each";

  const lbMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/);
  if (lbMatch) {
    qty = Number(lbMatch[1]);
    unit = "lb";
  } else {
    const leading = lower.match(/^\s*(\d+(?:\.\d+)?)\b/);
    if (leading) qty = Number(leading[1]);
  }

  let canonical = null;
  if (lower.includes("ground beef") && lower.includes("organic") && lower.includes("grass") && (lower.includes("85/15") || lower.includes("85 15"))) {
    canonical = "ground-beef-organic-grassfed-85-15";
    unit = "lb";
  } else if (lower.includes("broccoli") && lower.includes("organic")) {
    canonical = "organic-broccoli";
  } else if (lower.includes("cucumber") && lower.includes("organic")) {
    canonical = "organic-cucumber";
  } else if (lower.includes("baby carrot") && lower.includes("organic")) {
    canonical = "organic-baby-carrots";
    unit = "lb";
  } else if (lower.includes("mango")) {
    canonical = "mango";
  }

  return { raw, qty, unit, canonical };
}

function bestPackageCombo(offers, requestedQty) {
  // Integer package optimizer for same-unit packages.
  const maxQty = Math.max(requestedQty, ...offers.map(o => o.package_qty || 1));
  const scale = 100; // supports 0.01-unit quantities if needed
  const target = Math.ceil(requestedQty * scale);
  const max = Math.ceil((maxQty + requestedQty + 5) * scale);

  const dp = Array(max + 1).fill(null);
  dp[0] = { cost: 0, picks: [] };

  for (let i = 0; i <= max; i++) {
    if (!dp[i]) continue;
    for (const offer of offers) {
      const step = Math.round((offer.package_qty || 1) * scale);
      const ni = i + step;
      if (ni > max) continue;
      const nextCost = dp[i].cost + offer.price;
      if (!dp[ni] || nextCost < dp[ni].cost) {
        dp[ni] = { cost: nextCost, picks: [...dp[i].picks, offer] };
      }
    }
  }

  let best = null;
  for (let i = target; i <= max; i++) {
    if (!dp[i]) continue;
    const candidate = {
      totalQty: i / scale,
      cost: dp[i].cost,
      picks: dp[i].picks
    };
    if (!best || candidate.cost < best.cost || (candidate.cost === best.cost && candidate.totalQty < best.totalQty)) {
      best = candidate;
    }
  }
  return best;
}

exports.handler = async function(event) {
  try {
    const text = event.queryStringParameters?.q || "";
    const parsed = parseRequest(text);

    if (!parsed.canonical) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          parsed,
          message: "Prototype currently recognizes: organic grass-fed 85/15 ground beef, organic broccoli, organic cucumber, organic baby carrots, and mango."
        })
      };
    }

    const dataPath = path.join(process.cwd(), "data", "seed-prices.json");
    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    const product = data.products.find(p => p.canonical_id === parsed.canonical);

    const grouped = {};
    for (const offer of product.offers) {
      if (offer.package_unit !== product.unit) continue;
      grouped[offer.retailer] ??= [];
      grouped[offer.retailer].push(offer);
    }

    const results = Object.entries(grouped).map(([retailer, offers]) => {
      const best = bestPackageCombo(offers, parsed.qty);
      return {
        retailer,
        requestedQty: parsed.qty,
        requestedUnit: product.unit,
        totalQty: best.totalQty,
        estimatedCost: Number(best.cost.toFixed(2)),
        match: best.picks.every(p => p.match === "exact") ? "exact" : "estimated",
        packages: best.picks.map(p => ({
          product: p.product,
          packageQty: p.package_qty,
          packageUnit: p.package_unit,
          price: p.price,
          sourceType: p.source_type
        }))
      };
    }).sort((a, b) => a.estimatedCost - b.estimatedCost);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        parsed,
        product: product.name,
        market: data.meta.market,
        disclaimer: data.meta.note,
        results,
        winner: results[0] || null
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
};
