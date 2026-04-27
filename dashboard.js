const fmtMoney = (value) => `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
const fmtPct = (value) => `${Number(value).toFixed(1)}%`;
const fmtRatio = (value) => `${Number(value).toFixed(2)}x`;
const fmtValue = (value, formatter) => Number.isFinite(value) ? formatter(value) : "N/A";

const sectorColors = {
  "Insurtech": "#4f46e5",
  "REIT / Proptech": "#0d9488",
  "Specialty Insurance": "#ea6a2c",
};

const metricMeta = {
  revenue_m: {
    label: "Revenue",
    formatter: fmtMoney,
    lowerBetter: false,
    definition: "Latest annual revenue from SEC 10-K facts, shown in millions.",
  },
  revenue_growth_pct: {
    label: "Revenue Growth",
    formatter: fmtPct,
    lowerBetter: false,
    definition: "Latest YoY revenue growth, or 3-year revenue CAGR in trend view.",
  },
  net_margin_pct: {
    label: "Net Margin",
    formatter: fmtPct,
    lowerBetter: false,
    definition: "Net income divided by revenue.",
  },
  roa_pct: {
    label: "ROA",
    formatter: fmtPct,
    lowerBetter: false,
    definition: "Net income divided by total assets.",
  },
  debt_to_equity: {
    label: "Debt/Equity",
    formatter: fmtRatio,
    lowerBetter: true,
    definition: "Debt divided by equity where debt facts are available; liabilities are used as fallback.",
  },
  opex_ratio_pct: {
    label: "OpEx Ratio",
    formatter: fmtPct,
    lowerBetter: true,
    definition: "Operating expense, costs and expenses, or insurance benefits/losses and expenses divided by revenue.",
  },
};

const state = {
  activeSectors: new Set(Object.keys(sectorColors)),
  mode: "latest",
  selectedTicker: null,
  hoverTicker: null,
  compareTickers: [],
  sortKey: "revenue_m",
  sortDir: "desc",
  search: "",
};

let dashboardData;

fetch("data/sec_company_fundamentals.json")
  .then((response) => response.json())
  .then((data) => {
    dashboardData = data;
    hydrateStateFromUrl();
    renderDashboard();
  })
  .catch((error) => {
    document.body.innerHTML = `<main><div class="info-box"><p>Unable to load SEC dataset: ${error.message}</p></div></main>`;
  });

function renderDashboard() {
  const companies = dashboardData.companies;
  const visibleCompanies = filteredCompanies();
  const meta = dashboardData.metadata;

  document.getElementById("subtitle").textContent =
    `${meta.source} | Prepared by ${meta.prepared_by} | ${meta.school}`;
  document.getElementById("data-freshness").textContent = formatDate(meta.generated_on);
  document.getElementById("methodology-date").textContent =
    `Dataset generated on ${formatDate(meta.generated_on)} from SEC EDGAR companyfacts.`;
  document.querySelector(".header-stat strong").textContent = `${visibleCompanies.length} of ${companies.length} shown`;

  renderTopStats(visibleCompanies.length ? visibleCompanies : companies);
  renderSectorFilters(companies);
  renderModeToggle();
  renderTakeaways(visibleCompanies.length ? visibleCompanies : companies);
  renderSelectionSummary(companies);
  renderCompareTray(companies);
  renderMarketSummary(companies);
  renderTable(visibleCompanies, companies);
  renderBarCharts(visibleCompanies);
  renderScatter(visibleCompanies);
  renderDeepDive(companies);
  wireControls(companies, visibleCompanies);
  updateUrlState();
}

function metrics(company) {
  return state.mode === "trend" ? trendMetrics(company) : company.metrics;
}

function latestMetrics(company) {
  return company.metrics;
}

function trendMetrics(company) {
  const history = (company.annual_metrics || []).filter((row) => Number.isFinite(row.revenue_m));
  const lastThree = history.slice(-3);
  const latest = company.metrics;
  if (lastThree.length < 2) return latest;
  const first = lastThree[0];
  const last = lastThree[lastThree.length - 1];
  const years = Math.max(1, last.fiscal_year - first.fiscal_year);
  const cagr = first.revenue_m > 0
    ? (Math.pow(last.revenue_m / first.revenue_m, 1 / years) - 1) * 100
    : latest.revenue_growth_pct;
  return {
    fiscal_year: latest.fiscal_year,
    revenue_m: latest.revenue_m,
    revenue_growth_pct: round(cagr, 1),
    net_margin_pct: averageRaw(lastThree, "net_margin_pct"),
    roa_pct: averageRaw(lastThree, "roa_pct"),
    debt_to_equity: averageRaw(lastThree, "debt_to_equity", 2),
    opex_ratio_pct: averageRaw(lastThree, "opex_ratio_pct"),
  };
}

function filteredCompanies() {
  const q = state.search.trim().toLowerCase();
  return dashboardData.companies
    .filter((company) => state.activeSectors.has(company.sector))
    .filter((company) => {
      if (!q) return true;
      return [company.company, company.ticker, company.sector, company.why]
        .some((value) => String(value).toLowerCase().includes(q));
    })
    .sort((a, b) => compareCompanies(a, b));
}

function compareCompanies(a, b) {
  const key = state.sortKey;
  const dir = state.sortDir === "asc" ? 1 : -1;
  const aValue = key in metricMeta ? metrics(a)[key] : a[key];
  const bValue = key in metricMeta ? metrics(b)[key] : b[key];
  if (typeof aValue === "number" && typeof bValue === "number") return (aValue - bValue) * dir;
  return String(aValue).localeCompare(String(bValue)) * dir;
}

function renderTopStats(companies) {
  const totalRevenue = sum(companies, "revenue_m");
  const avgGrowth = averageMetric(companies, "revenue_growth_pct");
  const avgMargin = averageMetric(companies, "net_margin_pct");
  const latestFy = Math.max(...companies.map((company) => latestMetrics(company).fiscal_year));
  const cards = [
    ["Peer Revenue", fmtMoney(totalRevenue), `${state.mode === "trend" ? "Filtered set, latest revenue" : "Filtered set, latest annual revenue"}`],
    ["Average Growth", fmtPct(avgGrowth), state.mode === "trend" ? "3-year revenue CAGR" : "YoY revenue growth"],
    ["Median Margin", fmtPct(median(companies, "net_margin_pct")), "Peer-set benchmark"],
    ["Latest Fiscal Year", latestFy, "SEC annual facts"],
  ];
  document.getElementById("top-stats").innerHTML = cards
    .map(([label, value, note]) => `
      <div class="snapshot-card">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${note}</small>
      </div>
    `)
    .join("");
}

function renderSectorFilters(companies) {
  const sectors = [...new Set(companies.map((company) => company.sector))];
  document.getElementById("sector-filters").innerHTML = sectors
    .map((sector) => `
      <label class="filter-chip">
        <input type="checkbox" value="${sector}" ${state.activeSectors.has(sector) ? "checked" : ""}>
        <span>${sector}</span>
      </label>
    `)
    .join("");
}

function renderModeToggle() {
  document.getElementById("mode-latest").classList.toggle("active", state.mode === "latest");
  document.getElementById("mode-trend").classList.toggle("active", state.mode === "trend");
  document.getElementById("mode-latest").setAttribute("aria-pressed", state.mode === "latest");
  document.getElementById("mode-trend").setAttribute("aria-pressed", state.mode === "trend");
}

function renderTakeaways(companies) {
  const highestMargin = maxBy(companies, "net_margin_pct");
  const fastestGrowth = maxBy(companies, "revenue_growth_pct");
  const largestRevenue = maxBy(companies, "revenue_m");
  const mostLevered = maxBy(companies, "debt_to_equity");
  const items = [
    `Highest margin: ${highestMargin.ticker} (${fmtPct(metrics(highestMargin).net_margin_pct)})`,
    `Fastest growth: ${fastestGrowth.ticker} (${fmtPct(metrics(fastestGrowth).revenue_growth_pct)})`,
    `Largest revenue: ${largestRevenue.ticker} (${fmtMoney(metrics(largestRevenue).revenue_m)})`,
    `Most leveraged: ${mostLevered.ticker} (${fmtRatio(metrics(mostLevered).debt_to_equity)})`,
  ];
  document.getElementById("takeaways").innerHTML = items
    .map((item) => `<button class="takeaway" type="button">${item}</button>`)
    .join("");
}

function renderSelectionSummary(companies) {
  const container = document.getElementById("selection-summary");
  const selected = state.selectedTicker
    ? companies.find((company) => company.ticker === state.selectedTicker)
    : null;
  const leader = maxBy(companies, "net_margin_pct");
  const grower = maxBy(companies, "revenue_growth_pct");

  if (!selected) {
    container.innerHTML = `
      <article class="selection-card">
        <div>
          <p class="control-title">Focus Company</p>
          <strong>No company selected</strong>
          <span>Choose a row, chart mark, or profile to pin a company view.</span>
        </div>
        <div class="selection-metrics">
          ${selectionMetric("Margin leader", `${leader.ticker} ${fmtPct(metrics(leader).net_margin_pct)}`)}
          ${selectionMetric("Growth leader", `${grower.ticker} ${fmtPct(metrics(grower).revenue_growth_pct)}`)}
          ${selectionMetric("Visible mode", state.mode === "trend" ? "3-year trend" : "Latest year")}
        </div>
      </article>
    `;
    return;
  }

  const profile = companyProfile(selected, companies);
  const m = metrics(selected);
  container.innerHTML = `
    <article class="selection-card selected">
      <div>
        <p class="control-title">Focus Company</p>
        <strong>${selected.company} <span class="ticker-pill" style="background:${sectorColors[selected.sector]}">${selected.ticker}</span></strong>
        <span>${profile.label} | #${profile.rank} overall | Filed ${formatDate(selected.filing_date)}</span>
      </div>
      <div class="selection-metrics">
        ${selectionMetric("Revenue", fmtMoney(m.revenue_m))}
        ${selectionMetric("Growth", fmtPct(m.revenue_growth_pct), medianDelta(companies, selected, "revenue_growth_pct"))}
        ${selectionMetric("Margin", fmtPct(m.net_margin_pct), medianDelta(companies, selected, "net_margin_pct"))}
        ${selectionMetric("Watch", profile.worst)}
      </div>
      <a class="selection-link" href="${secCompanyUrl(selected.cik)}" target="_blank" rel="noopener">SEC filings</a>
    </article>
  `;
}

function selectionMetric(label, value, note = "") {
  return `
    <div class="selection-metric">
      <span>${label}</span>
      <strong>${value}</strong>
      ${note ? `<small>${note}</small>` : ""}
    </div>
  `;
}

function renderCompareTray(companies) {
  const selected = state.compareTickers
    .map((ticker) => companies.find((company) => company.ticker === ticker))
    .filter(Boolean);
  const tray = document.getElementById("compare-tray");
  if (selected.length < 2) {
    tray.innerHTML = `
      <div class="compare-empty">
        <strong>Compare Tray</strong>
        <span>Click 2-3 companies in the table, charts, or scatter plot to compare revenue growth, margin, leverage, and OpEx deltas.</span>
      </div>`;
    return;
  }
  const base = selected[0];
  tray.innerHTML = `
    <div class="compare-head">
      <div>
        <p class="control-title">Compare Tray</p>
        <strong>${selected.map((company) => company.ticker).join(" vs. ")}</strong>
      </div>
      <button type="button" data-clear-compare>Clear Compare</button>
    </div>
    <div class="compare-grid">
      ${selected.map((company) => compareCard(company, base)).join("")}
    </div>
  `;
}

function compareCard(company, base) {
  const pairs = ["revenue_growth_pct", "net_margin_pct", "debt_to_equity", "opex_ratio_pct"];
  return `
    <article class="compare-card ${isSelected(company.ticker) ? "selected" : ""}" data-ticker="${company.ticker}">
      <div class="compare-title">
        <span class="ticker-pill" style="background:${sectorColors[company.sector]}">${company.ticker}</span>
        <button type="button" data-remove-compare="${company.ticker}" title="Remove from compare">Remove</button>
      </div>
      ${pairs.map((key) => {
        const value = metrics(company)[key];
        const delta = value - metrics(base)[key];
        const formatter = metricMeta[key].formatter;
        return `
          <div class="delta-row">
            <span title="${metricMeta[key].definition}">${metricMeta[key].label}</span>
            <strong>${fmtValue(value, formatter)}</strong>
            <small>${company.ticker === base.ticker ? "Base" : signedDelta(delta, formatter)}</small>
          </div>
        `;
      }).join("")}
    </article>
  `;
}

function renderMarketSummary(companies) {
  const nmi = companies.find((company) => company.ticker === "NMIH");
  const hippo = companies.find((company) => company.ticker === "HIPO");
  const insurtechs = companies.filter((company) => company.sector === "Insurtech");
  const reits = companies.filter((company) => company.sector === "REIT / Proptech");
  const insurtechGrowth = averageMetric(insurtechs, "revenue_growth_pct");
  const insurtechMargin = averageMetric(insurtechs, "net_margin_pct");
  const reitGrowth = averageMetric(reits, "revenue_growth_pct");
  const reitMargin = averageMetric(reits, "net_margin_pct");
  document.getElementById("market-summary").textContent =
    `The public peer set shows a clear growth-versus-profitability divide. NMI Holdings is the strongest financial performer, Hippo remains the weakest on margin, insurtechs show the fastest growth with the most severe losses, and REIT / proptech peers compound more slowly with steadier positive margins. Overall, the market is rewarding companies that can pair growth with disciplined loss control, efficient operations, and a credible path to durable profitability.`;
  document.getElementById("summary-evidence").innerHTML = [
    evidenceItem("Strongest performer", nmi, `${fmtPct(metrics(nmi).net_margin_pct)} net margin, ${fmtPct(metrics(nmi).roa_pct)} ROA, ${fmtRatio(metrics(nmi).debt_to_equity)} D/E`),
    evidenceItem("Weakest margin", hippo, `${fmtPct(metrics(hippo).net_margin_pct)} net margin despite ${fmtPct(metrics(hippo).revenue_growth_pct)} growth`),
    `<details><summary>Sector divide evidence</summary><p>Insurtechs average ${fmtPct(insurtechGrowth)} growth and ${fmtPct(insurtechMargin)} margin. REIT / proptech peers average ${fmtPct(reitGrowth)} growth and ${fmtPct(reitMargin)} margin.</p></details>`,
  ].join("");
}

function evidenceItem(label, company, claim) {
  return `
    <details>
      <summary>${label}: ${company.ticker}</summary>
      <p>${claim}. <a href="${secCompanyUrl(company.cik)}" target="_blank" rel="noopener">SEC filing source</a></p>
    </details>
  `;
}

function renderTable(companies, allCompanies) {
  document.getElementById("table-search").value = state.search;
  document.getElementById("table-status").textContent =
    `${companies.length} of ${allCompanies.length} companies shown`;
  const tbody = document.getElementById("kpi-table");
  if (!companies.length) {
    tbody.innerHTML = `
      <tr class="empty-table-row">
        <td colspan="11">
          <div class="empty-state compact">No companies match the current search and sector filters.</div>
        </td>
      </tr>
    `;
    renderMobileCards(companies, allCompanies);
    updateSortButtons();
    return;
  }
  tbody.innerHTML = companies.map((company) => {
    const m = metrics(company);
    const sectorColor = sectorColors[company.sector];
    return `
      <tr data-ticker="${company.ticker}" class="${rowClass(company.ticker)}">
        <td><strong>${company.company}</strong><small>${company.why}</small></td>
        <td><span class="ticker-pill" style="background:${sectorColor}">${company.ticker}</span></td>
        <td>${company.sector}</td>
        ${metricCell(company, allCompanies, "revenue_m", fmtMoney)}
        ${metricCell(company, allCompanies, "revenue_growth_pct", fmtPct)}
        ${metricCell(company, allCompanies, "net_margin_pct", fmtPct)}
        ${metricCell(company, allCompanies, "roa_pct", fmtPct)}
        ${metricCell(company, allCompanies, "debt_to_equity", fmtRatio)}
        ${metricCell(company, allCompanies, "opex_ratio_pct", fmtPct)}
        <td>${formatDate(company.filing_date)}</td>
        <td><a href="${secCompanyUrl(company.cik)}" target="_blank" rel="noopener">SEC</a></td>
      </tr>
    `;
  }).join("");
  renderMobileCards(companies, allCompanies);
  updateSortButtons();
}

function updateSortButtons() {
  document.querySelectorAll(".sort-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sortKey);
    button.dataset.dir = button.dataset.sort === state.sortKey ? state.sortDir : "";
  });
}

function metricCell(company, companies, key, formatter) {
  const value = metrics(company)[key];
  return `
    <td style="background:${metricGradient(key, value)}" title="${metricMeta[key].definition}">
      <strong>${fmtValue(value, formatter)}</strong>
      ${benchmarkBadge(company, companies, key)}
    </td>
  `;
}

function benchmarkBadge(company, companies, key) {
  const value = metrics(company)[key];
  const med = median(companies, key);
  const pct = percentileRank(companies, company, key);
  const above = metricMeta[key].lowerBetter ? value <= med : value >= med;
  return `
    <small class="benchmark ${above ? "positive" : "negative"}">
      ${above ? "Above" : "Below"} peer median ${fmtValue(med, metricMeta[key].formatter)} | P${pct}
    </small>
  `;
}

function renderMobileCards(companies, allCompanies) {
  if (!companies.length) {
    document.getElementById("mobile-cards").innerHTML =
      `<div class="empty-state compact">No companies match the current search and sector filters.</div>`;
    return;
  }
  document.getElementById("mobile-cards").innerHTML = companies.map((company) => `
    <article class="mobile-card ${rowClass(company.ticker)}" data-ticker="${company.ticker}">
      <div>
        <strong>${company.company}</strong>
        <span>${company.ticker} | ${company.sector} | Filed ${formatDate(company.filing_date)}</span>
      </div>
      <a href="${secCompanyUrl(company.cik)}" target="_blank" rel="noopener">SEC</a>
      ${["revenue_m", "revenue_growth_pct", "net_margin_pct", "debt_to_equity"].map((key) => `
        <p><span>${metricMeta[key].label}</span><strong>${fmtValue(metrics(company)[key], metricMeta[key].formatter)}</strong>${benchmarkBadge(company, allCompanies, key)}</p>
      `).join("")}
    </article>
  `).join("");
}

function renderBarCharts(companies) {
  if (!companies.length) {
    ["revenue-chart", "growth-chart", "margin-chart", "de-chart"].forEach((id) => {
      document.getElementById(id).innerHTML = `<div class="empty-state">No companies match the current filters.</div>`;
    });
    return;
  }
  renderHorizontalBars({
    id: "revenue-chart",
    companies: [...companies].sort((a, b) => metrics(b).revenue_m - metrics(a).revenue_m),
    key: "revenue_m",
    formatter: fmtMoney,
    color: (company) => sectorColors[company.sector],
    min: 0,
  });
  renderHorizontalBars({
    id: "growth-chart",
    companies: [...companies].sort((a, b) => metrics(b).revenue_growth_pct - metrics(a).revenue_growth_pct),
    key: "revenue_growth_pct",
    formatter: fmtPct,
    color: (company) => metrics(company).revenue_growth_pct >= 0 ? "#14915f" : "#cf3d3d",
    min: Math.min(0, ...companies.map((company) => metrics(company).revenue_growth_pct)),
  });
  renderHorizontalBars({
    id: "margin-chart",
    companies: [...companies].sort((a, b) => metrics(b).net_margin_pct - metrics(a).net_margin_pct),
    key: "net_margin_pct",
    formatter: fmtPct,
    color: (company) => metrics(company).net_margin_pct >= 0 ? "#14915f" : "#cf3d3d",
    min: Math.min(0, ...companies.map((company) => metrics(company).net_margin_pct)),
  });
  renderHorizontalBars({
    id: "de-chart",
    companies: [...companies].sort((a, b) => metrics(b).debt_to_equity - metrics(a).debt_to_equity),
    key: "debt_to_equity",
    formatter: fmtRatio,
    color: (company) => redScale(metrics(company).debt_to_equity, -4.5, 3.5),
    min: Math.min(0, ...companies.map((company) => metrics(company).debt_to_equity)),
  });
}

function renderHorizontalBars({ id, companies, key, formatter, color, min }) {
  const max = Math.max(...companies.map((company) => metrics(company)[key]).filter(Number.isFinite));
  const width = 720;
  const rowH = 44;
  const left = 132;
  const right = 132;
  const top = 20;
  const height = top + companies.length * rowH + 28;
  const chartW = width - left - right;
  const domainMin = Number.isFinite(min) ? min : 0;
  const domainMax = max === domainMin ? max + 1 : max;
  const zeroX = left + ((0 - domainMin) / (domainMax - domainMin)) * chartW;
  const rows = companies.map((company, index) => {
    const value = metrics(company)[key];
    const x1 = left + ((Math.min(value, 0) - domainMin) / (domainMax - domainMin)) * chartW;
    const x2 = left + ((Math.max(value, 0) - domainMin) / (domainMax - domainMin)) * chartW;
    const y = top + index * rowH + 7;
    return `
      <g class="company-mark ${rowClass(company.ticker)}" data-ticker="${company.ticker}" tabindex="0">
        <text class="chart-label" x="0" y="${y + 15}">${company.ticker}</text>
        <rect x="${Math.min(x1, x2)}" y="${y}" width="${Math.max(3, Math.abs(x2 - x1))}" height="22" rx="5" fill="${color(company)}"></rect>
        <text class="chart-value" x="${x2 + (value >= 0 ? 8 : -8)}" y="${y + 15}" text-anchor="${value >= 0 ? "start" : "end"}">${fmtValue(value, formatter)}</text>
      </g>
    `;
  }).join("");
  document.getElementById(id).innerHTML = legendHtml() + `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${metricMeta[key].label} bar chart">
      <title>${metricMeta[key].definition}</title>
      <line class="${domainMin < 0 ? "zero-line" : "axis-line"}" x1="${zeroX}" x2="${zeroX}" y1="8" y2="${height - 12}"></line>
      ${rows}
    </svg>`;
}

function legendHtml() {
  return `
    <div class="legend">
      <span title="Digital insurance peers"><i style="background:${sectorColors.Insurtech}"></i>Insurtech</span>
      <span title="Real-estate operators and REIT comparables"><i style="background:${sectorColors["REIT / Proptech"]}"></i>REIT / Proptech</span>
      <span title="Specialty insurance and risk-management comparator"><i style="background:${sectorColors["Specialty Insurance"]}"></i>Specialty Insurance</span>
    </div>`;
}

function renderScatter(companies) {
  if (!companies.length) {
    document.getElementById("scatter-chart").innerHTML = `<div class="empty-state">No companies match the current filters.</div>`;
    return;
  }
  const width = 920;
  const height = 500;
  const margin = { top: 28, right: 36, bottom: 58, left: 70 };
  const minX = Math.min(0, ...companies.map((company) => metrics(company).revenue_growth_pct)) - 4;
  const maxX = Math.max(...companies.map((company) => metrics(company).revenue_growth_pct)) + 8;
  const minY = Math.min(...companies.map((company) => metrics(company).net_margin_pct)) - 16;
  const maxY = Math.max(...companies.map((company) => metrics(company).net_margin_pct)) + 14;
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const x = (value) => margin.left + ((value - minX) / (maxX - minX)) * plotW;
  const y = (value) => margin.top + (1 - (value - minY) / (maxY - minY)) * plotH;
  const maxRevenue = Math.max(...companies.map((company) => metrics(company).revenue_m));
  const bubbles = companies.map((company) => {
    const m = metrics(company);
    const r = 10 + Math.sqrt(m.revenue_m / maxRevenue) * 26;
    return `
      <g class="company-mark bubble ${rowClass(company.ticker)}" data-ticker="${company.ticker}" tabindex="0">
        <circle cx="${x(m.revenue_growth_pct)}" cy="${y(m.net_margin_pct)}" r="${r}" fill="${sectorColors[company.sector]}" fill-opacity="0.72" stroke="#fff" stroke-width="2"></circle>
        <text x="${x(m.revenue_growth_pct)}" y="${y(m.net_margin_pct) + 4}" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">${company.ticker}</text>
      </g>
    `;
  }).join("");
  document.getElementById("scatter-chart").innerHTML = legendHtml() + `
    <svg id="quadrant-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Revenue growth versus net margin scatter plot">
      <rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" fill="#fbfcff" stroke="#dbe3ee"></rect>
      <line class="threshold-line" x1="${x(10)}" x2="${x(10)}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
      <line class="threshold-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}"></line>
      <text class="source-note" x="${x(10) + 6}" y="${margin.top + 16}">10% growth</text>
      <text class="source-note" x="${margin.left + 8}" y="${y(0) - 8}">0% margin</text>
      <text class="source-note" x="${margin.left + 14}" y="${margin.top + 24}">Stable Operators</text>
      <text class="source-note" x="${x(10) + 16}" y="${margin.top + 24}">Efficient Compounders</text>
      <text class="source-note" x="${margin.left + 14}" y="${height - margin.bottom - 16}">Turnaround Risk</text>
      <text class="source-note" x="${x(10) + 16}" y="${height - margin.bottom - 16}">Growth Bets</text>
      ${bubbles}
      <text class="source-note" x="${margin.left + 14}" y="${height - 36}">${getQuadrantNote()}</text>
      <line class="axis-line" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
      <line class="axis-line" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
      <text class="axis-label" x="${width / 2}" y="${height - 16}" text-anchor="middle">Revenue Growth (%)</text>
      <text class="axis-label" transform="translate(18 ${height / 2}) rotate(-90)" text-anchor="middle">Net Margin (%)</text>
    </svg>`;
  document.getElementById("quadrant-note").value = getQuadrantNote();
}

function renderDeepDive(companies) {
  const select = document.getElementById("company-select");
  const selectedTicker = state.selectedTicker || companies[0].ticker;
  state.selectedTicker = selectedTicker;
  select.innerHTML = companies
    .map((company) => `<option value="${company.ticker}">${company.company} (${company.ticker})</option>`)
    .join("");
  select.value = selectedTicker;
  updateDeepDive(companies, selectedTicker);
}

function updateDeepDive(companies, ticker) {
  const company = companies.find((item) => item.ticker === ticker);
  const m = metrics(company);
  const cards = ["revenue_m", "revenue_growth_pct", "net_margin_pct", "roa_pct", "debt_to_equity"].map((key) => `
    <div class="metric-card">
      <span title="${metricMeta[key].definition}">${metricMeta[key].label}</span>
      <strong>${fmtValue(m[key], metricMeta[key].formatter)}</strong>
      ${benchmarkBadge(company, companies, key)}
    </div>
  `);
  document.getElementById("metric-cards").innerHTML = cards.join("");

  const profile = companyProfile(company, companies);
  document.getElementById("deep-insights").innerHTML = `
    <div class="deep-insight"><span>Profile</span><strong>${profile.label}</strong></div>
    <div class="deep-insight"><span>Peer Rank</span><strong>#${profile.rank} overall</strong></div>
    <div class="deep-insight"><span>Best Metric</span><strong>${profile.best}</strong></div>
    <div class="deep-insight"><span>Watch Item</span><strong>${profile.worst}</strong></div>
    <div class="deep-insight"><span>As of filing</span><strong>${formatDate(company.filing_date)}</strong></div>
  `;
  document.getElementById("analyst-summary").textContent = company.analysis;
  document.getElementById("source-links").innerHTML =
    `<a href="${secCompanyUrl(company.cik)}" target="_blank" rel="noopener">View ${company.ticker} filings on SEC EDGAR</a>`;
  document.getElementById("company-note").value = getCompanyNote(company.ticker);
  renderRadar(companies, company);
}

function companyProfile(company, companies) {
  const scores = Object.keys(metricMeta).filter((key) => key !== "revenue_m").map((key) => ({
    key,
    score: scoreMetric(companies, metrics(company)[key], key, metricMeta[key].lowerBetter),
  }));
  const best = scores.reduce((a, b) => b.score > a.score ? b : a);
  const worst = scores.reduce((a, b) => b.score < a.score ? b : a);
  const ranked = companies
    .map((peer) => ({ ticker: peer.ticker, score: overallScore(peer, companies) }))
    .sort((a, b) => b.score - a.score);
  return {
    best: metricMeta[best.key].label,
    worst: metricMeta[worst.key].label,
    rank: ranked.findIndex((peer) => peer.ticker === company.ticker) + 1,
    label: strategicLabel(company),
  };
}

function strategicLabel(company) {
  const m = metrics(company);
  if (m.net_margin_pct > 30 && m.debt_to_equity < 1) return "Profitable Specialty Leader";
  if (m.revenue_growth_pct > 30 && m.net_margin_pct < 0) return "High Growth / High Burn";
  if (m.net_margin_pct > 0 && m.revenue_growth_pct < 12) return "Stable Property Operator";
  if (m.debt_to_equity > 2) return "Leveraged Turnaround";
  return "Balanced Operator";
}

function overallScore(company, companies) {
  const keys = ["revenue_growth_pct", "net_margin_pct", "roa_pct", "debt_to_equity", "opex_ratio_pct"];
  const values = keys.map((key) => scoreMetric(companies, metrics(company)[key], key, metricMeta[key].lowerBetter));
  return values.reduce((sumValue, value) => sumValue + value, 0) / values.length;
}

function renderRadar(companies, selected) {
  const dimensions = [
    ["Revenue Growth", "revenue_growth_pct", false],
    ["Net Margin", "net_margin_pct", false],
    ["ROA", "roa_pct", false],
    ["OpEx Efficiency", "opex_ratio_pct", true],
  ];
  const scores = dimensions.map(([, key, lowerBetter]) => scoreMetric(companies, metrics(selected)[key], key, lowerBetter));
  const peerScores = dimensions.map(([, key, lowerBetter]) => {
    const peerMetricAverage = averageMetric(companies, key);
    return scoreMetric(companies, peerMetricAverage, key, lowerBetter);
  });
  const width = 430;
  const height = 360;
  const cx = width / 2;
  const cy = 178;
  const radius = 120;
  const grid = [0.25, 0.5, 0.75, 1].map((level) =>
    polygonPoints(dimensions.length, radius * level, cx, cy)
  ).map((points) => `<polygon points="${points}" fill="none" stroke="#dbe3ee"></polygon>`).join("");
  const axes = dimensions.map((dimension, index) => {
    const point = polarPoint(index, dimensions.length, radius, cx, cy);
    const label = polarPoint(index, dimensions.length, radius + 31, cx, cy);
    return `
      <line class="grid-line" x1="${cx}" y1="${cy}" x2="${point.x}" y2="${point.y}"></line>
      <text class="chart-label" x="${label.x}" y="${label.y}" text-anchor="middle">${dimension[0]}</text>
    `;
  }).join("");
  const selectedPoints = scorePolygon(scores, dimensions.length, radius, cx, cy);
  const peerPoints = scorePolygon(peerScores, dimensions.length, radius, cx, cy);
  document.getElementById("radar-chart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Peer-normalized radar chart">
      ${grid}
      ${axes}
      <polygon points="${peerPoints}" fill="#8d98a8" fill-opacity="0.24" stroke="#8d98a8" stroke-width="2"></polygon>
      <polygon points="${selectedPoints}" fill="#2b78d6" fill-opacity="0.30" stroke="#2b78d6" stroke-width="3"></polygon>
      <circle cx="${cx}" cy="${cy}" r="3" fill="#52627b"></circle>
      <text class="source-note" x="56" y="334">Blue: ${selected.ticker}</text>
      <text class="source-note" x="228" y="334">Gray: peer average</text>
    </svg>`;
}

