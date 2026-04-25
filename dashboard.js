const fmtMoney = (value) => `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
const fmtPct = (value) => `${Number(value).toFixed(1)}%`;
const fmtRatio = (value) => `${Number(value).toFixed(2)}x`;

const sectorColors = {
  "Insurtech": "#2b78d6",
  "REIT / Proptech": "#6f8f3d",
  "Specialty Insurance": "#14915f",
};

const metricMeta = {
  revenue_growth_pct: { label: "Revenue Growth", formatter: fmtPct, lowerBetter: false },
  net_margin_pct: { label: "Net Margin", formatter: fmtPct, lowerBetter: false },
  roa_pct: { label: "ROA", formatter: fmtPct, lowerBetter: false },
  debt_to_equity: { label: "Debt/Equity", formatter: fmtRatio, lowerBetter: true },
  opex_ratio_pct: { label: "OpEx Efficiency", formatter: fmtPct, lowerBetter: true },
};

let dashboardData;
let activeSectors = new Set(Object.keys(sectorColors));

fetch("data/sec_company_fundamentals.json")
  .then((response) => response.json())
  .then((data) => {
    dashboardData = data;
    renderDashboard();
  })
  .catch((error) => {
    document.body.innerHTML = `<main><div class="info-box"><p>Unable to load SEC dataset: ${error.message}</p></div></main>`;
  });

function renderDashboard() {
  const companies = dashboardData.companies;
  const visibleCompanies = companies.filter((company) => activeSectors.has(company.sector));
  const meta = dashboardData.metadata;
  document.getElementById("subtitle").textContent =
    `${meta.source} | Prepared by ${meta.prepared_by} | ${meta.school}`;
  document.getElementById("data-freshness").textContent = formatDate(meta.generated_on);
  document.getElementById("methodology-date").textContent =
    `Dataset generated on ${formatDate(meta.generated_on)} from SEC EDGAR companyfacts.`;
  document.querySelector(".header-stat strong").textContent = `${visibleCompanies.length} of ${companies.length} shown`;

  renderTopStats(companies);
  renderSectorFilters(companies);
  renderTakeaways(companies);
  renderMarketSummary(companies);
  renderTable(visibleCompanies);
  renderBarCharts(visibleCompanies);
  renderScatter(visibleCompanies);
  renderDeepDive(visibleCompanies, companies);
  wireExports(companies);
}

function metrics(company) {
  return company.metrics;
}

function renderTopStats(companies) {
  const totalRevenue = sum(companies, "revenue_m");
  const avgGrowth = average(companies, "revenue_growth_pct");
  const avgMargin = average(companies, "net_margin_pct");
  const latestFy = Math.max(...companies.map((company) => metrics(company).fiscal_year));
  const cards = [
    ["Peer Revenue", fmtMoney(totalRevenue), "Latest annual revenue"],
    ["Average Growth", fmtPct(avgGrowth), "YoY revenue growth"],
    ["Average Margin", fmtPct(avgMargin), "Net income / revenue"],
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
  const container = document.getElementById("sector-filters");
  container.innerHTML = sectors
    .map((sector) => `
      <label class="filter-chip">
        <input type="checkbox" value="${sector}" ${activeSectors.has(sector) ? "checked" : ""}>
        <span>${sector}</span>
      </label>
    `)
    .join("");

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", (event) => {
      const sector = event.target.value;
      if (event.target.checked) {
        activeSectors.add(sector);
      } else if (activeSectors.size > 1) {
        activeSectors.delete(sector);
      } else {
        event.target.checked = true;
      }
      renderDashboard();
    });
  });
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
    .map((item) => `<span class="takeaway">${item}</span>`)
    .join("");
}

function renderMarketSummary(companies) {
  const nmi = companies.find((company) => company.ticker === "NMIH");
  const hippo = companies.find((company) => company.ticker === "HIPO");
  const insurtechs = companies.filter((company) => company.sector === "Insurtech");
  const reits = companies.filter((company) => company.sector === "REIT / Proptech");
  const insurtechGrowth = average(insurtechs, "revenue_growth_pct");
  const insurtechMargin = average(insurtechs, "net_margin_pct");
  const reitGrowth = average(reits, "revenue_growth_pct");
  const reitMargin = average(reits, "net_margin_pct");
  const text =
    `Across this SEC 10-K peer group, NMI Holdings is the strongest performer: it combines ${fmtPct(metrics(nmi).net_margin_pct)} net margin, ${fmtPct(metrics(nmi).roa_pct)} ROA, and conservative ${fmtRatio(metrics(nmi).debt_to_equity)} leverage. Hippo is the weakest, despite ${fmtPct(metrics(hippo).revenue_growth_pct)} revenue growth, because its ${fmtPct(metrics(hippo).net_margin_pct)} net margin shows that losses remain severe relative to scale. The broader pattern is a clear growth-versus-profitability divide: insurtechs average ${fmtPct(insurtechGrowth)} growth but ${fmtPct(insurtechMargin)} net margin, while REIT and rental-property peers grow closer to ${fmtPct(reitGrowth)} with a positive ${fmtPct(reitMargin)} margin profile. Overall, the market is rewarding companies that can pair growth with disciplined loss control, efficient operations, and a credible path to durable profitability.`;
  document.getElementById("market-summary").textContent = text;
}

function renderTable(companies) {
  const tbody = document.getElementById("kpi-table");
  tbody.innerHTML = companies.map((company) => {
    const m = metrics(company);
    const sectorColor = sectorColors[company.sector];
    return `
      <tr>
        <td><strong>${company.company}</strong></td>
        <td><span class="ticker-pill" style="background:${sectorColor}">${company.ticker}</span></td>
        <td>${company.sector}</td>
        ${metricCell(m.revenue_m, "revenue_m", fmtMoney)}
        ${metricCell(m.revenue_growth_pct, "revenue_growth_pct", fmtPct)}
        ${metricCell(m.net_margin_pct, "net_margin_pct", fmtPct)}
        ${metricCell(m.roa_pct, "roa_pct", fmtPct)}
        ${metricCell(m.debt_to_equity, "debt_to_equity", fmtRatio)}
        ${metricCell(m.opex_ratio_pct, "opex_ratio_pct", fmtPct)}
      </tr>
    `;
  }).join("");
}

function metricCell(value, key, formatter) {
  return `<td style="background:${metricGradient(key, value)}">${formatter(value)}</td>`;
}

function metricGradient(key, value) {
  const ranges = {
    revenue_m: [200, 2500],
    revenue_growth_pct: [0, 75],
    net_margin_pct: [-130, 55],
    roa_pct: [-18, 10],
    debt_to_equity: [0.5, 3.3],
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

function renderBarCharts(companies) {
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
    color: (company) => redScale(metrics(company).debt_to_equity, 0.5, 3.3),
    min: 0,
  });
}

function renderHorizontalBars({ id, companies, key, formatter, color, min }) {
  const max = Math.max(...companies.map((company) => metrics(company)[key]));
  const width = 720;
  const rowH = 42;
  const left = 132;
  const right = 92;
  const top = 20;
  const height = top + companies.length * rowH + 20;
  const chartW = width - left - right;
  const domainMin = min;
  const domainMax = max === min ? max + 1 : max;
  const zeroX = left + ((0 - domainMin) / (domainMax - domainMin)) * chartW;
  const rows = companies.map((company, index) => {
    const value = metrics(company)[key];
    const x1 = left + ((Math.min(value, 0) - domainMin) / (domainMax - domainMin)) * chartW;
    const x2 = left + ((Math.max(value, 0) - domainMin) / (domainMax - domainMin)) * chartW;
    const y = top + index * rowH + 7;
    return `
      <text class="chart-label" x="0" y="${y + 15}">${company.ticker}</text>
      <rect x="${Math.min(x1, x2)}" y="${y}" width="${Math.max(3, Math.abs(x2 - x1))}" height="22" rx="5" fill="${color(company)}"></rect>
      <text class="chart-value" x="${x2 + (value >= 0 ? 8 : -8)}" y="${y + 15}" text-anchor="${value >= 0 ? "start" : "end"}">${formatter(value)}</text>
    `;
  }).join("");
  document.getElementById(id).innerHTML = legendHtml() + `
    <svg viewBox="0 0 ${width} ${height}" role="img">
      <line class="${domainMin < 0 ? "zero-line" : "axis-line"}" x1="${zeroX}" x2="${zeroX}" y1="8" y2="${height - 12}"></line>
      ${rows}
    </svg>`;
}

function legendHtml() {
  return `
    <div class="legend">
      <span><i style="background:${sectorColors.Insurtech}"></i>Insurtech</span>
      <span><i style="background:${sectorColors["REIT / Proptech"]}"></i>REIT / Proptech</span>
      <span><i style="background:${sectorColors["Specialty Insurance"]}"></i>Specialty Insurance</span>
    </div>`;
}

function renderScatter(companies) {
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
      <circle cx="${x(m.revenue_growth_pct)}" cy="${y(m.net_margin_pct)}" r="${r}" fill="${sectorColors[company.sector]}" fill-opacity="0.72" stroke="#fff" stroke-width="2"></circle>
      <text x="${x(m.revenue_growth_pct)}" y="${y(m.net_margin_pct) + 4}" text-anchor="middle" fill="#fff" font-size="12" font-weight="800">${company.ticker}</text>
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
      <line class="axis-line" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
      <line class="axis-line" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}"></line>
      <text class="axis-label" x="${width / 2}" y="${height - 16}" text-anchor="middle">Revenue Growth (%)</text>
      <text class="axis-label" transform="translate(18 ${height / 2}) rotate(-90)" text-anchor="middle">Net Margin (%)</text>
    </svg>`;
}

