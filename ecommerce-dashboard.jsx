// ============================================================================
// HG Aesthetics EU - E-commerce Performance Dashboard
// CDN-based React 18 + Recharts 2.5 + Tailwind CSS
// ============================================================================

// Recharts loaded check (silent in production)

var _RC = (typeof Recharts !== 'undefined') ? Recharts : {};
const {
  ComposedChart, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} = _RC;

// === CONFIGURATION ===

const AMAZON_SHEET_ID = '1i1XUiFWbqPaIRvwrHstSuttaBC933IeaZDN9VNEqiRs';
const BOL_SHEET_ID = '1OJL6fO4egCFCAVMSnxtbZKBkPzzGfzeZwbPtzLSSaDo';
const BOL_SCORECARD_GID = 1258148524;

const MARKETPLACE_COLORS = {
  'Bol': '#3B82F6',
  'AMZ - NL': '#10B981',
  'AMZ - FR': '#8B5CF6',
  'AMZ - DE': '#F59E0B',
  'AMZ - IT': '#EF4444',
  'AMZ - ES': '#EC4899',
  'AMZ - BE': '#06B6D4',
};

const MARKETPLACE_FLAGS = {
  'Bol': '\uD83C\uDDF3\uD83C\uDDF1',
  'AMZ - NL': '\uD83C\uDDF3\uD83C\uDDF1',
  'AMZ - FR': '\uD83C\uDDEB\uD83C\uDDF7',
  'AMZ - DE': '\uD83C\uDDE9\uD83C\uDDEA',
  'AMZ - IT': '\uD83C\uDDEE\uD83C\uDDF9',
  'AMZ - ES': '\uD83C\uDDEA\uD83C\uDDF8',
  'AMZ - BE': '\uD83C\uDDE7\uD83C\uDDEA',
};

const METRIC_KEYS = [
  'totalSales', 'pctChange', 'salesFromAds', 'adSpend',
  'roas', 'adSpendPct', 'totalOrders', 'totalUnits', 'aov'
];

const METRIC_LABELS = {
  'Total Sales': 'totalSales',
  '% Change by Last Week': 'pctChange',
  'Sales from Ads': 'salesFromAds',
  'Ad Spend': 'adSpend',
  'ROAS': 'roas',
  'Ad Spend %': 'adSpendPct',
  'Total Orders': 'totalOrders',
  'Total Units': 'totalUnits',
  'AOV': 'aov',
};

const PERIOD_OPTIONS = [
  { value: 'current', label: 'Current Week' },
  { value: 'last', label: 'Last Week' },
  { value: '4weeks', label: 'Last 4 Weeks' },
  { value: '8weeks', label: 'Last 8 Weeks' },
  { value: '13weeks', label: 'Last 13 Weeks' },
  { value: 'ytd2026', label: 'YTD 2026' },
  { value: 'ytd2025', label: 'Full 2025' },
  { value: 'all', label: 'All Time' },
];

// === DATA PARSING UTILITIES (gviz format -> 2D arrays) ===

// Parse gviz JSON response (strips wrapper, returns parsed JSON)
function parseGvizResponse(text) {
  var startIdx = text.indexOf('{');
  var endIdx = text.lastIndexOf('}');
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error('Invalid gviz response: no JSON found');
  }
  return JSON.parse(text.substring(startIdx, endIdx + 1));
}

// Convert gviz table to 2D array (same format as Sheets API v4)
function gvizToRows(gvizJson) {
  if (!gvizJson || !gvizJson.table) return [];
  var table = gvizJson.table;
  var rows = [];
  if (!table.rows) return rows;
  for (var r = 0; r < table.rows.length; r++) {
    var gvizRow = table.rows[r];
    var row = [];
    if (gvizRow.c) {
      for (var c = 0; c < gvizRow.c.length; c++) {
        var cell = gvizRow.c[c];
        row.push(cell && cell.v !== undefined && cell.v !== null ? cell.v : null);
      }
    }
    rows.push(row);
  }
  return rows;
}

function cleanNumericValue(cellValue) {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;
  if (typeof cellValue === 'number') return cellValue;
  var str = String(cellValue);
  str = str.replace(/[€%,\s]/g, '');
  var num = parseFloat(str);
  return isNaN(num) ? null : num;
}

// rows = 2D array (from gviz). Row 0 = header with title + year values.
function extractWeekLabels(rows, dataStartCol) {
  if (!rows || rows.length < 1) return [];
  var headerRow = rows[0];
  if (!headerRow) return [];

  var labels = [];
  var currentYear = null;
  var weekCounter = 0;

  for (var col = dataStartCol; col < headerRow.length; col++) {
    var yearVal = headerRow[col];
    if (yearVal === null || yearVal === undefined || yearVal === '') {
      labels.push(null);
      continue;
    }
    var year = parseInt(yearVal);
    if (isNaN(year)) {
      labels.push(null);
      continue;
    }
    if (year !== currentYear) {
      currentYear = year;
      weekCounter = 1;
    } else {
      weekCounter++;
    }
    labels.push({ label: 'W' + weekCounter + " '" + String(year).slice(2), year: year, week: weekCounter });
  }
  return labels;
}