function wireControls(companies, visibleCompanies) {
  document.getElementById("download-csv").onclick = () => downloadCsv(visibleCompanies);
  document.getElementById("export-scatter").onclick = () => exportScatterPng();
  document.getElementById("clear-selection").onclick = () => {
    state.selectedTicker = null;
    state.hoverTicker = null;
    state.compareTickers = [];
    renderDashboard();
  };
  document.getElementById("mode-latest").onclick = () => {
    state.mode = "latest";
    renderDashboard();
  };
  document.getElementById("mode-trend").onclick = () => {
    state.mode = "trend";
    renderDashboard();
  };
  document.getElementById("table-search").oninput = (event) => {
    state.search = event.target.value;
    renderDashboard();
  };
  document.getElementById("company-select").onchange = (event) => selectCompany(event.target.value, true);
  document.getElementById("company-note").oninput = (event) => {
    if (state.selectedTicker) localStorage.setItem(companyNoteKey(state.selectedTicker), event.target.value);
  };
  document.getElementById("quadrant-note").oninput = (event) => {
    localStorage.setItem("dashboard.quadrantNote", event.target.value);
    renderScatter(visibleCompanies);
    updateUrlState();
  };
  document.querySelectorAll("#sector-filters input").forEach((input) => {
    input.onchange = (event) => {
      const sector = event.target.value;
      if (event.target.checked) state.activeSectors.add(sector);
      else if (state.activeSectors.size > 1) state.activeSectors.delete(sector);
      else event.target.checked = true;
      renderDashboard();
    };
  });
  document.querySelectorAll(".sort-button").forEach((button) => {
    button.onclick = () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = key in metricMeta ? "desc" : "asc";
      }
      renderDashboard();
    };
  });
  document.querySelectorAll("[data-ticker]").forEach((element) => {
    const ticker = element.dataset.ticker;
    element.onclick = (event) => {
      if (event.target.closest("a") || event.target.closest("button")) return;
      selectCompany(ticker, true);
    };
    element.onmouseenter = () => {
      state.hoverTicker = ticker;
      renderDashboard();
    };
    element.onmouseleave = () => {
      state.hoverTicker = null;
      renderDashboard();
    };
  });
  document.querySelectorAll("[data-remove-compare]").forEach((button) => {
    button.onclick = () => {
      state.compareTickers = state.compareTickers.filter((ticker) => ticker !== button.dataset.removeCompare);
      renderDashboard();
    };
  });
  document.querySelector("[data-clear-compare]")?.addEventListener("click", () => {
    state.compareTickers = [];
    renderDashboard();
  });
}

