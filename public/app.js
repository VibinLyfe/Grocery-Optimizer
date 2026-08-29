const form = document.querySelector("#form");
const query = document.querySelector("#query");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");

function money(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(n);
}

function freshnessText(result) {
  if (result.retailer !== "Sprouts") {
    return "";
  }

  if (result.freshness === "stale") {
    return "Price may be outdated";
  }

  if (result.freshness === "aging") {
    if (result.ageDays === 1) {
      return "Updated 1 day ago";
    }

    if (Number.isFinite(result.ageDays)) {
      return `Updated ${result.ageDays} days ago`;
    }

    return "Recently updated";
  }

  if (result.freshness === "current") {
    if (result.ageDays === 0) {
      return "Updated today";
    }

    if (result.ageDays === 1) {
      return "Updated 1 day ago";
    }

    if (Number.isFinite(result.ageDays)) {
      return `Updated ${result.ageDays} days ago`;
    }

    return "Recently updated";
  }

  return "";
}

async function run() {
  const q = query.value.trim();

  if (!q) {
    return;
  }

  statusEl.textContent = "Comparing…";
  resultsEl.innerHTML = "";

  try {
    const res = await fetch(
      `/api/compare?q=${encodeURIComponent(q)}`
    );

    const data = await res.json();

    if (!data.ok) {
      statusEl.textContent =
        data.message ||
        "No match yet.";

      return;
    }

    statusEl.innerHTML = `
      <strong>${data.product}</strong>
      · ${data.parsed.qty} ${data.parsed.unit}
      <br>
      <span class="meta">${data.disclaimer}</span>
    `;

    resultsEl.innerHTML = data.results
      .map((r, i) => {
        const freshness =
          freshnessText(r);

        return `
          <article class="card ${i === 0 ? "winner" : ""}">
            <div class="topline">
              <div class="retailer">${r.retailer}</div>
              <div class="price">${money(r.estimatedCost)}</div>
            </div>

            <div class="meta">
              ${r.totalQty} ${r.requestedUnit} supplied
              ·
              ${r.packages.length} package${r.packages.length === 1 ? "" : "s"}
            </div>

            ${
              freshness
                ? `<div class="meta freshness">${freshness}</div>`
                : ""
            }

            <span class="badge">
              ${
                i === 0
                  ? "Best current option"
                  : r.match + " match"
              }
            </span>

            <ul class="packages">
              ${r.packages
                .map(
                  p => `
                    <li>
                      ${p.product}
                      —
                      ${p.packageQty} ${p.packageUnit}
                      @ ${money(p.price)}
                    </li>
                  `
                )
                .join("")}
            </ul>
          </article>
        `;
      })
      .join("");
  } catch (err) {
    statusEl.textContent =
      "Could not run comparison. If testing locally, start with Netlify Dev.";
  }
}

form.addEventListener(
  "submit",
  e => {
    e.preventDefault();
    run();
  }
);

run();