// row = flat array of cell values (one row from gviz 2D array)
function extractRowValues(row, dataStartCol, weekLabels) {
  var values = [];
  if (!row) return values;

  for (var i = 0; i < weekLabels.length; i++) {
    var col = dataStartCol + i;
    if (!weekLabels[i]) continue;
    var cellVal = col < row.length ? row[col] : null;
    var val = cleanNumericValue(cellVal);
    values.push({
      weekLabel: weekLabels[i].label,
      year: weekLabels[i].year,
      week: weekLabels[i].week,
      value: val,
      index: i,
    });
  }
  return values;
}

// rows = 2D array (from gviz). Row 0 = year headers. Row 1+ = data. Col 0 = marketplace, Col 1 = metric, Col 2+ = weekly data
function parseMarketplaceSheet(rows, dataStartCol) {
  var weekLabels = extractWeekLabels(rows, dataStartCol);
  var validLabels = weekLabels.filter(function(l) { return l !== null; });

  var marketplaces = {};
  var currentName = null;

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    if (!row || row.length === 0) continue;

    var colA = row[0];
    var colB = row[1];

    if (colA && String(colA).trim() !== '') {
      currentName = String(colA).trim();
      if (!marketplaces[currentName]) {
        marketplaces[currentName] = {};
      }
    }

    if (colB && currentName) {
      var metricLabel = String(colB).trim();
      var metricKey = METRIC_LABELS[metricLabel];
      if (metricKey) {
        marketplaces[currentName][metricKey] = extractRowValues(row, dataStartCol, weekLabels);
      }
    }
  }

  return { marketplaces: marketplaces, weekLabels: validLabels };
}

function filterByPeriod(weeklyValues, period, allWeekLabels) {
  if (!weeklyValues || weeklyValues.length === 0) return [];

  const validValues = weeklyValues.filter(v => v.value !== null);
  if (validValues.length === 0) return [];

  switch (period) {
    case 'current': return validValues.slice(-1);
    case 'last': return validValues.length >= 2 ? validValues.slice(-2, -1) : validValues.slice(-1);
    case '4weeks': return validValues.slice(-4);
    case '8weeks': return validValues.slice(-8);
    case '13weeks': return validValues.slice(-13);
    case 'ytd2026': return validValues.filter(v => v.year === 2026);
    case 'ytd2025': return validValues.filter(v => v.year === 2025);
    case 'all': return validValues;
    default: return validValues.slice(-4);
  }
}

function sumValues(weeklyValues) {
  return weeklyValues.reduce((sum, v) => sum + (v.value || 0), 0);
}

function avgValues(weeklyValues) {
  const valid = weeklyValues.filter(v => v.value !== null && v.value > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, v) => sum + v.value, 0) / valid.length;
}

// === EXPORT PDF ===

async function exportToPDF() {
  const el = document.getElementById('dashboard-content');
  if (!el) return;
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#F9FAFB',
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jspdf.jsPDF('landscape', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 20;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 10;

    pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - 20);

    while (heightLeft > 0) {
      pdf.addPage();
      position = -(imgHeight - heightLeft) + 10;
      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 20);
    }

    pdf.save(`HG-Aesthetics-Report-${new Date().toISOString().split('T')[0]}.pdf`);
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('PDF export failed. Please try again.');
  }
}

// === SUB-COMPONENTS ===

function KPICard({ title, value, prefix, suffix, change, icon, color, borderColor }) {
  const isPositive = change > 0;
  const changeColor = isPositive ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-500';
  const changeIcon = isPositive ? '\u2191' : change < 0 ? '\u2193' : '\u2014';

  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 p-5 hover:shadow-md transition ${borderColor}`}>
      <div className="flex justify-between items-start mb-3">
        <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{title}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${color}`}>
          {icon}
        </div>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-2">
        {prefix}{typeof value === 'number' ? value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}{suffix}
      </h3>
      {change !== null && change !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium ${changeColor}`}>
          <span>{changeIcon}</span>
          <span>{Math.abs(change).toFixed(1)}% vs prev week</span>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children, fullWidth, subtitle }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm p-5 ${fullWidth ? 'col-span-1 lg:col-span-2' : ''}`}>
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-800">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function SortableTable({ data, columns, sortKey, sortDir, onSort }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {columns.map(col => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <span className="text-blue-500">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((row, idx) => (
            <tr key={idx} className={`hover:bg-gray-50 ${row.isTotal ? (row.name === 'Grand Total' ? 'bg-gray-100 font-bold border-t-2 border-gray-300' : 'bg-gray-50 font-semibold border-t border-gray-200') : ''}`}>
              {columns.map(col => (
                <td key={col.key} className="px-4 py-3 whitespace-nowrap">
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// === CUSTOM TOOLTIP ===

function EuroTooltip({ active, payload, label }) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white shadow-lg rounded-lg border border-gray-200 p-3 text-sm">
      <p className="font-medium text-gray-800 mb-1">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} style={{ color: entry.color }} className="flex justify-between gap-4">
          <span>{entry.name}:</span>
          <span className="font-medium">
            {entry.name.includes('ROAS') || entry.name.includes('Orders') || entry.name.includes('Units')
              ? (entry.value != null ? entry.value.toFixed(2) : '0')
              : ('\u20AC' + (entry.value != null ? entry.value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0'))
            }
          </span>
        </p>
      ))}
    </div>
  );
}