function selectCompany(ticker, addCompare) {
  state.selectedTicker = ticker;
  if (addCompare && !state.compareTickers.includes(ticker)) {
    state.compareTickers = [...state.compareTickers, ticker].slice(-3);
  }
  renderDashboard();
}

function rowClass(ticker) {
  return [
    isSelected(ticker) ? "is-selected" : "",
    state.hoverTicker === ticker ? "is-hovered" : "",
    state.compareTickers.includes(ticker) ? "is-compared" : "",
  ].filter(Boolean).join(" ");
}

function isSelected(ticker) {
  return state.selectedTicker === ticker;
}

function downloadCsv(companies) {
  const header = [
    "Company",
    "Ticker",
    "Sector",
    "Revenue ($M)",
    "Revenue Growth (%)",
    "Net Margin (%)",
    "ROA (%)",
    "Debt/Equity",
    "OpEx Ratio (%)",
    "Fiscal Year",
    "Filing Date",
    "SEC URL",
  ];
  const rows = companies.map((company) => {
    const m = metrics(company);
    return [
      company.company,
      company.ticker,
      company.sector,
      m.revenue_m,
      m.revenue_growth_pct,
      m.net_margin_pct,
      m.roa_pct,
      m.debt_to_equity,
      m.opex_ratio_pct,
      m.fiscal_year,
      company.filing_date,
      secCompanyUrl(company.cik),
    ];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  downloadBlob(csv, `insurtech-proptech-kpis-${state.mode}.csv`, "text/csv");
}

function exportScatterPng() {
  const svg = document.getElementById("quadrant-svg");
  const serialized = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1840;
    canvas.height = 1000;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => downloadBlob(blob, `strategic-quadrant-${state.mode}.png`, "image/png"));
  };
  image.src = url;
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function hydrateStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("mode")) state.mode = params.get("mode") === "trend" ? "trend" : "latest";
  if (params.has("selected")) state.selectedTicker = params.get("selected");
  if (params.has("compare")) state.compareTickers = params.get("compare").split(",").filter(Boolean).slice(0, 3);
  if (params.has("search")) state.search = params.get("search");
  if (params.has("sort")) state.sortKey = params.get("sort");
  if (params.has("dir")) state.sortDir = params.get("dir") === "asc" ? "asc" : "desc";
  if (params.has("sectors")) {
    const sectors = params.get("sectors").split(",").map(decodeURIComponent);
    state.activeSectors = new Set(sectors.filter((sector) => sectorColors[sector]));
    if (!state.activeSectors.size) state.activeSectors = new Set(Object.keys(sectorColors));
  }
}