function renderDeepDive(visibleCompanies, allCompanies) {
  const select = document.getElementById("company-select");
  const previousTicker = select.value;
  select.innerHTML = visibleCompanies
    .map((company) => `<option value="${company.ticker}">${company.company} (${company.ticker})</option>`)
    .join("");
  const fallbackTicker = visibleCompanies.some((company) => company.ticker === previousTicker)
    ? previousTicker
    : visibleCompanies[0].ticker;
  select.value = fallbackTicker;
  select.onchange = () => updateDeepDive(visibleCompanies, allCompanies, select.value);
  updateDeepDive(visibleCompanies, allCompanies, select.value);
}

function updateDeepDive(visibleCompanies, allCompanies, ticker) {
  const company = allCompanies.find((item) => item.ticker === ticker);
  const m = metrics(company);
  const cards = [
    ["Revenue", fmtMoney(m.revenue_m)],
    ["Revenue Growth", fmtPct(m.revenue_growth_pct)],
    ["Net Margin", fmtPct(m.net_margin_pct)],
    ["ROA", fmtPct(m.roa_pct)],
    ["D/E", fmtRatio(m.debt_to_equity)],
  ];
  document.getElementById("metric-cards").innerHTML = cards
    .map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  const profile = companyProfile(company, allCompanies);
  document.getElementById("deep-insights").innerHTML = `
    <div class="deep-insight"><span>Profile</span><strong>${profile.label}</strong></div>
    <div class="deep-insight"><span>Peer Rank</span><strong>#${profile.rank} overall</strong></div>
    <div class="deep-insight"><span>Best Metric</span><strong>${profile.best}</strong></div>
    <div class="deep-insight"><span>Watch Item</span><strong>${profile.worst}</strong></div>
  `;
  document.getElementById("analyst-summary").textContent = company.analysis;
  document.getElementById("source-links").innerHTML =
    `<a href="${secCompanyUrl(company.cik)}" target="_blank" rel="noopener">View ${company.ticker} filings on SEC EDGAR</a>`;
  renderRadar(allCompanies, company);
}