// === MAIN DASHBOARD COMPONENT ===

function EcommerceDashboard() {
  const [rawData, setRawData] = React.useState(null);
  const [bolProducts, setBolProducts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [lastUpdate, setLastUpdate] = React.useState(null);
  const [selectedPeriod, setSelectedPeriod] = React.useState('8weeks');
  const [activeTab, setActiveTab] = React.useState('overview');
  const [tableSortKey, setTableSortKey] = React.useState('revenue');
  const [tableSortDir, setTableSortDir] = React.useState('desc');
  const [exporting, setExporting] = React.useState(false);

  // --- Data Fetching (gviz endpoint - no API key needed) ---

  const fetchGviz = async (spreadsheetId, params, label) => {
    var url = 'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/gviz/tq?tqx=out:json' + (params || '');
    var res;
    try {
      res = await fetch(url);
    } catch (fetchErr) {
      console.error('[FETCH] Network error for ' + label + ':', fetchErr);
      return { _error: label + ' network error: ' + fetchErr.message };
    }
    if (!res.ok) {
      var errBody = '';
      try { errBody = await res.text(); } catch(e) {}
      console.error('[FETCH] ' + label + ' error body:', errBody.substring(0, 300));
      return { _error: label + ' HTTP ' + res.status + (res.redirected ? ' (redirected to ' + res.url + ')' : '') };
    }
    var text;
    try {
      text = await res.text();
    } catch (e) {
      return { _error: label + ' read error: ' + e.message };
    }
    try {
      var gviz = parseGvizResponse(text);
      if (gviz.status !== 'ok') {
        return { _error: label + ' gviz status: ' + gviz.status };
      }
      var rows = gvizToRows(gviz);
      return rows;
    } catch (parseErr) {
      console.error('[FETCH] ' + label + ' parse error:', parseErr, 'First 200 chars:', text.substring(0, 200));
      return { _error: label + ' parse error: ' + parseErr.message };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all 3 sheets in parallel (no metadata step needed)
      var dataResults = await Promise.all([
        fetchGviz(BOL_SHEET_ID, '&gid=' + BOL_SCORECARD_GID, 'BOL Scorecard'),
        fetchGviz(BOL_SHEET_ID, '&sheet=Product%20Listing', 'BOL Products'),
        fetchGviz(AMAZON_SHEET_ID, '', 'Amazon Scorecard'),
      ]);

      var bolScoreRows = dataResults[0];
      var bolProdRows = dataResults[1];
      var amazonRows = dataResults[2];

      // BOL scorecard is required
      if (!bolScoreRows || bolScoreRows._error) {
        throw new Error(bolScoreRows ? bolScoreRows._error : 'BOL Scorecard fetch returned empty');
      }

      var bolParsed = parseMarketplaceSheet(bolScoreRows, 2);

      // Amazon is optional - merge if available
      var amazonParsed = { marketplaces: {}, weekLabels: [] };
      if (amazonRows && !amazonRows._error && Array.isArray(amazonRows)) {
        amazonParsed = parseMarketplaceSheet(amazonRows, 2);
      } else {
      }

      // Product listing is optional
      var products = [];
      if (bolProdRows && !bolProdRows._error && Array.isArray(bolProdRows)) {
        bolProdRows.slice(1).forEach(function(row) {
          if (row && row[0]) {
            var product = {
              name: row[0] || '',
              sku: row[1] || '',
              status: row[5] || '',
              reason: row[6] || '',
            };
            if (product.reason && String(product.reason).toLowerCase().indexOf('critical stock') >= 0) {
              product.alert = true;
            }
            products.push(product);
          }
        });
      }

      setRawData({ amazon: amazonParsed, bolScore: bolParsed });
      setBolProducts(products);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      console.error('[DASHBOARD] Error:', err);
      setError('Error: ' + (err.message || String(err)));
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 600000);
    return () => clearInterval(interval);
  }, []);

  // --- Derived Data ---
  const dashboardData = React.useMemo(() => {
    if (!rawData) return null;

    const { amazon, bolScore } = rawData;

    // Merge marketplaces: Amazon first, then BOL overwrites (BOL is authoritative for Bol)
    var mp = {};
    // Add Amazon data first
    if (amazon && amazon.marketplaces) {
      Object.keys(amazon.marketplaces).forEach(function(key) {
        mp[key] = amazon.marketplaces[key];
      });
    }
    // BOL overwrites its own marketplace (authoritative source for Bol)
    if (bolScore && bolScore.marketplaces) {
      Object.keys(bolScore.marketplaces).forEach(function(key) {
        mp[key] = bolScore.marketplaces[key];
      });
    }

    // Marketplace list (exclude aggregates for per-marketplace charts)
    // Only include marketplaces that actually have data
    const allPossibleNames = ['Bol', 'AMZ - NL', 'AMZ - FR', 'AMZ - DE', 'AMZ - IT', 'AMZ - ES', 'AMZ - BE'];
    const marketplaceNames = allPossibleNames.filter(function(name) { return mp[name]; });

    // Always compute aggregate from individual marketplaces (don't use pre-computed "All Market Places" row)
    var allMarkets = {};
    var metricsToCombine = ['totalSales', 'salesFromAds', 'adSpend', 'totalOrders', 'totalUnits'];
    metricsToCombine.forEach(function(metric) {
      var combined = [];
      marketplaceNames.forEach(function(name) {
        var data = mp[name];
        if (data && data[metric]) {
          data[metric].forEach(function(entry, idx) {
            if (!combined[idx]) combined[idx] = { weekLabel: entry.weekLabel, year: entry.year, week: entry.week, value: 0, index: entry.index };
            combined[idx].value = (combined[idx].value || 0) + (entry.value || 0);
          });
        }
      });
      allMarkets[metric] = combined;
    });

    // Build filtered weekly data for overview charts
    const filteredAllSales = filterByPeriod(allMarkets.totalSales || [], selectedPeriod);
    const filteredAllAdSpend = filterByPeriod(allMarkets.adSpend || [], selectedPeriod);
    const filteredAllOrders = filterByPeriod(allMarkets.totalOrders || [], selectedPeriod);
    const filteredAllUnits = filterByPeriod(allMarkets.totalUnits || [], selectedPeriod);
    const filteredAllSalesFromAds = filterByPeriod(allMarkets.salesFromAds || [], selectedPeriod);

    // KPI totals
    const totalRevenue = sumValues(filteredAllSales);
    const totalAdSpend = sumValues(filteredAllAdSpend);
    const totalOrders = sumValues(filteredAllOrders);
    const totalUnits = sumValues(filteredAllUnits);
    const totalSalesFromAds = sumValues(filteredAllSalesFromAds);
    const avgRoas = totalAdSpend > 0 ? totalSalesFromAds / totalAdSpend : 0;
    const avgAov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Week-over-week changes
    const getWoWChange = (values) => {
      if (values.length < 2) return null;
      const current = values[values.length - 1].value;
      const prev = values[values.length - 2].value;
      if (!prev || prev === 0) return null;
      return ((current - prev) / prev) * 100;
    };

    // Weekly trend data for charts (combine sales + ad spend)
    const weeklyTrend = filteredAllSales.map((sale, idx) => {
      const adSpendVal = (filteredAllAdSpend[idx] && filteredAllAdSpend[idx].value) || 0;
      const ordersVal = (filteredAllOrders[idx] && filteredAllOrders[idx].value) || 0;
      const unitsVal = (filteredAllUnits[idx] && filteredAllUnits[idx].value) || 0;
      const salesFromAdsVal = (filteredAllSalesFromAds[idx] && filteredAllSalesFromAds[idx].value) || 0;
      return {
        weekLabel: sale.weekLabel,
        revenue: sale.value || 0,
        adSpend: adSpendVal,
        orders: ordersVal,
        units: unitsVal,
        roas: adSpendVal > 0 ? salesFromAdsVal / adSpendVal : 0,
        salesFromAds: salesFromAdsVal,
        organicRevenue: Math.max(0, (sale.value || 0) - salesFromAdsVal),
      };
    });

    // Per-marketplace aggregated data
    const marketplaceData = marketplaceNames.map(name => {
      const data = mp[name] || {};
      const filtSales = filterByPeriod(data.totalSales || [], selectedPeriod);
      const filtAdSpend = filterByPeriod(data.adSpend || [], selectedPeriod);
      const filtOrders = filterByPeriod(data.totalOrders || [], selectedPeriod);
      const filtUnits = filterByPeriod(data.totalUnits || [], selectedPeriod);
      const filtSalesFromAds = filterByPeriod(data.salesFromAds || [], selectedPeriod);
      const filtAov = filterByPeriod(data.aov || [], selectedPeriod);

      const revenue = sumValues(filtSales);
      const adSpend = sumValues(filtAdSpend);
      const orders = sumValues(filtOrders);
      const units = sumValues(filtUnits);
      const salesFromAds = sumValues(filtSalesFromAds);

      return {
        name,
        revenue,
        adSpend,
        roas: adSpend > 0 ? salesFromAds / adSpend : 0,
        orders,
        units,
        aov: orders > 0 ? revenue / orders : 0,
        adSpendPct: revenue > 0 ? (adSpend / revenue) * 100 : 0,
        salesFromAds,
        organicRevenue: Math.max(0, revenue - salesFromAds),
        color: MARKETPLACE_COLORS[name] || '#6B7280',
        weeklyTrend: filtSales.map((s, i) => ({
          weekLabel: s.weekLabel,
          revenue: s.value || 0,
        })),
      };
    });

    // Marketplace ROAS trend for advertising tab
    const roasTrend = filteredAllSales.map((sale, idx) => {
      const entry = { weekLabel: sale.weekLabel };
      marketplaceNames.forEach(name => {
        const data = mp[name] || {};
        const filtRoas = filterByPeriod(data.roas || [], selectedPeriod);
        entry[name] = (filtRoas[idx] && filtRoas[idx].value) || 0;
      });
      return entry;
    });

    // Ad spend trend per marketplace
    const adSpendTrend = filteredAllSales.map((sale, idx) => {
      const entry = { weekLabel: sale.weekLabel };
      marketplaceNames.forEach(name => {
        const data = mp[name] || {};
        const filtAd = filterByPeriod(data.adSpend || [], selectedPeriod);
        entry[name] = (filtAd[idx] && filtAd[idx].value) || 0;
      });
      return entry;
    });

    return {
      totalRevenue, totalAdSpend, totalOrders, totalUnits, totalSalesFromAds, avgRoas, avgAov,
      wowRevenue: getWoWChange(filteredAllSales),
      wowAdSpend: getWoWChange(filteredAllAdSpend),
      wowOrders: getWoWChange(filteredAllOrders),
      wowUnits: getWoWChange(filteredAllUnits),
      weeklyTrend,
      marketplaceData,
      roasTrend,
      adSpendTrend,
    };
  }, [rawData, selectedPeriod, bolProducts]);

  // --- Table sorting ---
  const sortedTableData = React.useMemo(() => {
    if (!dashboardData) return [];
    const data = [...dashboardData.marketplaceData];
    data.sort((a, b) => {
      const aVal = a[tableSortKey] || 0;
      const bVal = b[tableSortKey] || 0;
      return tableSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Compute BOL and Amazon subtotals
    const bolItems = data.filter(m => m.name === 'Bol');
    const amzItems = data.filter(m => m.name.startsWith('AMZ'));

    const makeSubtotal = (items, label) => {
      const rev = items.reduce((s, m) => s + m.revenue, 0);
      const ad = items.reduce((s, m) => s + m.adSpend, 0);
      const sfa = items.reduce((s, m) => s + m.salesFromAds, 0);
      const ord = items.reduce((s, m) => s + m.orders, 0);
      const un = items.reduce((s, m) => s + m.units, 0);
      return {
        name: label, revenue: rev, adSpend: ad, salesFromAds: sfa,
        roas: ad > 0 ? sfa / ad : 0, orders: ord, units: un,
        aov: ord > 0 ? rev / ord : 0,
        adSpendPct: rev > 0 ? (ad / rev) * 100 : 0,
        isTotal: true,
      };
    };

    const bolTotal = makeSubtotal(bolItems, 'BOL Total');
    const amzTotal = makeSubtotal(amzItems, 'Amazon Total');
    const grandTotal = makeSubtotal(data, 'Grand Total');

    // Group: BOL rows, BOL subtotal, Amazon rows, Amazon subtotal, Grand total
    const bolRows = data.filter(m => m.name === 'Bol');
    const amzRows = data.filter(m => m.name.startsWith('AMZ'));
    return [...bolRows, bolTotal, ...amzRows, amzTotal, grandTotal];
  }, [dashboardData, tableSortKey, tableSortDir]);

  const handleSort = (key) => {
    if (tableSortKey === key) {
      setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setTableSortKey(key);
      setTableSortDir('desc');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    await exportToPDF();
    setExporting(false);
  };

  // --- Loading State ---
  if (loading && !rawData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg font-medium">Loading analytics...</p>
          <p className="text-gray-400 text-sm mt-1">Fetching data from Google Sheets</p>
        </div>
      </div>
    );
  }

  // --- Error State ---
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-4xl mb-4">{'\u26A0\uFE0F'}</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Unable to Load Data</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="bg-blue-600 text-white py-2 px-6 rounded-lg hover:bg-blue-700 transition font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!dashboardData) return null;

  // --- Table columns ---
  const tableColumns = [
    { key: 'name', label: 'Marketplace', render: (v, row) => (
      <div className="flex items-center gap-2">
        {!row.isTotal && <span className="text-base">{MARKETPLACE_FLAGS[v] || ''}</span>}
        {!row.isTotal && <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: MARKETPLACE_COLORS[v] || '#6B7280' }}></span>}
        <span className={row.isTotal ? 'font-bold' : ''}>{v}</span>
      </div>
    )},
    { key: 'revenue', label: 'Revenue', render: (v) => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { key: 'salesFromAds', label: 'Sales from Ads', render: (v) => `\u20AC${(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { key: 'adSpend', label: 'Ad Spend', render: (v) => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { key: 'roas', label: 'ROAS', render: (v) => (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
        v >= 1.5 ? 'bg-green-100 text-green-800' :
        v >= 1.0 ? 'bg-amber-100 text-amber-800' :
        'bg-red-100 text-red-800'
      }`}>
        {v.toFixed(2)}
      </span>
    )},
    { key: 'orders', label: 'Orders', render: (v) => v.toLocaleString() },
    { key: 'units', label: 'Units', render: (v) => v.toLocaleString() },
    { key: 'aov', label: 'AOV', render: (v) => `\u20AC${v.toFixed(2)}` },
    { key: 'adSpendPct', label: 'Ad Spend %', render: (v) => (
      <span className={v > 80 ? 'text-red-600 font-medium' : 'text-gray-700'}>
        {v.toFixed(1)}%
      </span>
    )},
  ];

  // --- Pie data ---
  const pieData = dashboardData.marketplaceData
    .filter(m => m.revenue > 0)
    .map(m => ({ name: m.name, value: m.revenue, color: m.color }));

  // --- Ad efficiency (stacked: organic vs ad revenue) ---
  const adEfficiencyData = dashboardData.marketplaceData
    .filter(m => m.revenue > 0)
    .map(m => ({
      name: m.name,
      organicRevenue: m.organicRevenue,
      adRevenue: m.salesFromAds,
    }));

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">HG Aesthetics EU</h1>
              <p className="text-sm text-gray-500">E-commerce Performance Dashboard</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-blue-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {PERIOD_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={fetchData}
                disabled={loading}
                className="flex items-center gap-2 bg-white border border-gray-300 px-3 py-2 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
              >
                <span className={loading ? 'animate-spin' : ''}>&#x21BB;</span>
                <span className="hidden sm:inline">Refresh</span>
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : '\u2193 Export PDF'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 mt-4 border-t border-gray-100 pt-3">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'marketplaces', label: 'Marketplaces' },
              { id: 'advertising', label: 'Advertising' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-2 text-sm transition ${
                  activeTab === tab.id ? 'tab-active' : 'tab-inactive'
                }`}
              >
                {tab.label}
              </button>
            ))}
            {lastUpdate && (
              <span className="ml-auto text-xs text-gray-400 self-center">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div id="dashboard-content" className="max-w-7xl mx-auto px-4 py-6">
        {/* === OVERVIEW TAB === */}
        {activeTab === 'overview' && (
          <div>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
              <KPICard
                title="Total Revenue"
                value={dashboardData.totalRevenue}
                prefix={'\u20AC'}
                change={dashboardData.wowRevenue}
                icon={'\u20AC'}
                color="bg-blue-100 text-blue-600"
                borderColor="border-blue-500"
              />
              <KPICard
                title="Sales from Ads"
                value={dashboardData.totalSalesFromAds}
                prefix={'\u20AC'}
                change={null}
                icon={'\uD83D\uDCB5'}
                color="bg-green-100 text-green-600"
                borderColor="border-green-500"
              />
              <KPICard
                title="Ad Spend"
                value={dashboardData.totalAdSpend}
                prefix={'\u20AC'}
                change={dashboardData.wowAdSpend}
                icon={'\uD83D\uDCE2'}
                color="bg-red-100 text-red-600"
                borderColor="border-red-500"
              />
              <KPICard
                title="Avg ROAS"
                value={dashboardData.avgRoas}
                prefix=""
                change={null}
                icon={'\uD83C\uDFAF'}
                color={dashboardData.avgRoas >= 1.5 ? 'bg-green-100 text-green-600' : dashboardData.avgRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}
                borderColor={dashboardData.avgRoas >= 1.5 ? 'border-green-500' : dashboardData.avgRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'}
              />
              <KPICard
                title="Orders"
                value={dashboardData.totalOrders}
                prefix=""
                suffix=""
                change={dashboardData.wowOrders}
                icon={'\uD83D\uDED2'}
                color="bg-purple-100 text-purple-600"
                borderColor="border-purple-500"
              />
              <KPICard
                title="Units Sold"
                value={dashboardData.totalUnits}
                prefix=""
                suffix=""
                change={dashboardData.wowUnits}
                icon={'\uD83D\uDCE6'}
                color="bg-indigo-100 text-indigo-600"
                borderColor="border-indigo-500"
              />
              <KPICard
                title="Avg AOV"
                value={dashboardData.avgAov}
                prefix={'\u20AC'}
                change={null}
                icon={'\uD83D\uDCB0'}
                color="bg-orange-100 text-orange-600"
                borderColor="border-orange-500"
              />
            </div>

            {/* Revenue & Ad Spend Trend (full width) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <ChartCard title="Revenue & Ad Spend Trend" fullWidth subtitle="Weekly overview of total sales vs advertising spend">
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={dashboardData.weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                    <Tooltip content={<EuroTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" fill="#DBEAFE" stroke="#3B82F6" strokeWidth={2} name="Revenue" />
                    <Bar dataKey="adSpend" fill="#FCA5A5" opacity={0.7} name="Ad Spend" barSize={20} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* 2x2 Chart Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* Marketplace Revenue */}
              <ChartCard title="Revenue by Marketplace" subtitle="Total revenue per marketplace for selected period">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.marketplaceData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" tickFormatter={(v) => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip content={<EuroTooltip />} />
                    <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]}>
                      {dashboardData.marketplaceData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* ROAS by Marketplace */}
              <ChartCard title="ROAS by Marketplace" subtitle="Green >= 1.5 (target) | Amber >= 1.0 (breakeven) | Red < 1.0">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.marketplaceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<EuroTooltip />} />
                    <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="3 3" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                    <ReferenceLine y={1.5} stroke="#10B981" strokeDasharray="3 3" label={{ value: 'Target', position: 'right', fontSize: 10, fill: '#10B981' }} />
                    <Bar dataKey="roas" name="ROAS" radius={[4, 4, 0, 0]}>
                      {dashboardData.marketplaceData.map((entry, idx) => (
                        <Cell key={idx} fill={
                          entry.roas >= 1.5 ? '#10B981' :
                          entry.roas >= 1.0 ? '#F59E0B' :
                          '#EF4444'
                        } />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Ad vs Organic Revenue */}
              <ChartCard title="Ad Revenue vs Organic Revenue" subtitle="How much revenue is ad-driven vs organic per marketplace">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={adEfficiencyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                    <Tooltip content={<EuroTooltip />} />
                    <Legend />
                    <Bar dataKey="organicRevenue" stackId="revenue" fill="#3B82F6" name="Organic Revenue" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="adRevenue" stackId="revenue" fill="#FCA5A5" name="Ad Revenue" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Revenue Distribution Pie */}
              <ChartCard title="Revenue Distribution" subtitle="Share of total revenue by marketplace">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={{ strokeWidth: 1 }}
                    >
                      {pieData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-center -mt-4">
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="text-lg font-bold text-gray-900">{'\u20AC'}{dashboardData.totalRevenue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </ChartCard>
            </div>

            {/* Orders & Units Trend */}
            <div className="grid grid-cols-1 gap-4 mb-4">
              <ChartCard title="Orders & Units Trend" subtitle="Weekly order count and units sold">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={dashboardData.weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<EuroTooltip />} />
                    <Legend />
                    <Bar dataKey="orders" fill="#8B5CF6" name="Orders" barSize={20} opacity={0.8} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="units" stroke="#EC4899" strokeWidth={2} name="Units" dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Top Marketplace Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {dashboardData.marketplaceData.slice(0, 3).map((market, idx) => (
                <div key={idx} className="bg-white rounded-xl shadow-sm p-5 border-t-4" style={{ borderTopColor: market.color }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-800">{market.name}</span>
                    <span className={`text-xs px-2 py-1 rounded font-medium ${
                      idx === 0 ? 'bg-yellow-100 text-yellow-800' :
                      idx === 1 ? 'bg-gray-100 text-gray-700' :
                      'bg-orange-100 text-orange-800'
                    }`}>
                      #{idx + 1}
                    </span>
                  </div>
                  <p className="text-2xl font-bold" style={{ color: market.color }}>
                    {'\u20AC'}{market.revenue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-600">
                    <div>ROAS: <span className={`font-medium ${market.roas >= 1.5 ? 'text-green-600' : market.roas >= 1.0 ? 'text-amber-600' : 'text-red-600'}`}>{market.roas.toFixed(2)}</span></div>
                    <div>Orders: <span className="font-medium text-gray-800">{market.orders}</span></div>
                    <div>Ad Spend: <span className="font-medium text-gray-800">{'\u20AC'}{market.adSpend.toFixed(2)}</span></div>
                    <div>AOV: <span className="font-medium text-gray-800">{'\u20AC'}{market.aov.toFixed(2)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === MARKETPLACES TAB === */}
        {activeTab === 'marketplaces' && (
          <div>
            <div className="bg-white rounded-xl shadow-sm mb-6">
              <div className="p-5 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-800">Marketplace Comparison</h3>
                <p className="text-xs text-gray-500 mt-1">Click column headers to sort. All values for selected period.</p>
              </div>
              <SortableTable
                data={sortedTableData}
                columns={tableColumns}
                sortKey={tableSortKey}
                sortDir={tableSortDir}
                onSort={handleSort}
              />
            </div>

            {/* Per-marketplace detail cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dashboardData.marketplaceData.map((market, idx) => (
                <div key={idx} className="bg-white rounded-xl shadow-sm p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-lg">{MARKETPLACE_FLAGS[market.name] || ''}</span>
                    <span className="w-4 h-4 rounded-full" style={{ backgroundColor: market.color }}></span>
                    <h4 className="font-semibold text-gray-800">{market.name}</h4>
                    <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${
                      market.roas >= 1.5 ? 'bg-green-100 text-green-800' :
                      market.roas >= 1.0 ? 'bg-amber-100 text-amber-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      ROAS {market.roas.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div>
                      <p className="text-xs text-gray-500">Revenue</p>
                      <p className="text-sm font-semibold text-gray-900">{'\u20AC'}{market.revenue.toFixed(0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Ad Spend</p>
                      <p className="text-sm font-semibold text-gray-900">{'\u20AC'}{market.adSpend.toFixed(0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Orders</p>
                      <p className="text-sm font-semibold text-gray-900">{market.orders}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">AOV</p>
                      <p className="text-sm font-semibold text-gray-900">{'\u20AC'}{market.aov.toFixed(2)}</p>
                    </div>
                  </div>
                  {/* Mini revenue trend */}
                  {market.weeklyTrend.length > 1 && (
                    <div className="mt-4">
                      <ResponsiveContainer width="100%" height={60}>
                        <AreaChart data={market.weeklyTrend}>
                          <Area type="monotone" dataKey="revenue" fill={market.color} fillOpacity={0.15} stroke={market.color} strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === ADVERTISING TAB === */}
        {activeTab === 'advertising' && (
          <div>
            {/* Ad KPI Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <KPICard
                title="Total Ad Spend"
                value={dashboardData.totalAdSpend}
                prefix={'\u20AC'}
                change={dashboardData.wowAdSpend}
                icon={'\uD83D\uDCB8'}
                color="bg-red-100 text-red-600"
                borderColor="border-red-500"
              />
              <KPICard
                title="Ad Revenue"
                value={dashboardData.totalSalesFromAds}
                prefix={'\u20AC'}
                change={null}
                icon={'\uD83D\uDCB5'}
                color="bg-green-100 text-green-600"
                borderColor="border-green-500"
              />
              <KPICard
                title="Overall ROAS"
                value={dashboardData.avgRoas}
                prefix=""
                change={null}
                icon={'\uD83C\uDFAF'}
                color={dashboardData.avgRoas >= 1.5 ? 'bg-green-100 text-green-600' : dashboardData.avgRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}
                borderColor={dashboardData.avgRoas >= 1.5 ? 'border-green-500' : dashboardData.avgRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'}
              />
              <KPICard
                title="Ad Spend % of Rev"
                value={dashboardData.totalRevenue > 0 ? (dashboardData.totalAdSpend / dashboardData.totalRevenue * 100) : 0}
                prefix=""
                suffix="%"
                change={null}
                icon={'\uD83D\uDCCA'}
                color="bg-blue-100 text-blue-600"
                borderColor="border-blue-500"
              />
            </div>

            {/* ROAS Trend Over Time */}
            <div className="grid grid-cols-1 gap-4 mb-4">
              <ChartCard title="ROAS Trend by Marketplace" subtitle="Weekly ROAS evolution per marketplace" fullWidth>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={dashboardData.roasTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                    {Object.keys(MARKETPLACE_COLORS).map((name) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={MARKETPLACE_COLORS[name]}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                        name={name}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Ad Spend Trend Stacked */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <ChartCard title="Ad Spend by Marketplace (Stacked)" subtitle="Weekly ad spend contribution per marketplace">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.adSpendTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    {Object.keys(MARKETPLACE_COLORS).map((name) => (
                      <Bar key={name} dataKey={name} stackId="adspend" fill={MARKETPLACE_COLORS[name]} name={name} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Revenue vs Ad Spend Trend */}
              <ChartCard title="Revenue vs Ad Spend Trend" subtitle="Are we spending more to earn more?">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dashboardData.weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                    <Tooltip content={<EuroTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} name="Revenue" dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="adSpend" stroke="#EF4444" strokeWidth={2} name="Ad Spend" dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-7xl mx-auto px-4 py-6 text-center text-xs text-gray-400">
        <p>&copy; 2026 HG Aesthetics EU - E-commerce Intelligence Dashboard</p>
        <p className="mt-1">Auto-refreshing every 10 minutes | Data synced from Google Sheets</p>
      </div>
    </div>
  );
}