function updateUrlState() {
  const params = new URLSearchParams();
  params.set("mode", state.mode);
  if (state.selectedTicker) params.set("selected", state.selectedTicker);
  if (state.compareTickers.length) params.set("compare", state.compareTickers.join(","));
  if (state.search) params.set("search", state.search);
  if (state.sortKey !== "revenue_m") params.set("sort", state.sortKey);
  if (state.sortDir !== "desc") params.set("dir", state.sortDir);
  if (state.activeSectors.size !== Object.keys(sectorColors).length) {
    params.set("sectors", [...state.activeSectors].map(encodeURIComponent).join(","));
  }
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", next);
}

function metricGradient(key, value) {
  if (!Number.isFinite(value)) return "#f4f6fa";
  const ranges = {
    revenue_m: [200, 2500],
    revenue_growth_pct: [0, 75],
    net_margin_pct: [-130, 55],
    roa_pct: [-18, 10],
    debt_to_equity: [-4, 3.3],
    opex_ratio_pct: [25, 225],
  };
  const lowerIsBetter = key === "debt_to_equity" || key === "opex_ratio_pct";
  const [min, max] = ranges[key];
  const score = clamp((value - min) / (max - min), 0, 1);
  const adjusted = lowerIsBetter ? 1 - score : score;
  const hue = 4 + adjusted * 132;
  const light = 88 - adjusted * 12;
  return `hsl(${hue} 72% ${light}%)`;
}

