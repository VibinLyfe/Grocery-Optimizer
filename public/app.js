/*
 * Grocery Optimizer
 * public/app.js
 *
 * Weekly grocery-list UI + basket optimization
 * + custom products + pricing coverage status.
 *
 * Existing storage preserved:
 *   toomey-grocery-weekly-list-v1
 *   toomey-custom-products-v1
 *
 * Additional storage:
 *   toomey-pricing-status-v1
 */

(() => {
  "use strict";


  /*
   * =====================================================
   * STORAGE
   * =====================================================
   */

  const STORAGE_KEY =
    "toomey-grocery-weekly-list-v1";

  const CUSTOM_PRODUCTS_KEY =
    "toomey-custom-products-v1";

  const PRICING_STATUS_KEY =
    "toomey-pricing-status-v1";


  /*
   * Best Balance intentionally treats each additional
   * store as roughly $5 of inconvenience.
   *
   * This affects plan selection only.
   * Displayed grocery totals remain actual grocery cost.
   */

  const STOP_PENALTY = 5;


  /*
   * =====================================================
   * DOM HELPERS
   *
   * Several alternate IDs are supported so this file
   * remains tolerant of our previous frontend versions.
   * =====================================================
   */

  function firstElement(...selectors) {
    for (const selector of selectors) {
      const element =
        document.querySelector(selector);

      if (element) {
        return element;
      }
    }

    return null;
  }


  const productSelect =
    firstElement(
      "#productSelect",
      "#product",
      "[data-product-select]"
    );

  const quantitySelect =
    firstElement(
      "#quantitySelect",
      "#quantity",
      "[data-quantity-select]"
    );

  const unitSelect =
    firstElement(
      "#unitSelect",
      "#unit",
      "[data-unit-select]"
    );

  const addButton =
    firstElement(
      "#addItem",
      "#addItemBtn",
      "#addButton",
      "[data-add-item]"
    );

  const compareButton =
    firstElement(
      "#compareButton",
      "#compareBtn",
      "#compare",
      "[data-compare]"
    );

  const resetButton =
    firstElement(
      "#resetWeek",
      "#resetWeeklyList",
      "#resetButton",
      "[data-reset-week]"
    );

  const listContainer =
    firstElement(
      "#weeklyList",
      "#groceryList",
      "#listContainer",
      "[data-weekly-list]"
    );

  const resultsContainer =
    firstElement(
      "#results",
      "#comparisonResults",
      "#resultsContainer",
      "[data-results]"
    );

  const statusContainer =
    firstElement(
      "#status",
      "#compareStatus",
      "[data-status]"
    );


  /*
   * Custom-product controls.
   */

  const customToggleButton =
    firstElement(
      "#showCustomProduct",
      "#customProductButton",
      "#addCustomProduct",
      "[data-show-custom-product]"
    );

  const customPanel =
    firstElement(
      "#customProductPanel",
      "#customPanel",
      "[data-custom-product-panel]"
    );

  const customNameInput =
    firstElement(
      "#customProductName",
      "#customName",
      "[data-custom-name]"
    );

  const customCategorySelect =
    firstElement(
      "#customProductCategory",
      "#customCategory",
      "[data-custom-category]"
    );

  const customUnitSelect =
    firstElement(
      "#customProductUnit",
      "#customDefaultUnit",
      "#customUnit",
      "[data-custom-unit]"
    );

  const saveCustomButton =
    firstElement(
      "#saveCustomProduct",
      "#saveCustomButton",
      "[data-save-custom-product]"
    );


  /*
   * =====================================================
   * STATE
   * =====================================================
   */

  let BASE_PRODUCT_LIST = [];
  let customProducts =
    loadJSON(
      CUSTOM_PRODUCTS_KEY,
      []
    );

  let weeklyList =
    loadJSON(
      STORAGE_KEY,
      []
    );

  let pricingStatus =
    loadJSON(
      PRICING_STATUS_KEY,
      {}
    );

  let PRODUCT_LIST = [];
  let PRODUCTS = {};

  let evidenceRefreshData =
    null;

  let compareInProgress =
    false;


  /*
   * =====================================================
   * BASIC HELPERS
   * =====================================================
   */

  function loadJSON(
    key,
    fallback
  ) {
    try {
      const raw =
        localStorage.getItem(
          key
        );

      if (!raw) {
        return fallback;
      }

      const parsed =
        JSON.parse(raw);

      return parsed ?? fallback;

    } catch {
      return fallback;
    }
  }


  function saveJSON(
    key,
    value
  ) {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  }


  function escapeHtml(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
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


  function slugify(
    value
  ) {
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


  function money(
    value
  ) {
    const number =
      Number(value);

    if (
      !Number.isFinite(number)
    ) {
      return "—";
    }

    return number
      .toLocaleString(
        "en-US",
        {
          style:
            "currency",

          currency:
            "USD"
        }
      );
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


  function unique(
    values
  ) {
    return [
      ...new Set(
        values.filter(Boolean)
      )
    ];
  }


  function productById(
    id
  ) {
    return PRODUCTS[id] ||
      null;
  }


  function itemProduct(
    item
  ) {
    return (
      productById(
        item.productId
      ) || {
        id:
          item.productId,

        label:
          item.label ||
          item.productId,

        queryName:
          item.queryName ||
          item.label ||
          item.productId,

        category:
          "Custom",

        defaultUnit:
          item.unit ||
          "each",

        allowedUnits: [
          item.unit ||
          "each"
        ],

        custom:
          true
      }
    );
  }


  function persistWeeklyList() {
    saveJSON(
      STORAGE_KEY,
      weeklyList
    );
  }


  function persistCustomProducts() {
    saveJSON(
      CUSTOM_PRODUCTS_KEY,
      customProducts
    );
  }


  function persistPricingStatus() {
    saveJSON(
      PRICING_STATUS_KEY,
      pricingStatus
    );
  }


  /*
   * =====================================================
   * PRODUCT CATALOG
   * =====================================================
   */

  async function loadProducts() {
    try {
      const response =
        await fetch(
          "products.json",
          {
            cache:
              "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          `products.json returned ${response.status}`
        );
      }

      const data =
        await response.json();

      BASE_PRODUCT_LIST =
        Array.isArray(data)
          ? data
          : [];

    } catch (
      error
    ) {
      console.error(
        "Could not load products.json:",
        error
      );

      BASE_PRODUCT_LIST =
        [];
    }

    rebuildProductCatalog();
  }


  function normalizeCatalogProduct(
    product,
    custom = false
  ) {
    const id =
      product.id ||
      (
        custom
          ? `custom-${slugify(
              product.label ||
              product.queryName
            )}`
          : slugify(
              product.label ||
              product.queryName
            )
      );

    const defaultUnit =
      product.defaultUnit ||
      product.unit ||
      "each";

    return {
      ...product,

      id,

      label:
        product.label ||
        titleCase(
          product.queryName ||
          id
        ),

      queryName:
        product.queryName ||
        cleanText(
          product.label ||
          id
        ),

      category:
        product.category ||
        (
          custom
            ? "Custom"
            : "Other"
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
        Boolean(
          custom ||
          product.custom
        )
    };
  }


  function rebuildProductCatalog() {
    const base =
      BASE_PRODUCT_LIST.map(
        product =>
          normalizeCatalogProduct(
            product,
            false
          )
      );

    const custom =
      customProducts.map(
        product =>
          normalizeCatalogProduct(
            product,
            true
          )
      );

    PRODUCT_LIST = [
      ...base,
      ...custom
    ];

    PRODUCTS =
      Object.fromEntries(
        PRODUCT_LIST.map(
          product => [
            product.id,
            product
          ]
        )
      );

    renderProductOptions();
  }


  /*
   * =====================================================
   * PRODUCT DROPDOWN
   * =====================================================
   */

  function renderProductOptions() {
    if (!productSelect) {
      return;
    }

    const current =
      productSelect.value;

    const groups =
      new Map();

    for (
      const product of
      PRODUCT_LIST
    ) {
      const category =
        product.category ||
        "Other";

      if (
        !groups.has(
          category
        )
      ) {
        groups.set(
          category,
          []
        );
      }

      groups
        .get(category)
        .push(product);
    }


    productSelect.innerHTML =
      `<option value="">Choose a product</option>`;


    for (
      const [
        category,
        products
      ] of groups
    ) {
      const optgroup =
        document.createElement(
          "optgroup"
        );

      optgroup.label =
        category;

      for (
        const product of
        products
      ) {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          product.id;

        option.textContent =
          product.custom
            ? `${product.label} • Custom`
            : product.label;

        optgroup.appendChild(
          option
        );
      }

      productSelect.appendChild(
        optgroup
      );
    }


    if (
      current &&
      PRODUCTS[current]
    ) {
      productSelect.value =
        current;
    }

    syncUnitsToSelectedProduct();
  }


  /*
   * =====================================================
   * UNIT DROPDOWN
   * =====================================================
   */

  const UNIT_LABELS = {
    each:
      "each",

    package:
      "package",

    lb:
      "lb",

    oz:
      "oz",

    g:
      "g",

    kg:
      "kg",

    "fl oz":
      "fl oz",

    fl_oz:
      "fl oz",

    pint:
      "pint",

    quart:
      "quart",

    gallon:
      "gallon",

    ml:
      "ml",

    liter:
      "liter",

    dozen:
      "dozen",

    can:
      "can",

    jar:
      "jar",

    bottle:
      "bottle",

    loaf:
      "loaf",

    bag:
      "bag",

    roll:
      "roll"
  };


  function unitLabel(
    unit
  ) {
    return (
      UNIT_LABELS[unit] ||
      unit
    );
  }


  function syncUnitsToSelectedProduct() {
    if (
      !productSelect ||
      !unitSelect
    ) {
      return;
    }

    const product =
      PRODUCTS[
        productSelect.value
      ];

    if (!product) {
      return;
    }

    const allowedUnits =
      unique(
        product.allowedUnits ||
        [
          product.defaultUnit
        ]
      );

    const previous =
      unitSelect.value;

    unitSelect.innerHTML =
      "";

    for (
      const unit of
      allowedUnits
    ) {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        unit;

      option.textContent =
        unitLabel(unit);

      unitSelect.appendChild(
        option
      );
    }

    if (
      allowedUnits.includes(
        previous
      )
    ) {
      unitSelect.value =
        previous;

    } else {
      unitSelect.value =
        product.defaultUnit ||
        allowedUnits[0];
    }
  }


  /*
   * =====================================================
   * QUANTITY
   * =====================================================
   */

  function selectedQuantity() {
    if (!quantitySelect) {
      return 1;
    }

    const value =
      Number(
        quantitySelect.value
      );

    return (
      Number.isFinite(value) &&
      value > 0
    )
      ? value
      : 1;
  }


  /*
   * =====================================================
   * PRICING STATUS
   * =====================================================
   */

  const STATUS = {
    AVAILABLE:
      "available",

    PARTIAL:
      "partial",

    RESEARCH:
      "research",

    CHECKING:
      "checking",

    UNKNOWN:
      "unknown"
  };


  function statusLabel(
    status
  ) {
    switch (status) {
      case STATUS.AVAILABLE:
        return "Pricing available";

      case STATUS.PARTIAL:
        return "Partial pricing";

      case STATUS.RESEARCH:
        return "Research needed";

      case STATUS.CHECKING:
        return "Checking pricing…";

      default:
        return "Pricing not checked";
    }
  }


  function statusClass(
    status
  ) {
    switch (status) {
      case STATUS.AVAILABLE:
        return "pricing-status pricing-available";

      case STATUS.PARTIAL:
        return "pricing-status pricing-partial";

      case STATUS.RESEARCH:
        return "pricing-status pricing-research";

      case STATUS.CHECKING:
        return "pricing-status pricing-checking";

      default:
        return "pricing-status pricing-unknown";
    }
  }


  function getProductPricingStatus(
    productId
  ) {
    return (
      pricingStatus[
        productId
      ] || {
        status:
          STATUS.UNKNOWN,

        retailerCount:
          0,

        retailers: [],

        checkedAt:
          null
      }
    );
  }


  function setProductPricingStatus(
    productId,
    value
  ) {
    pricingStatus[
      productId
    ] = {
      ...getProductPricingStatus(
        productId
      ),

      ...value
    };

    persistPricingStatus();
  }


  function inferPricingStatusFromComparison(
    data
  ) {
    const results =
      Array.isArray(
        data?.results
      )
        ? data.results
        : [];

    const retailers =
      unique(
        results.map(
          result =>
            result.retailer
        )
      );

    if (
      retailers.length >= 2
    ) {
      return {
        status:
          STATUS.AVAILABLE,

        retailerCount:
          retailers.length,

        retailers
      };
    }

    if (
      retailers.length === 1
    ) {
      return {
        status:
          STATUS.PARTIAL,

        retailerCount:
          1,

        retailers
      };
    }

    return {
      status:
        STATUS.RESEARCH,

      retailerCount:
        0,

      retailers: []
    };
  }


  /*
   * =====================================================
   * REFRESH / DISCOVERY COVERAGE
   *
   * This endpoint reflects repository-backed products.
   * Custom browser-only products are checked through
   * /api/compare instead.
   * =====================================================
   */

  async function loadEvidenceRefreshStatus() {
    try {
      const response =
        await fetch(
          "/api/evidence-refresh",
          {
            cache:
              "no-store"
          }
        );

      if (!response.ok) {
        return;
      }

      const data =
        await response.json();

      if (!data?.ok) {
        return;
      }

      evidenceRefreshData =
        data;

      applyEvidenceCoverageToCatalog();

    } catch (
      error
    ) {
      console.warn(
        "Evidence refresh status unavailable:",
        error
      );
    }
  }


  function targetIds(
    retailerKey
  ) {
    const targets =
      evidenceRefreshData
        ?.retailers
        ?.[retailerKey]
        ?.targets;

    return new Set(
      (
        Array.isArray(
          targets
        )
          ? targets
          : []
      )
        .map(
          target =>
            target.id
        )
        .filter(Boolean)
    );
  }


  function applyEvidenceCoverageToCatalog() {
    if (!evidenceRefreshData) {
      return;
    }

    const earthFareNeedsResearch =
      targetIds(
        "earthFare"
      );

    const sproutsNeedsResearch =
      targetIds(
        "sprouts"
      );


    for (
      const product of
      BASE_PRODUCT_LIST
    ) {
      const id =
        product.id;

      if (!id) {
        continue;
      }

      const earthFareCovered =
        !earthFareNeedsResearch
          .has(id);

      const sproutsCovered =
        !sproutsNeedsResearch
          .has(id);


      /*
       * Do not downgrade a stronger status already
       * learned from an actual /api/compare response.
       */

      const existing =
        getProductPricingStatus(
          id
        );

      if (
        existing.checkedAt &&
        existing.source ===
          "compare"
      ) {
        continue;
      }


      if (
        earthFareCovered &&
        sproutsCovered
      ) {
        setProductPricingStatus(
          id,
          {
            status:
              STATUS.AVAILABLE,

            retailerCount:
              2,

            retailers: [
              "Earth Fare",
              "Sprouts"
            ],

            source:
              "evidence-refresh",

            checkedAt:
              new Date()
                .toISOString()
          }
        );

      } else if (
        earthFareCovered ||
        sproutsCovered
      ) {
        const retailers =
          [];

        if (
          earthFareCovered
        ) {
          retailers.push(
            "Earth Fare"
          );
        }

        if (
          sproutsCovered
        ) {
          retailers.push(
            "Sprouts"
          );
        }

        setProductPricingStatus(
          id,
          {
            status:
              STATUS.PARTIAL,

            retailerCount:
              retailers.length,

            retailers,

            source:
              "evidence-refresh",

            checkedAt:
              new Date()
                .toISOString()
          }
        );
      }
    }

    renderWeeklyList();
  }


  /*
   * =====================================================
   * CUSTOM PRODUCT
   * =====================================================
   */

  function openCustomPanel() {
    if (!customPanel) {
      return;
    }

    customPanel.hidden =
      false;

    customPanel.classList
      .remove(
        "hidden"
      );

    if (
      customNameInput
    ) {
      setTimeout(
        () =>
          customNameInput
            .focus(),
        0
      );
    }
  }


  function closeCustomPanel() {
    if (!customPanel) {
      return;
    }

    customPanel.hidden =
      true;

    customPanel.classList
      .add(
        "hidden"
      );
  }


  async function saveCustomProduct() {
    const rawName =
      customNameInput
        ?.value
        ?.trim();

    if (!rawName) {
      setStatus(
        "Enter a product name first."
      );

      customNameInput
        ?.focus();

      return;
    }


    const id =
      `custom-${slugify(
        rawName
      )}`;

    const duplicate =
      PRODUCT_LIST.find(
        product =>
          product.id === id ||
          cleanText(
            product.label
          ) ===
          cleanText(
            rawName
          )
      );

    if (duplicate) {
      if (
        productSelect
      ) {
        productSelect.value =
          duplicate.id;

        syncUnitsToSelectedProduct();
      }

      setStatus(
        `${duplicate.label} is already in your product list.`
      );

      closeCustomPanel();

      return;
    }


    const category =
      customCategorySelect
        ?.value ||
      "Custom";

    const defaultUnit =
      customUnitSelect
        ?.value ||
      "each";


    const product = {
      id,

      label:
        titleCase(
          rawName
        ),

      queryName:
        cleanText(
          rawName
        ),

      category,

      defaultUnit,

      allowedUnits: [
        defaultUnit
      ],

      custom:
        true
    };


    customProducts.push(
      product
    );

    persistCustomProducts();

    rebuildProductCatalog();


    if (
      productSelect
    ) {
      productSelect.value =
        product.id;

      syncUnitsToSelectedProduct();
    }


    if (
      customNameInput
    ) {
      customNameInput.value =
        "";
    }

    closeCustomPanel();


    /*
     * Immediately check whether the backend already knows
     * how to price this product.
     */

    setProductPricingStatus(
      product.id,
      {
        status:
          STATUS.CHECKING,

        retailerCount:
          0,

        retailers: [],

        source:
          "compare",

        checkedAt:
          null
      }
    );

    renderWeeklyList();

    setStatus(
      `Saved ${product.label}. Checking pricing coverage…`
    );


    await checkProductPricing(
      product,
      1,
      defaultUnit
    );


    const status =
      getProductPricingStatus(
        product.id
      );

    setStatus(
      `${product.label} saved. ${statusLabel(
        status.status
      )}.`
    );
  }


  /*
   * =====================================================
   * WEEKLY LIST
   * =====================================================
   */

  function createWeeklyItem({
    product,
    quantity,
    unit
  }) {
    return {
      id:
        `${product.id}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,

      productId:
        product.id,

      label:
        product.label,

      queryName:
        product.queryName,

      quantity:
        Number(quantity),

      unit,

      checked:
        false,

      custom:
        Boolean(
          product.custom
        )
    };
  }


  function addSelectedProduct() {
    const product =
      PRODUCTS[
        productSelect
          ?.value
      ];

    if (!product) {
      setStatus(
        "Choose a product first."
      );

      return;
    }

    const quantity =
      selectedQuantity();

    const unit =
      unitSelect
        ?.value ||
      product.defaultUnit ||
      "each";


    /*
     * If the exact same product + unit already exists,
     * increase its quantity instead of creating a second
     * row.
     */

    const existing =
      weeklyList.find(
        item =>
          item.productId ===
            product.id &&
          item.unit === unit &&
          !item.checked
      );


    if (existing) {
      existing.quantity =
        Number(
          existing.quantity
        ) +
        Number(quantity);

    } else {
      weeklyList.push(
        createWeeklyItem({
          product,
          quantity,
          unit
        })
      );
    }


    persistWeeklyList();

    renderWeeklyList();

    setStatus(
      `${product.label} added to your weekly list.`
    );


    /*
     * Custom products may not have been checked yet.
     */

    const pricing =
      getProductPricingStatus(
        product.id
      );

    if (
      product.custom &&
      (
        pricing.status ===
          STATUS.UNKNOWN ||
        pricing.status ===
          STATUS.RESEARCH
      )
    ) {
      checkProductPricing(
        product,
        quantity,
        unit
      );
    }
  }


  function toggleWeeklyItem(
    id
  ) {
    const item =
      weeklyList.find(
        row =>
          row.id === id
      );

    if (!item) {
      return;
    }

    item.checked =
      !item.checked;

    persistWeeklyList();

    renderWeeklyList();
  }


  function removeWeeklyItem(
    id
  ) {
    weeklyList =
      weeklyList.filter(
        item =>
          item.id !== id
      );

    persistWeeklyList();

    renderWeeklyList();
  }


  function resetWeeklyList() {
    weeklyList =
      weeklyList.map(
        item => ({
          ...item,
          checked: false
        })
      );

    persistWeeklyList();

    renderWeeklyList();

    setStatus(
      "Weekly list reset. All items are unchecked."
    );
  }


  function activeWeeklyItems() {
    return weeklyList.filter(
      item =>
        !item.checked
    );
  }


  /*
   * =====================================================
   * WEEKLY LIST RENDER
   * =====================================================
   */

  function renderWeeklyList() {
    if (!listContainer) {
      return;
    }


    if (
      !weeklyList.length
    ) {
      listContainer.innerHTML =
        `
          <div class="empty-state">
            <p>Your weekly grocery list is empty.</p>
            <small>Add the products you buy regularly.</small>
          </div>
        `;

      return;
    }


    listContainer.innerHTML =
      weeklyList
        .map(
          item => {
            const product =
              itemProduct(
                item
              );

            const pricing =
              getProductPricingStatus(
                item.productId
              );

            const checkedClass =
              item.checked
                ? "is-checked"
                : "";

            const retailers =
              pricing.retailers
                ?.length
                ? pricing
                    .retailers
                    .join(", ")
                : "";

            const retailerDetail =
              retailers
                ? `<span class="pricing-retailers">${escapeHtml(
                    retailers
                  )}</span>`
                : "";


            return `
              <div
                class="weekly-item ${checkedClass}"
                data-weekly-item="${escapeHtml(
                  item.id
                )}"
              >
                <label class="weekly-check">
                  <input
                    type="checkbox"
                    data-toggle-item="${escapeHtml(
                      item.id
                    )}"
                    ${
                      item.checked
                        ? "checked"
                        : ""
                    }
                  />

                  <span class="weekly-item-main">
                    <span class="weekly-item-name">
                      ${escapeHtml(
                        product.label
                      )}
                    </span>

                    <span class="weekly-item-quantity">
                      ${escapeHtml(
                        item.quantity
                      )}
                      ${escapeHtml(
                        unitLabel(
                          item.unit
                        )
                      )}
                    </span>

                    <span class="${statusClass(
                      pricing.status
                    )}">
                      ${escapeHtml(
                        statusLabel(
                          pricing.status
                        )
                      )}
                    </span>

                    ${retailerDetail}
                  </span>
                </label>

                <button
                  type="button"
                  class="remove-item"
                  data-remove-item="${escapeHtml(
                    item.id
                  )}"
                  aria-label="Remove ${escapeHtml(
                    product.label
                  )}"
                >
                  ×
                </button>
              </div>
            `;
          }
        )
        .join("");
  }


  /*
   * =====================================================
   * QUERY BUILDING
   * =====================================================
   */

  function buildCompareQuery(
    item
  ) {
    const product =
      itemProduct(
        item
      );

    const quantity =
      Number(
        item.quantity
      ) || 1;

    const unit =
      item.unit ||
      product.defaultUnit ||
      "each";

    return `${quantity} ${unit} ${product.queryName}`;
  }


  /*
   * =====================================================
   * API COMPARE
   * =====================================================
   */

  async function compareItem(
    item
  ) {
    const query =
      buildCompareQuery(
        item
      );

    const response =
      await fetch(
        `/api/compare?q=${encodeURIComponent(
          query
        )}`,
        {
          cache:
            "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `Compare API returned ${response.status}`
      );
    }

    const data =
      await response.json();

    return {
      item,
      query,
      data
    };
  }


  async function checkProductPricing(
    product,
    quantity = 1,
    unit = null
  ) {
    const selectedUnit =
      unit ||
      product.defaultUnit ||
      "each";

    const item = {
      productId:
        product.id,

      label:
        product.label,

      queryName:
        product.queryName,

      quantity,
      unit:
        selectedUnit,

      checked:
        false,

      custom:
        Boolean(
          product.custom
        )
    };


    setProductPricingStatus(
      product.id,
      {
        status:
          STATUS.CHECKING,

        source:
          "compare"
      }
    );

    renderWeeklyList();


    try {
      const result =
        await compareItem(
          item
        );

      const inferred =
        inferPricingStatusFromComparison(
          result.data
        );

      setProductPricingStatus(
        product.id,
        {
          ...inferred,

          source:
            "compare",

          checkedAt:
            new Date()
              .toISOString()
        }
      );

      renderWeeklyList();

      return result.data;

    } catch (
      error
    ) {
      setProductPricingStatus(
        product.id,
        {
          status:
            STATUS.RESEARCH,

          retailerCount:
            0,

          retailers: [],

          source:
            "compare",

          checkedAt:
            new Date()
              .toISOString(),

          error:
            error.message
        }
      );

      renderWeeklyList();

      return null;
    }
  }


  /*
   * =====================================================
   * NORMALIZE COMPARISON RESULTS
   * =====================================================
   */

  function normalizeItemComparison(
    response
  ) {
    const item =
      response.item;

    const data =
      response.data;

    const product =
      itemProduct(
        item
      );

    const results =
      Array.isArray(
        data?.results
      )
        ? data.results
        : [];


    const inferred =
      inferPricingStatusFromComparison(
        data
      );

    setProductPricingStatus(
      item.productId,
      {
        ...inferred,

        source:
          "compare",

        checkedAt:
          new Date()
            .toISOString()
      }
    );


    return {
      itemId:
        item.id,

      productId:
        item.productId,

      label:
        product.label,

      quantity:
        item.quantity,

      unit:
        item.unit,

      results:
        results.map(
          result => ({
            ...result,

            retailer:
              result.retailer,

            cost:
              Number(
                result.estimatedCost
              )
          })
        )
    };
  }


  /*
   * =====================================================
   * LOWEST COST
   * =====================================================
   */

  function buildLowestCostPlan(
    comparisons
  ) {
    const assignments = [];

    let total = 0;


    for (
      const comparison of
      comparisons
    ) {
      const offers =
        comparison.results
          .filter(
            result =>
              Number.isFinite(
                result.cost
              )
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          );


      if (!offers.length) {
        assignments.push({
          comparison,
          result: null
        });

        continue;
      }


      const winner =
        offers[0];

      total +=
        winner.cost;

      assignments.push({
        comparison,
        result:
          winner
      });
    }


    return {
      key:
        "lowest",

      name:
        "Lowest Cost",

      description:
        "Cheapest available retailer for every item.",

      assignments,

      actualTotal:
        round(
          total
        ),

      score:
        round(
          total
        ),

      stores:
        unique(
          assignments
            .map(
              assignment =>
                assignment.result
                  ?.retailer
            )
        )
    };
  }


  /*
   * =====================================================
   * RETAILER SUBSETS
   * =====================================================
   */

  function allRetailers(
    comparisons
  ) {
    return unique(
      comparisons
        .flatMap(
          comparison =>
            comparison.results
              .map(
                result =>
                  result.retailer
              )
        )
    );
  }


  function retailerSubsets(
    retailers
  ) {
    const subsets = [];

    const total =
      2 **
      retailers.length;


    for (
      let mask = 1;
      mask < total;
      mask++
    ) {
      const subset = [];

      for (
        let index = 0;
        index <
        retailers.length;
        index++
      ) {
        if (
          mask &
          (
            1 <<
            index
          )
        ) {
          subset.push(
            retailers[
              index
            ]
          );
        }
      }

      subsets.push(
        subset
      );
    }

    return subsets;
  }


  /*
   * =====================================================
   * PLAN FOR RETAILER SET
   * =====================================================
   */

  function buildPlanForRetailers(
    comparisons,
    retailers
  ) {
    const allowed =
      new Set(
        retailers
      );

    const assignments = [];

    let total = 0;


    for (
      const comparison of
      comparisons
    ) {
      const candidates =
        comparison.results
          .filter(
            result =>
              allowed.has(
                result.retailer
              ) &&
              Number.isFinite(
                result.cost
              )
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          );


      if (!candidates.length) {
        return null;
      }


      const winner =
        candidates[0];

      total +=
        winner.cost;

      assignments.push({
        comparison,
        result:
          winner
      });
    }


    return {
      assignments,

      actualTotal:
        round(
          total
        ),

      stores:
        unique(
          assignments.map(
            assignment =>
              assignment.result
                .retailer
          )
        )
    };
  }


  /*
   * =====================================================
   * BEST BALANCE
   * =====================================================
   */

  function buildBestBalancePlan(
    comparisons
  ) {
    const retailers =
      allRetailers(
        comparisons
      );

    let best = null;


    for (
      const subset of
      retailerSubsets(
        retailers
      )
    ) {
      const plan =
        buildPlanForRetailers(
          comparisons,
          subset
        );

      if (!plan) {
        continue;
      }

      const extraStops =
        Math.max(
          0,
          plan.stores.length -
          1
        );

      const score =
        plan.actualTotal +
        STOP_PENALTY *
          extraStops;


      const candidate = {
        key:
          "balance",

        name:
          "Best Balance",

        description:
          "Balances grocery savings against extra store stops.",

        ...plan,

        score:
          round(
            score
          )
      };


      if (
        !best ||
        candidate.score <
          best.score ||
        (
          candidate.score ===
            best.score &&
          candidate.actualTotal <
            best.actualTotal
        ) ||
        (
          candidate.score ===
            best.score &&
          candidate.actualTotal ===
            best.actualTotal &&
          candidate.stores.length <
            best.stores.length
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
   * ONE STORE
   * =====================================================
   */

  function buildOneStorePlan(
    comparisons
  ) {
    const retailers =
      allRetailers(
        comparisons
      );

    let best = null;


    for (
      const retailer of
      retailers
    ) {
      const assignments = [];

      let coverage = 0;
      let total = 0;


      for (
        const comparison of
        comparisons
      ) {
        const candidate =
          comparison.results
            .filter(
              result =>
                result.retailer ===
                  retailer &&
                Number.isFinite(
                  result.cost
                )
            )
            .sort(
              (a, b) =>
                a.cost -
                b.cost
            )[0] ||
          null;


        if (candidate) {
          coverage += 1;
          total +=
            candidate.cost;
        }


        assignments.push({
          comparison,
          result:
            candidate
        });
      }


      const candidate = {
        key:
          "one-store",

        name:
          "One Store",

        description:
          coverage ===
          comparisons.length
            ? `Everything available at ${retailer}.`
            : `${retailer} covers ${coverage} of ${comparisons.length} items.`,

        assignments,

        coverage,

        actualTotal:
          round(
            total
          ),

        score:
          round(
            total
          ),

        stores: [
          retailer
        ]
      };


      if (
        !best ||
        candidate.coverage >
          best.coverage ||
        (
          candidate.coverage ===
            best.coverage &&
          candidate.actualTotal <
            best.actualTotal
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
   * RESULTS GROUPING
   * =====================================================
   */

  function groupAssignmentsByStore(
    assignments
  ) {
    const groups =
      new Map();

    const unavailable = [];


    for (
      const assignment of
      assignments
    ) {
      if (
        !assignment.result
      ) {
        unavailable.push(
          assignment.comparison
        );

        continue;
      }


      const retailer =
        assignment.result
          .retailer;


      if (
        !groups.has(
          retailer
        )
      ) {
        groups.set(
          retailer,
          []
        );
      }


      groups
        .get(retailer)
        .push(
          assignment
        );
    }


    return {
      groups,
      unavailable
    };
  }


  /*
   * =====================================================
   * FRESHNESS DISPLAY
   * =====================================================
   */

  function freshnessText(
    result
  ) {
    if (
      result.dataMode ===
        "live" ||
      result.retrievalSource ===
        "kroger-live-api"
    ) {
      return "Live price";
    }


    if (
      result.freshness ===
      "current"
    ) {
      if (
        Number(
          result.ageDays
        ) === 0
      ) {
        return "Updated today";
      }

      return `Updated ${result.ageDays} day${
        Number(
          result.ageDays
        ) === 1
          ? ""
          : "s"
      } ago`;
    }


    if (
      result.freshness ===
      "aging"
    ) {
      return `Aging evidence${
        result.ageDays !==
        null
          ? ` · ${result.ageDays} days old`
          : ""
      }`;
    }


    if (
      result.freshness ===
      "stale"
    ) {
      return `Needs refresh${
        result.ageDays !==
        null
          ? ` · ${result.ageDays} days old`
          : ""
      }`;
    }


    if (
      result.dataMode ===
      "dated-retailer-evidence"
    ) {
      return "Public price evidence";
    }


    return "";
  }


  /*
   * =====================================================
   * PACKAGE DESCRIPTION
   * =====================================================
   */

  function packageDescription(
    result
  ) {
    const packages =
      Array.isArray(
        result.packages
      )
        ? result.packages
        : [];

    if (!packages.length) {
      return "";
    }


    const first =
      packages[0];

    const count =
      packages.length;

    const size =
      first.size ||
      (
        first.packageQty &&
        first.packageUnit
          ? `${first.packageQty} ${first.packageUnit}`
          : ""
      );


    if (
      count === 1
    ) {
      return [
        first.product,
        size
      ]
        .filter(Boolean)
        .join(" · ");
    }


    return [
      `${count} × ${first.product}`,
      size
    ]
      .filter(Boolean)
      .join(" · ");
  }


  /*
   * =====================================================
   * PLAN RENDER
   * =====================================================
   */

  function renderPlan(
    plan,
    emphasized = false
  ) {
    if (!plan) {
      return "";
    }


    const {
      groups,
      unavailable
    } =
      groupAssignmentsByStore(
        plan.assignments
      );


    const storesHtml =
      [...groups.entries()]
        .map(
          ([
            retailer,
            assignments
          ]) => {
            const storeTotal =
              assignments.reduce(
                (
                  sum,
                  assignment
                ) =>
                  sum +
                  Number(
                    assignment.result
                      .cost
                  ),
                0
              );


            const itemsHtml =
              assignments
                .map(
                  assignment => {
                    const comparison =
                      assignment.comparison;

                    const result =
                      assignment.result;

                    const freshness =
                      freshnessText(
                        result
                      );

                    const packageText =
                      packageDescription(
                        result
                      );


                    return `
                      <div class="result-item">
                        <div class="result-item-main">
                          <strong>
                            ${escapeHtml(
                              comparison.label
                            )}
                          </strong>

                          <span>
                            ${escapeHtml(
                              comparison.quantity
                            )}
                            ${escapeHtml(
                              unitLabel(
                                comparison.unit
                              )
                            )}
                          </span>

                          ${
                            packageText
                              ? `
                                <small>
                                  ${escapeHtml(
                                    packageText
                                  )}
                                </small>
                              `
                              : ""
                          }

                          ${
                            freshness
                              ? `
                                <small class="freshness">
                                  ${escapeHtml(
                                    freshness
                                  )}
                                </small>
                              `
                              : ""
                          }
                        </div>

                        <strong class="result-price">
                          ${money(
                            result.cost
                          )}
                        </strong>
                      </div>
                    `;
                  }
                )
                .join("");


            return `
              <section class="store-group">
                <header class="store-header">
                  <h4>
                    ${escapeHtml(
                      retailer
                    )}
                  </h4>

                  <strong>
                    ${money(
                      storeTotal
                    )}
                  </strong>
                </header>

                ${itemsHtml}
              </section>
            `;
          }
        )
        .join("");


    const unavailableHtml =
      unavailable.length
        ? `
          <div class="unavailable-items">
            <strong>
              Pricing research needed
            </strong>

            ${unavailable
              .map(
                comparison =>
                  `
                    <div>
                      ${escapeHtml(
                        comparison.label
                      )}
                    </div>
                  `
              )
              .join("")}
          </div>
        `
        : "";


    const coverage =
      plan.coverage !==
      undefined
        ? `
          <span class="plan-coverage">
            ${plan.coverage} of ${
              plan.assignments.length
            } items covered
          </span>
        `
        : "";


    return `
      <article class="plan-card ${
        emphasized
          ? "plan-featured"
          : ""
      }">
        <header class="plan-card-header">
          <div>
            <h3>
              ${escapeHtml(
                plan.name
              )}
            </h3>

            <p>
              ${escapeHtml(
                plan.description
              )}
            </p>

            ${coverage}
          </div>

          <div class="plan-total">
            ${money(
              plan.actualTotal
            )}
          </div>
        </header>

        ${
          plan.stores
            ?.length
            ? `
              <div class="plan-stops">
                ${
                  plan.stores
                    .length
                }
                store${
                  plan.stores
                    .length === 1
                    ? ""
                    : "s"
                }
                ·
                ${escapeHtml(
                  plan.stores
                    .join(
                      " + "
                    )
                )}
              </div>
            `
            : ""
        }

        ${storesHtml}

        ${unavailableHtml}
      </article>
    `;
  }


  /*
   * =====================================================
   * COMPARE ALL
   * =====================================================
   */

  async function compareWeeklyList() {
    if (
      compareInProgress
    ) {
      return;
    }


    const active =
      activeWeeklyItems();


    if (!active.length) {
      setStatus(
        weeklyList.length
          ? "Everything on your weekly list is already checked off."
          : "Add grocery items before comparing."
      );

      return;
    }


    compareInProgress =
      true;

    if (
      compareButton
    ) {
      compareButton.disabled =
        true;
    }

    setStatus(
      `Comparing ${active.length} item${
        active.length === 1
          ? ""
          : "s"
      }…`
    );


    if (
      resultsContainer
    ) {
      resultsContainer.innerHTML =
        `
          <div class="results-loading">
            Finding the best grocery plan…
          </div>
        `;
    }


    try {
      const raw =
        await Promise.all(
          active.map(
            item =>
              compareItem(item)
                .catch(
                  error => ({
                    item,
                    query:
                      buildCompareQuery(
                        item
                      ),

                    data: {
                      ok: false,
                      results: [],
                      error:
                        error.message
                    }
                  })
                )
          )
        );


      const comparisons =
        raw.map(
          normalizeItemComparison
        );


      renderWeeklyList();


      const lowest =
        buildLowestCostPlan(
          comparisons
        );

      const balance =
        buildBestBalancePlan(
          comparisons
        );

      const oneStore =
        buildOneStorePlan(
          comparisons
        );


      if (
        resultsContainer
      ) {
        resultsContainer.innerHTML =
          `
            <div class="results-heading">
              <div>
                <h2>
                  Your Grocery Plan
                </h2>

                <p>
                  Based on ${
                    active.length
                  } unchecked item${
                    active.length === 1
                      ? ""
                      : "s"
                  }.
                </p>
              </div>
            </div>

            <div class="plan-grid">
              ${renderPlan(
                lowest,
                false
              )}

              ${renderPlan(
                balance,
                true
              )}

              ${renderPlan(
                oneStore,
                false
              )}
            </div>
          `;
      }


      const researchCount =
        comparisons.filter(
          comparison =>
            !comparison.results
              .length
        ).length;


      if (
        researchCount > 0
      ) {
        setStatus(
          `Comparison complete. ${researchCount} item${
            researchCount === 1
              ? ""
              : "s"
          } still need pricing research.`
        );

      } else {
        setStatus(
          "Comparison complete."
        );
      }

    } catch (
      error
    ) {
      console.error(
        error
      );

      setStatus(
        `Comparison failed: ${error.message}`
      );

      if (
        resultsContainer
      ) {
        resultsContainer.innerHTML =
          `
            <div class="error-state">
              We couldn't complete the grocery comparison.
            </div>
          `;
      }

    } finally {
      compareInProgress =
        false;

      if (
        compareButton
      ) {
        compareButton.disabled =
          false;
      }
    }
  }


  /*
   * =====================================================
   * STATUS MESSAGE
   * =====================================================
   */

  function setStatus(
    message
  ) {
    if (
      statusContainer
    ) {
      statusContainer.textContent =
        message;

      return;
    }

    console.log(
      message
    );
  }


  /*
   * =====================================================
   * EVENT LISTENERS
   * =====================================================
   */

  productSelect
    ?.addEventListener(
      "change",
      syncUnitsToSelectedProduct
    );


  addButton
    ?.addEventListener(
      "click",
      addSelectedProduct
    );


  compareButton
    ?.addEventListener(
      "click",
      compareWeeklyList
    );


  resetButton
    ?.addEventListener(
      "click",
      resetWeeklyList
    );


  customToggleButton
    ?.addEventListener(
      "click",
      () => {
        if (
          customPanel &&
          !customPanel.hidden &&
          !customPanel
            .classList
            .contains(
              "hidden"
            )
        ) {
          closeCustomPanel();

        } else {
          openCustomPanel();
        }
      }
    );


  saveCustomButton
    ?.addEventListener(
      "click",
      saveCustomProduct
    );


  customNameInput
    ?.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          saveCustomProduct();
        }
      }
    );


  listContainer
    ?.addEventListener(
      "change",
      event => {
        const checkbox =
          event.target.closest(
            "[data-toggle-item]"
          );

        if (!checkbox) {
          return;
        }

        toggleWeeklyItem(
          checkbox.dataset
            .toggleItem
        );
      }
    );


  listContainer
    ?.addEventListener(
      "click",
      event => {
        const remove =
          event.target.closest(
            "[data-remove-item]"
          );

        if (!remove) {
          return;
        }

        removeWeeklyItem(
          remove.dataset
            .removeItem
        );
      }
    );


  /*
   * =====================================================
   * INITIALIZE
   * =====================================================
   */

  async function initialize() {
    await loadProducts();

    renderWeeklyList();

    /*
     * Evidence coverage is supplemental.
     * A failure here never prevents the app from working.
     */

    loadEvidenceRefreshStatus();
  }


  initialize();

})();