function companyProfile(company, companies) {
  const scores = Object.keys(metricMeta).map((key) => ({
    key,
    score: scoreMetric(companies, metrics(company)[key], key, metricMeta[key].lowerBetter),
  }));
  const best = scores.reduce((a, b) => b.score > a.score ? b : a);
  const worst = scores.reduce((a, b) => b.score < a.score ? b : a);
  const ranked = companies
    .map((peer) => ({
      ticker: peer.ticker,
      score: overallScore(peer, companies),
    }))
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
  const keys = Object.keys(metricMeta);
  return average(keys.map((key) => ({
    metrics: { score: scoreMetric(companies, metrics(company)[key], key, metricMeta[key].lowerBetter) },
  })), "score");
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
    const peerMetricAverage = average(companies, key);
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

function wireExports(companies) {
  document.getElementById("download-csv").onclick = () => downloadCsv(companies);
  document.getElementById("export-scatter").onclick = () => exportScatterPng();
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
      secCompanyUrl(company.cik),
    ];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  downloadBlob(csv, "insurtech-proptech-kpis.csv", "text/csv");
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
    canvas.toBlob((blob) => {
      downloadBlob(blob, "strategic-quadrant.png", "image/png");
    });
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

function scoreMetric(companies, value, key, lowerBetter) {
  const values = companies.map((company) => metrics(company)[key]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 50;
  const raw = ((value - min) / (max - min)) * 100;
  return lowerBetter ? 100 - raw : raw;
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

function average(items, key) {
  const values = items.map((item) => metrics(item)[key]).filter((value) => Number.isFinite(value));
  return values.reduce((sumValue, value) => sumValue + value, 0) / values.length;
}

function sum(companies, key) {
  return companies.reduce((total, company) => total + metrics(company)[key], 0);
}

function maxBy(companies, key) {
  return companies.reduce((best, company) => metrics(company)[key] > metrics(best)[key] ? company : best);
}

function redScale(value, min, max) {
  const t = clamp((value - min) / (max - min), 0, 1);
  return `hsl(${18 - t * 12} 72% ${64 - t * 20}%)`;
}

function secCompanyUrl(cik) {
  return `https://www.sec.gov/edgar/browse/?CIK=${String(cik).replace(/^0+/, "")}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