function scoreMetric(companies, value, key, lowerBetter) {
  const values = companies.map((company) => metrics(company)[key]).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(value) || max === min) return 50;
  const raw = ((value - min) / (max - min)) * 100;
  return lowerBetter ? 100 - raw : raw;
}

function percentileRank(companies, company, key) {
  return Math.round(scoreMetric(companies, metrics(company)[key], key, metricMeta[key].lowerBetter));
}

function scorePolygon(scores, count, radius, cx, cy) {
  return scores
    .map((score, index) => polarPoint(index, count, radius * (score / 100), cx, cy))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function polygonPoints(count, radius, cx, cy) {
  return Array.from({ length: count }, (_, index) => polarPoint(index, count, radius, cx, cy))
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
}

function polarPoint(index, count, radius, cx, cy) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return {
    x: Number((cx + Math.cos(angle) * radius).toFixed(2)),
    y: Number((cy + Math.sin(angle) * radius).toFixed(2)),
  };
}

function averageMetric(companies, key) {
  return averageRaw(companies.map((company) => metrics(company)), key);
}

function averageRaw(items, key, digits = 1) {
  const values = items.map((item) => item[key]).filter(Number.isFinite);
  if (!values.length) return null;
  return round(values.reduce((sumValue, value) => sumValue + value, 0) / values.length, digits);
}

