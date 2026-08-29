/*
 * Toomey Grocery Optimized
 * public/app.js
 *
 * Weekly grocery list
 * Custom products
 * Pricing coverage
 * Lowest Cost / Best Balance / One Store optimization
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

  const STOP_PENALTY = 5;


  /*
   * =====================================================
   * DOM
   * =====================================================
   */

  const productSelect =
    document.getElementById(
      "productSelect"
    );

  const quantitySelect =
    document.getElementById(
      "quantitySelect"
    );

  const unitSelect =
    document.getElementById(
      "unitSelect"
    );

  const addItemButton =
    document.getElementById(
      "addItemButton"
    );

  const resetListButton =
    document.getElementById(
      "resetListButton"
    );

  const compareButton =
    document.getElementById(
      "compareButton"
    );

  const groceryList =
    document.getElementById(
      "groceryList"
    );

  const remainingItemCount =
    document.getElementById(
      "remainingItemCount"
    );


  /*
   * Status + results
   */

  const statusSection =
    document.getElementById(
      "statusSection"
    );

  const status =
    document.getElementById(
      "status"
    );

  const resultsSection =
    document.getElementById(
      "resultsSection"
    );

  const results =
    document.getElementById(
      "results"
    );


  /*
   * Custom product form
   */

  const openCustomProductButton =
    document.getElementById(
      "openCustomProductButton"
    );

  const closeCustomProductButton =
    document.getElementById(
      "closeCustomProductButton"
    );

  const customProductPanel =
    document.getElementById(
      "customProductPanel"
    );

  const customProductName =
    document.getElementById(
      "customProductName"
    );

  const customProductCategory =
    document.getElementById(
      "customProductCategory"
    );

  const customProductDefaultUnit =
    document.getElementById(
      "customProductDefaultUnit"
    );

  const saveCustomProductButton =
    document.getElementById(
      "saveCustomProductButton"
    );


  /*
   * Templates
   */

  const groceryItemTemplate =
    document.getElementById(
      "groceryItemTemplate"
    );

  const optimizationCardTemplate =
    document.getElementById(
      "optimizationCardTemplate"
    );


  /*
   * =====================================================
   * STATE
   * =====================================================
   */

  let baseProducts = [];

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

  let products = [];

  let productMap = {};

  let comparing = false;


  /*
   * =====================================================
   * HELPERS
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
      JSON.stringify(
        value
      )
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
      !Number.isFinite(
        number
      )
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
      !Number.isFinite(
        number
      )
    ) {
      return 0;
    }

    const factor =
      10 ** decimals;

    return (
      Math.round(
        number *
        factor
      ) /
      factor
    );
  }


  function unique(
    values
  ) {
    return [
      ...new Set(
        values.filter(
          Boolean
        )
      )
    ];
  }


  function productById(
    id
  ) {
    return (
      productMap[id] ||
      null
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
   * STATUS
   * =====================================================
   */

  function showStatus(
    message
  ) {
    if (
      !statusSection ||
      !status
    ) {
      return;
    }

    status.textContent =
      message;

    statusSection.hidden =
      false;
  }


  function hideStatus() {
    if (
      statusSection
    ) {
      statusSection.hidden =
        true;
    }
  }


  /*
   * =====================================================
   * PRODUCT CATALOG
   * =====================================================
   */

  function normalizeProduct(
    product,
    custom = false
  ) {
    const defaultUnit =
      product.defaultUnit ||
      product.unit ||
      "each";

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
            ? "Other"
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


  async function loadProducts() {
    try {
      const response =
        await fetch(
          "/products.json",
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

      baseProducts =
        Array.isArray(data)
          ? data
          : [];

    } catch (
      error
    ) {
      console.error(
        "Could not load products:",
        error
      );

      baseProducts =
        [];
    }

    rebuildCatalog();
  }


  function rebuildCatalog() {
    const normalizedBase =
      baseProducts.map(
        product =>
          normalizeProduct(
            product,
            false
          )
      );

    const normalizedCustom =
      customProducts.map(
        product =>
          normalizeProduct(
            product,
            true
          )
      );

    products = [
      ...normalizedBase,
      ...normalizedCustom
    ];

    productMap =
      Object.fromEntries(
        products.map(
          product => [
            product.id,
            product
          ]
        )
      );

    renderProductDropdown();
  }


  /*
   * =====================================================
   * PRODUCT DROPDOWN
   * =====================================================
   */

  function renderProductDropdown() {
    if (!productSelect) {
      return;
    }

    const previous =
      productSelect.value;

    productSelect.innerHTML =
      `
        <option value="">
          Select a product
        </option>
      `;

    const categories =
      new Map();


    for (
      const product of
      products
    ) {
      if (
        !categories.has(
          product.category
        )
      ) {
        categories.set(
          product.category,
          []
        );
      }

      categories
        .get(
          product.category
        )
        .push(
          product
        );
    }


    for (
      const [
        category,
        categoryProducts
      ] of categories
    ) {
      const optgroup =
        document.createElement(
          "optgroup"
        );

      optgroup.label =
        category;


      for (
        const product of
        categoryProducts
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
      previous &&
      productMap[
        previous
      ]
    ) {
      productSelect.value =
        previous;
    }

    syncUnitDropdown();
  }


  /*
   * =====================================================
   * QUANTITY DROPDOWN
   * =====================================================
   */

  function populateQuantityDropdown() {
    if (!quantitySelect) {
      return;
    }

    const previous =
      quantitySelect.value;

    const values = [
      0.25,
      0.5,
      0.75,
      1,
      1.5,
      2,
      2.5,
      3,
      4,
      5,
      6,
      8,
      10,
      12,
      16,
      20
    ];

    quantitySelect.innerHTML =
      "";

    for (
      const quantity of
      values
    ) {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        String(
          quantity
        );

      option.textContent =
        String(
          quantity
        );

      quantitySelect.appendChild(
        option
      );
    }


    if (
      values
        .map(String)
        .includes(
          previous
        )
    ) {
      quantitySelect.value =
        previous;

    } else {
      quantitySelect.value =
        "1";
    }
  }


  /*
   * =====================================================
   * UNITS
   * =====================================================
   */

  function unitLabel(
    unit
  ) {
    if (
      unit ===
      "fl_oz"
    ) {
      return "fl oz";
    }

    return unit;
  }


  function syncUnitDropdown() {
    if (
      !productSelect ||
      !unitSelect
    ) {
      return;
    }

    const product =
      productById(
        productSelect.value
      );

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

    const oldValue =
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
        unitLabel(
          unit
        );

      unitSelect.appendChild(
        option
      );
    }


    if (
      allowedUnits.includes(
        oldValue
      )
    ) {
      unitSelect.value =
        oldValue;

    } else {
      unitSelect.value =
        product.defaultUnit ||
        allowedUnits[0];
    }
  }


  /*
   * =====================================================
   * CUSTOM PRODUCT PANEL
   * =====================================================
   */

  function openCustomProductPanel() {
    if (
      !customProductPanel
    ) {
      return;
    }

    customProductPanel.hidden =
      false;

    customProductPanel
      .classList
      .remove(
        "hidden"
      );

    setTimeout(
      () => {
        customProductName
          ?.focus();
      },
      20
    );
  }


  function closeCustomProductPanel() {
    if (
      !customProductPanel
    ) {
      return;
    }

    customProductPanel.hidden =
      true;

    customProductPanel
      .classList
      .add(
        "hidden"
      );
  }


  async function saveCustomProduct() {
    const rawName =
      customProductName
        ?.value
        ?.trim();

    if (!rawName) {
      showStatus(
        "Enter a product name first."
      );

      customProductName
        ?.focus();

      return;
    }


    const id =
      `custom-${slugify(
        rawName
      )}`;


    const existing =
      products.find(
        product =>
          product.id ===
            id ||
          cleanText(
            product.label
          ) ===
          cleanText(
            rawName
          )
      );


    if (existing) {
      productSelect.value =
        existing.id;

      syncUnitDropdown();

      closeCustomProductPanel();

      showStatus(
        `${existing.label} is already saved.`
      );

      return;
    }


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

      category:
        customProductCategory
          ?.value ||
        "Other",

      defaultUnit:
        customProductDefaultUnit
          ?.value ||
        "each",

      allowedUnits: [
        customProductDefaultUnit
          ?.value ||
        "each"
      ],

      custom:
        true
    };


    customProducts.push(
      product
    );

    persistCustomProducts();

    rebuildCatalog();


    productSelect.value =
      product.id;

    syncUnitDropdown();


    if (
      customProductName
    ) {
      customProductName.value =
        "";
    }


    closeCustomProductPanel();


    showStatus(
      `${product.label} saved. Checking pricing coverage…`
    );


    await checkProductPricing(
      product,
      1,
      product.defaultUnit
    );
  }


  /*
   * =====================================================
   * PRICING STATUS
   * =====================================================
   */

  function getPricingStatus(
    productId
  ) {
    return (
      pricingStatus[
        productId
      ] ||
      {
        status:
          "unknown",

        retailerCount:
          0,

        retailers: []
      }
    );
  }


  function setPricingStatus(
    productId,
    data
  ) {
    pricingStatus[
      productId
    ] = {
      ...getPricingStatus(
        productId
      ),

      ...data
    };

    persistPricingStatus();
  }


  function pricingLabel(
    data
  ) {
    switch (
      data?.status
    ) {
      case "available":
        return "Pricing available";

      case "partial":
        return "Partial pricing";

      case "research":
        return "Research needed";

      case "checking":
        return "Checking pricing…";

      default:
        return "";
    }
  }


  function inferPricing(
    data
  ) {
    const retailerNames =
      unique(
        (
          Array.isArray(
            data?.results
          )
            ? data.results
            : []
        )
          .map(
            result =>
              result.retailer
          )
      );


    if (
      retailerNames.length >=
      2
    ) {
      return {
        status:
          "available",

        retailerCount:
          retailerNames.length,

        retailers:
          retailerNames
      };
    }


    if (
      retailerNames.length ===
      1
    ) {
      return {
        status:
          "partial",

        retailerCount:
          1,

        retailers:
          retailerNames
      };
    }


    return {
      status:
        "research",

      retailerCount:
        0,

      retailers: []
    };
  }


  /*
   * =====================================================
   * WEEKLY LIST
   * =====================================================
   */

  function selectedQuantity() {
    const quantity =
      Number(
        quantitySelect
          ?.value
      );

    return (
      Number.isFinite(
        quantity
      ) &&
      quantity > 0
    )
      ? quantity
      : 1;
  }


  function addSelectedItem() {
    const product =
      productById(
        productSelect
          ?.value
      );

    if (!product) {
      showStatus(
        "Select a product first."
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


    const existing =
      weeklyList.find(
        item =>
          item.productId ===
            product.id &&
          item.unit ===
            unit &&
          item.checked !==
            true
      );


    if (existing) {
      existing.quantity =
        Number(
          existing.quantity
        ) +
        quantity;

    } else {
      weeklyList.push({
        id:
          `${product.id}-${Date.now()}`,

        productId:
          product.id,

        label:
          product.label,

        queryName:
          product.queryName,

        quantity,

        unit,

        checked:
          false,

        custom:
          Boolean(
            product.custom
          )
      });
    }


    persistWeeklyList();

    renderWeeklyList();

    showStatus(
      `${product.label} added to your list.`
    );


    if (
      product.custom
    ) {
      const pricing =
        getPricingStatus(
          product.id
        );

      if (
        pricing.status ===
          "unknown" ||
        pricing.status ===
          "research"
      ) {
        checkProductPricing(
          product,
          quantity,
          unit
        );
      }
    }
  }


  function removeItem(
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


  function toggleItem(
    id,
    checked
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
      Boolean(
        checked
      );

    persistWeeklyList();

    renderWeeklyList();
  }


  function resetWeeklyList() {
    weeklyList =
      weeklyList.map(
        item => ({
          ...item,

          checked:
            false
        })
      );

    persistWeeklyList();

    renderWeeklyList();

    showStatus(
      "Weekly list reset."
    );
  }


  /*
   * =====================================================
   * LIST RENDERING
   * =====================================================
   */

  function renderWeeklyList() {
    if (!groceryList) {
      return;
    }


    groceryList.innerHTML =
      "";


    if (
      !weeklyList.length
    ) {
      groceryList.innerHTML =
        `
          <div class="empty-state">
            Your weekly grocery list is empty.
          </div>
        `;

      updateRemainingCount();

      return;
    }


    for (
      const item of
      weeklyList
    ) {
      const product =
        productById(
          item.productId
        ) || {
          label:
            item.label ||
            item.productId
        };

      const pricing =
        getPricingStatus(
          item.productId
        );


      /*
       * Use the existing HTML template so we preserve
       * the visual styling already built into the app.
       */

      if (
        groceryItemTemplate
      ) {
        const fragment =
          groceryItemTemplate
            .content
            .cloneNode(
              true
            );

        const article =
          fragment.querySelector(
            ".grocery-item"
          );

        const checkbox =
          fragment.querySelector(
            ".grocery-check"
          );

        const productName =
          fragment.querySelector(
            ".grocery-item-product"
          );

        const meta =
          fragment.querySelector(
            ".grocery-item-meta"
          );

        const removeButton =
          fragment.querySelector(
            ".grocery-remove"
          );


        productName.textContent =
          product.label;


        const pricingText =
          pricingLabel(
            pricing
          );

        const retailerText =
          pricing.retailers
            ?.length
            ? pricing.retailers
                .join(", ")
            : "";


        meta.textContent =
          [
            `${item.quantity} ${unitLabel(
              item.unit
            )}`,

            pricingText,

            retailerText
          ]
            .filter(Boolean)
            .join(" · ");


        checkbox.checked =
          Boolean(
            item.checked
          );


        if (
          item.checked
        ) {
          article.classList
            .add(
              "is-complete"
            );
        }


        checkbox.addEventListener(
          "change",
          () => {
            toggleItem(
              item.id,
              checkbox.checked
            );
          }
        );


        removeButton.addEventListener(
          "click",
          () => {
            removeItem(
              item.id
            );
          }
        );


        groceryList.appendChild(
          fragment
        );

      } else {
        const row =
          document.createElement(
            "div"
          );

        row.textContent =
          `${product.label} — ${item.quantity} ${item.unit}`;

        groceryList.appendChild(
          row
        );
      }
    }


    updateRemainingCount();
  }


  function updateRemainingCount() {
    if (
      !remainingItemCount
    ) {
      return;
    }

    const remaining =
      weeklyList.filter(
        item =>
          !item.checked
      ).length;

    remainingItemCount.textContent =
      `${remaining} item${
        remaining === 1
          ? ""
          : "s"
      } to compare`;
  }


  /*
   * =====================================================
   * COMPARE API
   * =====================================================
   */

  function itemProduct(
    item
  ) {
    return (
      productById(
        item.productId
      ) ||
      {
        id:
          item.productId,

        label:
          item.label,

        queryName:
          item.queryName ||
          item.label,

        defaultUnit:
          item.unit,

        custom:
          item.custom
      }
    );
  }


  function buildCompareQuery(
    item
  ) {
    const product =
      itemProduct(
        item
      );

    return `${item.quantity} ${item.unit} ${product.queryName}`;
  }


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
      data
    };
  }


  async function checkProductPricing(
    product,
    quantity,
    unit
  ) {
    setPricingStatus(
      product.id,
      {
        status:
          "checking"
      }
    );

    renderWeeklyList();


    try {
      const response =
        await compareItem({
          productId:
            product.id,

          label:
            product.label,

          queryName:
            product.queryName,

          quantity,

          unit,

          custom:
            product.custom
        });


      const inferred =
        inferPricing(
          response.data
        );


      setPricingStatus(
        product.id,
        {
          ...inferred,

          checkedAt:
            new Date()
              .toISOString()
        }
      );


      renderWeeklyList();


      showStatus(
        `${product.label}: ${
          inferred.status ===
          "available"
            ? "pricing available"
            : inferred.status ===
              "partial"
            ? "partial pricing available"
            : "pricing research needed"
        }.`
      );


      return response.data;

    } catch (
      error
    ) {
      setPricingStatus(
        product.id,
        {
          status:
            "research",

          retailerCount:
            0,

          retailers: [],

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
   * OPTIMIZATION DATA
   * =====================================================
   */

  function normalizeComparison(
    response
  ) {
    const item =
      response.item;

    const product =
      itemProduct(
        item
      );

    const resultList =
      Array.isArray(
        response.data?.results
      )
        ? response.data.results
        : [];


    const inferred =
      inferPricing(
        response.data
      );


    setPricingStatus(
      item.productId,
      {
        ...inferred,

        checkedAt:
          new Date()
            .toISOString()
      }
    );


    return {
      item,

      product,

      results:
        resultList.map(
          result => ({
            ...result,

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

  function lowestCostPlan(
    comparisons
  ) {
    const assignments =
      [];

    let total = 0;


    for (
      const comparison of
      comparisons
    ) {
      const valid =
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


      const selected =
        valid[0] ||
        null;


      if (selected) {
        total +=
          selected.cost;
      }


      assignments.push({
        comparison,
        result:
          selected
      });
    }


    return {
      name:
        "Lowest Cost",

      description:
        "Cheapest valid retailer for each grocery item.",

      assignments,

      total:
        round(
          total
        )
    };
  }


  /*
   * =====================================================
   * BEST BALANCE
   * =====================================================
   */

  function retailerNames(
    comparisons
  ) {
    return unique(
      comparisons.flatMap(
        comparison =>
          comparison.results
            .map(
              result =>
                result.retailer
            )
      )
    );
  }


  function subsets(
    array
  ) {
    const output = [];

    const max =
      2 **
      array.length;


    for (
      let mask = 1;
      mask < max;
      mask++
    ) {
      const subset = [];

      for (
        let i = 0;
        i <
        array.length;
        i++
      ) {
        if (
          mask &
          (
            1 <<
            i
          )
        ) {
          subset.push(
            array[i]
          );
        }
      }

      output.push(
        subset
      );
    }

    return output;
  }


  function planForStores(
    comparisons,
    stores
  ) {
    const allowed =
      new Set(
        stores
      );

    const assignments =
      [];

    let total = 0;


    for (
      const comparison of
      comparisons
    ) {
      const options =
        comparison.results
          .filter(
            result =>
              allowed.has(
                result.retailer
              )
          )
          .sort(
            (a, b) =>
              a.cost -
              b.cost
          );


      if (!options.length) {
        return null;
      }


      const winner =
        options[0];

      total +=
        winner.cost;


      assignments.push({
        comparison,

        result:
          winner
      });
    }


    const usedStores =
      unique(
        assignments.map(
          assignment =>
            assignment.result
              .retailer
        )
      );


    return {
      assignments,

      total:
        round(
          total
        ),

      stores:
        usedStores
    };
  }


  function bestBalancePlan(
    comparisons
  ) {
    const retailers =
      retailerNames(
        comparisons
      );

    let best = null;


    for (
      const storeSet of
      subsets(
        retailers
      )
    ) {
      const plan =
        planForStores(
          comparisons,
          storeSet
        );

      if (!plan) {
        continue;
      }


      const penalty =
        Math.max(
          0,
          plan.stores.length -
          1
        ) *
        STOP_PENALTY;


      const score =
        plan.total +
        penalty;


      const candidate = {
        name:
          "Best Balance",

        description:
          "Balances grocery savings with fewer store stops.",

        assignments:
          plan.assignments,

        total:
          plan.total,

        stores:
          plan.stores,

        score
      };


      if (
        !best ||
        candidate.score <
          best.score
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

  function oneStorePlan(
    comparisons
  ) {
    const retailers =
      retailerNames(
        comparisons
      );

    let best = null;


    for (
      const retailer of
      retailers
    ) {
      let total = 0;

      let coverage = 0;

      const assignments =
        [];


      for (
        const comparison of
        comparisons
      ) {
        const result =
          comparison.results
            .filter(
              candidate =>
                candidate.retailer ===
                retailer
            )
            .sort(
              (a, b) =>
                a.cost -
                b.cost
            )[0] ||
          null;


        if (result) {
          total +=
            result.cost;

          coverage += 1;
        }


        assignments.push({
          comparison,

          result
        });
      }


      const candidate = {
        name:
          "One Store",

        description:
          `${retailer} covers ${coverage} of ${comparisons.length} items.`,

        retailer,

        coverage,

        assignments,

        total:
          round(
            total
          )
      };


      if (
        !best ||
        candidate.coverage >
          best.coverage ||
        (
          candidate.coverage ===
            best.coverage &&
          candidate.total <
            best.total
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
   * PLAN RENDERING
   * =====================================================
   */

  function renderOptimizationCard(
    plan
  ) {
    if (!plan) {
      return null;
    }


    if (
      optimizationCardTemplate
    ) {
      const fragment =
        optimizationCardTemplate
          .content
          .cloneNode(
            true
          );

      const label =
        fragment.querySelector(
          ".optimization-label"
        );

      const title =
        fragment.querySelector(
          ".optimization-title"
        );

      const total =
        fragment.querySelector(
          ".optimization-total"
        );

      const meta =
        fragment.querySelector(
          ".optimization-meta"
        );

      const stores =
        fragment.querySelector(
          ".optimization-stores"
        );


      label.textContent =
        plan.name;

      title.textContent =
        plan.description;

      total.textContent =
        money(
          plan.total
        );


      const usedStores =
        unique(
          plan.assignments
            .map(
              assignment =>
                assignment.result
                  ?.retailer
            )
        );


      meta.textContent =
        usedStores.length
          ? `${usedStores.length} store${
              usedStores.length ===
              1
                ? ""
                : "s"
            }`
          : "No pricing available";


      stores.innerHTML =
        "";


      for (
        const retailer of
        usedStores
      ) {
        const heading =
          document.createElement(
            "h4"
          );

        heading.textContent =
          retailer;

        stores.appendChild(
          heading
        );


        const assignments =
          plan.assignments.filter(
            assignment =>
              assignment.result
                ?.retailer ===
              retailer
          );


        for (
          const assignment of
          assignments
        ) {
          const row =
            document.createElement(
              "div"
            );

          row.className =
            "optimization-store-item";

          const result =
            assignment.result;

          row.textContent =
            `${assignment.comparison.product.label} · ${money(
              result.cost
            )}`;

          stores.appendChild(
            row
          );
        }
      }


      const missing =
        plan.assignments.filter(
          assignment =>
            !assignment.result
        );


      if (
        missing.length
      ) {
        const heading =
          document.createElement(
            "h4"
          );

        heading.textContent =
          "Pricing research needed";

        stores.appendChild(
          heading
        );


        for (
          const assignment of
          missing
        ) {
          const row =
            document.createElement(
              "div"
            );

          row.className =
            "optimization-store-item";

          row.textContent =
            assignment
              .comparison
              .product
              .label;

          stores.appendChild(
            row
          );
        }
      }


      return fragment;
    }


    const fallback =
      document.createElement(
        "div"
      );

    fallback.textContent =
      `${plan.name}: ${money(
        plan.total
      )}`;

    return fallback;
  }


  function renderPlans(
    plans
  ) {
    if (
      !results ||
      !resultsSection
    ) {
      return;
    }


    results.innerHTML =
      "";


    for (
      const plan of
      plans
    ) {
      if (!plan) {
        continue;
      }

      const card =
        renderOptimizationCard(
          plan
        );

      if (card) {
        results.appendChild(
          card
        );
      }
    }


    resultsSection.hidden =
      false;
  }


  /*
   * =====================================================
   * COMPARE WEEKLY LIST
   * =====================================================
   */

  async function compareWeeklyList() {
    if (comparing) {
      return;
    }


    const activeItems =
      weeklyList.filter(
        item =>
          !item.checked
      );


    if (
      !activeItems.length
    ) {
      showStatus(
        weeklyList.length
          ? "Everything on your list is already checked off."
          : "Add groceries before comparing."
      );

      return;
    }


    comparing =
      true;

    compareButton.disabled =
      true;


    showStatus(
      `Comparing ${activeItems.length} item${
        activeItems.length ===
        1
          ? ""
          : "s"
      }…`
    );


    try {
      const rawResponses =
        await Promise.all(
          activeItems.map(
            item =>
              compareItem(
                item
              )
                .catch(
                  error => ({
                    item,

                    data: {
                      ok:
                        false,

                      results:
                        [],

                      error:
                        error.message
                    }
                  })
                )
          )
        );


      const comparisons =
        rawResponses.map(
          normalizeComparison
        );


      renderWeeklyList();


      const lowest =
        lowestCostPlan(
          comparisons
        );

      const balanced =
        bestBalancePlan(
          comparisons
        );

      const oneStore =
        oneStorePlan(
          comparisons
        );


      renderPlans([
        lowest,
        balanced,
        oneStore
      ]);


      const missingCount =
        comparisons.filter(
          comparison =>
            !comparison.results
              .length
        ).length;


      if (
        missingCount
      ) {
        showStatus(
          `Comparison complete. ${missingCount} item${
            missingCount === 1
              ? ""
              : "s"
          } still need pricing research.`
        );

      } else {
        showStatus(
          "Comparison complete."
        );
      }

    } catch (
      error
    ) {
      console.error(
        error
      );

      showStatus(
        `Comparison failed: ${error.message}`
      );

    } finally {
      comparing =
        false;

      compareButton.disabled =
        false;
    }
  }


  /*
   * =====================================================
   * EVENT LISTENERS
   * =====================================================
   */

  productSelect
    ?.addEventListener(
      "change",
      syncUnitDropdown
    );


  addItemButton
    ?.addEventListener(
      "click",
      addSelectedItem
    );


  resetListButton
    ?.addEventListener(
      "click",
      resetWeeklyList
    );


  compareButton
    ?.addEventListener(
      "click",
      compareWeeklyList
    );


  /*
   * THIS IS THE BUTTON THAT WAS BROKEN.
   */

  openCustomProductButton
    ?.addEventListener(
      "click",
      openCustomProductPanel
    );


  closeCustomProductButton
    ?.addEventListener(
      "click",
      closeCustomProductPanel
    );


  saveCustomProductButton
    ?.addEventListener(
      "click",
      saveCustomProduct
    );


  customProductName
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


  /*
   * =====================================================
   * INITIALIZE
   * =====================================================
   */

  async function initialize() {
    hideStatus();

    populateQuantityDropdown();

    await loadProducts();

    renderWeeklyList();
  }


  initialize();

})();