function median(companies, key) {
  const values = companies.map((company) => metrics(company)[key]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : round((values[mid - 1] + values[mid]) / 2, key === "debt_to_equity" ? 2 : 1);
}

function sum(companies, key) {
  return round(companies.reduce((total, company) => total + (metrics(company)[key] || 0), 0), 1);
}

function maxBy(companies, key) {
  return companies.reduce((best, company) => metrics(company)[key] > metrics(best)[key] ? company : best);
}

function signedDelta(value, formatter) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatter(value)} vs base`;
}

function medianDelta(companies, company, key) {
  const value = metrics(company)[key] - median(companies, key);
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${metricMeta[key].formatter(value)} vs median`;
}

function redScale(value, min, max) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return `hsl(${18 - t * 12} 72% ${64 - t * 20}%)`;
}

function getCompanyNote(ticker) {
  return localStorage.getItem(companyNoteKey(ticker)) || "";
}

function companyNoteKey(ticker) {
  return `dashboard.note.${ticker}`;
}

function getQuadrantNote() {
  return localStorage.getItem("dashboard.quadrantNote") || "";
}

function secCompanyUrl(cik) {
  return `https://www.sec.gov/edgar/browse/?CIK=${String(cik).replace(/^0+/, "")}`;
}

function formatDate(value) {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
