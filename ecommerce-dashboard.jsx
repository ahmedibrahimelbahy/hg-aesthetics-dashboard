// ============================================================================
// HG Aesthetics EU - E-commerce Performance Dashboard
// CDN-based React 18 + Recharts 2.5 + Tailwind CSS
// ============================================================================

var _RC = (typeof Recharts !== 'undefined') ? Recharts : {};
const {
  ComposedChart, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine
} = _RC;

// === CONFIGURATION ===

const AMAZON_SHEET_ID      = '1i1XUiFWbqPaIRvwrHstSuttaBC933IeaZDN9VNEqiRs';
const BOL_SHEET_ID         = '1OJL6fO4egCFCAVMSnxtbZKBkPzzGfzeZwbPtzLSSaDo';
const BOL_SCORECARD_GID    = 1258148524;          // 2025 historical tab
const BOL_SCORECARD_2026   = 'Scorecard%202026';  // 2026 live tab

const MARKETPLACE_COLORS = {
  'Bol':      '#3B82F6',
  'AMZ - NL': '#10B981',
  'AMZ - FR': '#8B5CF6',
  'AMZ - DE': '#F59E0B',
  'AMZ - IT': '#EF4444',
  'AMZ - ES': '#EC4899',
  'AMZ - BE': '#06B6D4',
};

const MARKETPLACE_FLAGS = {
  'Bol':      '\uD83C\uDDF3\uD83C\uDDF1',
  'AMZ - NL': '\uD83C\uDDF3\uD83C\uDDF1',
  'AMZ - FR': '\uD83C\uDDEB\uD83C\uDDF7',
  'AMZ - DE': '\uD83C\uDDE9\uD83C\uDDEA',
  'AMZ - IT': '\uD83C\uDDEE\uD83C\uDDF9',
  'AMZ - ES': '\uD83C\uDDEA\uD83C\uDDF8',
  'AMZ - BE': '\uD83C\uDDE7\uD83C\uDDEA',
};

const METRIC_LABELS = {
  'Total Sales':           'totalSales',
  '% Change by Last Week': 'pctChange',
  'Sales from Ads':        'salesFromAds',
  'Ad Spend':              'adSpend',
  'ROAS':                  'roas',
  'Ad Spend %':            'adSpendPct',
  'Total Orders':          'totalOrders',
  'Total Units':           'totalUnits',
  'AOV':                   'aov',
};

const PERIOD_OPTIONS = [
  { value: 'this_week',  label: 'This Week'  },
  { value: 'last_week',  label: 'Last Week'  },
  { value: 'last_month', label: 'Last Month' },
  { value: 'ytd',        label: 'YTD'        },
  { value: 'last_year',  label: 'Last Year'  },
  { value: 'all_time',   label: 'All Time'   },
];

// === DATA PARSING UTILITIES ===

function parseGvizResponse(text) {
  var startIdx = text.indexOf('{');
  var endIdx   = text.lastIndexOf('}');
  if (startIdx < 0 || endIdx <= startIdx) throw new Error('Invalid gviz response');
  return JSON.parse(text.substring(startIdx, endIdx + 1));
}

function gvizToRows(gvizJson) {
  if (!gvizJson || !gvizJson.table) return [];
  var rows = [];
  if (!gvizJson.table.rows) return rows;
  gvizJson.table.rows.forEach(function(gvizRow) {
    var row = [];
    if (gvizRow.c) {
      gvizRow.c.forEach(function(cell) {
        row.push(cell && cell.v !== undefined && cell.v !== null ? cell.v : null);
      });
    }
    rows.push(row);
  });
  return rows;
}

function cleanNumericValue(cellValue) {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;
  if (typeof cellValue === 'number') return cellValue;
  var num = parseFloat(String(cellValue).replace(/[€%,\s]/g, ''));
  return isNaN(num) ? null : num;
}

function extractWeekLabels(rows, dataStartCol) {
  if (!rows || rows.length < 1) return [];
  var headerRow = rows[0];
  if (!headerRow) return [];
  var labels = [], currentYear = null, weekCounter = 0;
  for (var col = dataStartCol; col < headerRow.length; col++) {
    var yearVal = headerRow[col];
    if (yearVal === null || yearVal === undefined || yearVal === '') { labels.push(null); continue; }
    var year = parseInt(yearVal);
    if (isNaN(year)) { labels.push(null); continue; }
    if (year !== currentYear) { currentYear = year; weekCounter = 1; } else { weekCounter++; }
    labels.push({ label: "W" + weekCounter + " '" + String(year).slice(2), year: year, week: weekCounter });
  }
  return labels;
}

function extractRowValues(row, dataStartCol, weekLabels) {
  var values = [];
  if (!row) return values;
  for (var i = 0; i < weekLabels.length; i++) {
    if (!weekLabels[i]) continue;
    var cellVal = (dataStartCol + i) < row.length ? row[dataStartCol + i] : null;
    values.push({
      weekLabel: weekLabels[i].label,
      year:      weekLabels[i].year,
      week:      weekLabels[i].week,
      value:     cleanNumericValue(cellVal),
      index:     i,
    });
  }
  return values;
}

function parseMarketplaceSheet(rows, dataStartCol) {
  var weekLabels   = extractWeekLabels(rows, dataStartCol);
  var validLabels  = weekLabels.filter(function(l) { return l !== null; });
  var marketplaces = {}, currentName = null;
  rows.forEach(function(row) {
    if (!row || row.length === 0) return;
    if (row[0] && String(row[0]).trim() !== '') {
      currentName = String(row[0]).trim();
      if (!marketplaces[currentName]) marketplaces[currentName] = {};
    }
    if (row[1] && currentName) {
      var key = METRIC_LABELS[String(row[1]).trim()];
      if (key) marketplaces[currentName][key] = extractRowValues(row, dataStartCol, weekLabels);
    }
  });
  return { marketplaces: marketplaces, weekLabels: validLabels };
}

function filterByPeriod(weeklyValues, period) {
  if (!weeklyValues || weeklyValues.length === 0) return [];
  const valid = weeklyValues.filter(v => v.value !== null);
  if (valid.length === 0) return [];
  const currentYear = new Date().getFullYear();
  switch (period) {
    case 'this_week':  return valid.slice(-1);
    case 'last_week':  return valid.length >= 2 ? valid.slice(-2, -1) : valid.slice(-1);
    case 'last_month': return valid.slice(-4);
    case 'ytd':        return valid.filter(v => v.year === currentYear);
    case 'last_year':  return valid.filter(v => v.year === currentYear - 1);
    case 'all_time':   return valid;
    default:           return valid.slice(-4);
  }
}

function sumValues(arr) { return arr.reduce((s, v) => s + (v.value || 0), 0); }

// Merge two parseMarketplaceSheet results so historical + new-year data are combined.
function mergeMarketplaceParsed(p1, p2) {
  const merged = {
    weekLabels:   [...(p1.weekLabels  || []), ...(p2.weekLabels  || [])],
    marketplaces: {},
  };
  const names = new Set([...Object.keys(p1.marketplaces || {}), ...Object.keys(p2.marketplaces || {})]);
  names.forEach(name => {
    merged.marketplaces[name] = {};
    const m1 = (p1.marketplaces || {})[name] || {};
    const m2 = (p2.marketplaces || {})[name] || {};
    const metrics = new Set([...Object.keys(m1), ...Object.keys(m2)]);
    metrics.forEach(metric => {
      merged.marketplaces[name][metric] = [...(m1[metric] || []), ...(m2[metric] || [])];
    });
  });
  return merged;
}

// === EXPORT PDF ===

async function exportToPDF() {
  const el = document.getElementById('dashboard-content');
  if (!el) return;
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#F9FAFB' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jspdf.jsPDF('landscape', 'mm', 'a4');
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const iw = pw - 20, ih = (canvas.height * iw) / canvas.width;
    let left = ih, pos = 10;
    pdf.addImage(imgData, 'PNG', 10, pos, iw, ih);
    left -= (ph - 20);
    while (left > 0) {
      pdf.addPage();
      pos = -(ih - left) + 10;
      pdf.addImage(imgData, 'PNG', 10, pos, iw, ih);
      left -= (ph - 20);
    }
    pdf.save('HG-Aesthetics-Report-' + new Date().toISOString().split('T')[0] + '.pdf');
  } catch (err) { alert('PDF export failed. Please try again.'); }
}

// === ICONS (inline SVG) ===

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/>
      <line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6"  y1="20" x2="6"  y2="14"/>
      <line x1="2"  y1="20" x2="22" y2="20"/>
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
}

// === SUB-COMPONENTS ===

function KPICard({ title, value, prefix, suffix, change, icon, color, borderColor }) {
  const isPos = change > 0;
  const cc    = isPos ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-500';
  const ci    = isPos ? '\u2191' : change < 0 ? '\u2193' : '\u2014';
  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 p-5 hover:shadow-md transition ${borderColor}`}>
      <div className="flex justify-between items-start mb-3">
        <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{title}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${color}`}>{icon}</div>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-2">
        {prefix}{typeof value === 'number' ? value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}{suffix}
      </h3>
      {change !== null && change !== undefined && (
        <div className={`flex items-center gap-1 text-xs font-medium ${cc}`}>
          <span>{ci}</span><span>{Math.abs(change).toFixed(1)}% vs prev week</span>
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
              <th key={col.key} onClick={() => onSort(col.key)}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">
                <span className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && <span className="text-blue-500">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>}
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

// Section divider used in Sales Analytics
function SectionHeading({ label }) {
  return (
    <div className="pt-6 pb-3 border-t border-gray-200 mb-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</h2>
    </div>
  );
}

// === MAIN DASHBOARD COMPONENT ===

function EcommerceDashboard() {
  const [rawData,          setRawData]          = React.useState(null);
  const [bolProducts,      setBolProducts]      = React.useState([]);
  const [loading,          setLoading]          = React.useState(true);
  const [error,            setError]            = React.useState(null);
  const [lastUpdate,       setLastUpdate]       = React.useState(null);
  const [selectedPeriod,   setSelectedPeriod]   = React.useState('last_month');
  const [activeTab,        setActiveTab]        = React.useState('home');
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [inventoryFilter,  setInventoryFilter]  = React.useState('all');
  const [tableSortKey,     setTableSortKey]     = React.useState('revenue');
  const [tableSortDir,     setTableSortDir]     = React.useState('desc');
  const [exporting,        setExporting]        = React.useState(false);

  // --- Data Fetching ---

  const fetchGviz = async (sheetId, params, label) => {
    const url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json' + (params || '');
    try {
      const res = await fetch(url);
      if (!res.ok) return { _error: label + ' HTTP ' + res.status };
      const text = await res.text();
      const gviz = parseGvizResponse(text);
      if (gviz.status !== 'ok') return { _error: label + ' status: ' + gviz.status };
      return gvizToRows(gviz);
    } catch (e) { return { _error: label + ': ' + e.message }; }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bolScore25Rows, bolScore26Rows, bolProdRows, amazonRows] = await Promise.all([
        fetchGviz(BOL_SHEET_ID,    '&gid='    + BOL_SCORECARD_GID, 'BOL Scorecard 2025'),
        fetchGviz(BOL_SHEET_ID,    '&sheet='  + BOL_SCORECARD_2026, 'BOL Scorecard 2026'),
        fetchGviz(BOL_SHEET_ID,    '&sheet=Product%20Listing',      'BOL Products'),
        fetchGviz(AMAZON_SHEET_ID, '&sheet=2026',                   'Amazon Scorecard'),
      ]);

      if (!bolScore25Rows || bolScore25Rows._error) {
        throw new Error(bolScore25Rows ? bolScore25Rows._error : 'BOL Scorecard 2025 empty');
      }

      const bolParsed25 = parseMarketplaceSheet(bolScore25Rows, 2);
      let   bolParsed26 = { marketplaces: {}, weekLabels: [] };
      if (bolScore26Rows && !bolScore26Rows._error && Array.isArray(bolScore26Rows)) {
        bolParsed26 = parseMarketplaceSheet(bolScore26Rows, 2);
      }
      const bolParsed = mergeMarketplaceParsed(bolParsed25, bolParsed26);

      let   amazonParsed = { marketplaces: {}, weekLabels: [] };
      if (amazonRows && !amazonRows._error && Array.isArray(amazonRows)) {
        amazonParsed = parseMarketplaceSheet(amazonRows, 2);
      }

      const products = [];
      if (bolProdRows && !bolProdRows._error && Array.isArray(bolProdRows)) {
        bolProdRows.slice(1).forEach(function(row) {
          if (!row || !row[0]) return;
          const p = { name: row[0] || '', sku: row[1] || '', status: row[5] || '', reason: row[6] || '' };
          if (p.reason && String(p.reason).toLowerCase().indexOf('critical stock') >= 0) p.alert = true;
          products.push(p);
        });
      }

      setRawData({ amazon: amazonParsed, bolScore: bolParsed });
      setBolProducts(products);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      setError('Error: ' + (err.message || String(err)));
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 600000);
    return () => clearInterval(id);
  }, []);

  // --- Derived Data ---

  const dashboardData = React.useMemo(() => {
    if (!rawData) return null;
    const { amazon, bolScore } = rawData;

    var mp = {};
    if (amazon    && amazon.marketplaces)   Object.keys(amazon.marketplaces).forEach(k => { mp[k] = amazon.marketplaces[k]; });
    if (bolScore  && bolScore.marketplaces) Object.keys(bolScore.marketplaces).forEach(k => { mp[k] = bolScore.marketplaces[k]; });

    const allNames      = ['Bol', 'AMZ - NL', 'AMZ - FR', 'AMZ - DE', 'AMZ - IT', 'AMZ - ES', 'AMZ - BE'];
    const mpNames       = allNames.filter(n => mp[n]);
    const combine       = ['totalSales', 'salesFromAds', 'adSpend', 'totalOrders', 'totalUnits'];
    const allMarkets    = {};

    combine.forEach(function(metric) {
      var combined = [];
      mpNames.forEach(function(name) {
        var d = mp[name];
        if (d && d[metric]) {
          d[metric].forEach(function(e, i) {
            if (!combined[i]) combined[i] = { weekLabel: e.weekLabel, year: e.year, week: e.week, value: 0, index: e.index };
            combined[i].value = (combined[i].value || 0) + (e.value || 0);
          });
        }
      });
      allMarkets[metric] = combined;
    });

    const fSales    = filterByPeriod(allMarkets.totalSales    || [], selectedPeriod);
    const fAdSpend  = filterByPeriod(allMarkets.adSpend       || [], selectedPeriod);
    const fOrders   = filterByPeriod(allMarkets.totalOrders   || [], selectedPeriod);
    const fUnits    = filterByPeriod(allMarkets.totalUnits    || [], selectedPeriod);
    const fSFA      = filterByPeriod(allMarkets.salesFromAds  || [], selectedPeriod);

    const totalRevenue      = sumValues(fSales);
    const totalAdSpend      = sumValues(fAdSpend);
    const totalOrders       = sumValues(fOrders);
    const totalUnits        = sumValues(fUnits);
    const totalSalesFromAds = sumValues(fSFA);
    const avgRoas           = totalAdSpend > 0 ? totalSalesFromAds / totalAdSpend : 0;
    const avgAov            = totalOrders  > 0 ? totalRevenue / totalOrders      : 0;

    const wow = (arr) => {
      if (arr.length < 2) return null;
      const cur = arr[arr.length - 1].value, prev = arr[arr.length - 2].value;
      if (!prev || prev === 0) return null;
      return ((cur - prev) / prev) * 100;
    };

    const weeklyTrend = fSales.map((sale, i) => {
      const ad  = (fAdSpend[i]  && fAdSpend[i].value)  || 0;
      const ord = (fOrders[i]   && fOrders[i].value)   || 0;
      const uni = (fUnits[i]    && fUnits[i].value)    || 0;
      const sfa = (fSFA[i]      && fSFA[i].value)      || 0;
      return {
        weekLabel:      sale.weekLabel,
        revenue:        sale.value || 0,
        adSpend:        ad,
        orders:         ord,
        units:          uni,
        roas:           ad > 0 ? sfa / ad : 0,
        salesFromAds:   sfa,
        organicRevenue: Math.max(0, (sale.value || 0) - sfa),
      };
    });

    const marketplaceData = mpNames.map(name => {
      const d    = mp[name] || {};
      const fS   = filterByPeriod(d.totalSales   || [], selectedPeriod);
      const fA   = filterByPeriod(d.adSpend      || [], selectedPeriod);
      const fO   = filterByPeriod(d.totalOrders  || [], selectedPeriod);
      const fU   = filterByPeriod(d.totalUnits   || [], selectedPeriod);
      const fSfa = filterByPeriod(d.salesFromAds || [], selectedPeriod);
      const rev  = sumValues(fS), ad = sumValues(fA), ord = sumValues(fO);
      const sfa  = sumValues(fSfa);
      return {
        name, revenue: rev, adSpend: ad,
        roas:        ad  > 0 ? sfa / ad   : 0,
        orders:      ord,
        units:       sumValues(fU),
        aov:         ord > 0 ? rev / ord  : 0,
        adSpendPct:  rev > 0 ? (ad / rev) * 100 : 0,
        salesFromAds: sfa,
        organicRevenue: Math.max(0, rev - sfa),
        color:       MARKETPLACE_COLORS[name] || '#6B7280',
        weeklyTrend: fS.map(s => ({ weekLabel: s.weekLabel, revenue: s.value || 0 })),
      };
    });

    const roasTrend = fSales.map((sale, i) => {
      const entry = { weekLabel: sale.weekLabel };
      mpNames.forEach(name => {
        const fr = filterByPeriod((mp[name] || {}).roas || [], selectedPeriod);
        entry[name] = (fr[i] && fr[i].value) || 0;
      });
      return entry;
    });

    const adSpendTrend = fSales.map((sale, i) => {
      const entry = { weekLabel: sale.weekLabel };
      mpNames.forEach(name => {
        const fa = filterByPeriod((mp[name] || {}).adSpend || [], selectedPeriod);
        entry[name] = (fa[i] && fa[i].value) || 0;
      });
      return entry;
    });

    const bolRevenue      = marketplaceData.filter(m => m.name === 'Bol').reduce((s, m) => s + m.revenue, 0);
    const amzRevenue      = marketplaceData.filter(m => m.name.startsWith('AMZ')).reduce((s, m) => s + m.revenue, 0);
    const combinedRevenue = bolRevenue + amzRevenue;
    const trueAvgAov      = totalOrders > 0 ? combinedRevenue / totalOrders : 0;

    return {
      totalRevenue: combinedRevenue, totalAdSpend, totalOrders, totalUnits, totalSalesFromAds, avgRoas,
      avgAov: trueAvgAov,
      wowRevenue:  wow(fSales),
      wowAdSpend:  wow(fAdSpend),
      wowOrders:   wow(fOrders),
      wowUnits:    wow(fUnits),
      weeklyTrend, marketplaceData, roasTrend, adSpendTrend, bolRevenue, amzRevenue, combinedRevenue,
    };
  }, [rawData, selectedPeriod]);

  const alertCount = bolProducts.filter(p => p.alert).length;

  // --- Table sorting ---

  const sortedTableData = React.useMemo(() => {
    if (!dashboardData) return [];
    const data = [...dashboardData.marketplaceData].sort((a, b) => {
      const av = a[tableSortKey] || 0, bv = b[tableSortKey] || 0;
      return tableSortDir === 'asc' ? av - bv : bv - av;
    });
    const sub = (items, label) => {
      const r = items.reduce((s, m) => s + m.revenue, 0);
      const a = items.reduce((s, m) => s + m.adSpend, 0);
      const f = items.reduce((s, m) => s + m.salesFromAds, 0);
      const o = items.reduce((s, m) => s + m.orders, 0);
      const u = items.reduce((s, m) => s + m.units, 0);
      return { name: label, revenue: r, adSpend: a, salesFromAds: f, roas: a > 0 ? f / a : 0, orders: o, units: u, aov: o > 0 ? r / o : 0, adSpendPct: r > 0 ? (a / r) * 100 : 0, isTotal: true };
    };
    const bol = data.filter(m => m.name === 'Bol');
    const amz = data.filter(m => m.name.startsWith('AMZ'));
    return [...bol, sub(bol, 'BOL Total'), ...amz, sub(amz, 'Amazon Total'), sub(data, 'Grand Total')];
  }, [dashboardData, tableSortKey, tableSortDir]);

  const handleSort = (key) => {
    if (tableSortKey === key) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setTableSortKey(key); setTableSortDir('desc'); }
  };

  const handleExport = async () => { setExporting(true); await exportToPDF(); setExporting(false); };

  // --- States ---

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

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-4xl mb-4">{'\u26A0\uFE0F'}</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Unable to Load Data</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button onClick={fetchData} className="bg-blue-600 text-white py-2 px-6 rounded-lg hover:bg-blue-700 transition font-medium">Retry</button>
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
    { key: 'revenue',      label: 'Revenue',       render: v => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { key: 'salesFromAds', label: 'Sales from Ads', render: v => `\u20AC${(v||0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { key: 'adSpend',      label: 'Ad Spend',       render: v => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    { key: 'roas', label: 'ROAS', render: v => (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${v >= 1.5 ? 'bg-green-100 text-green-800' : v >= 1.0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{v.toFixed(2)}</span>
    )},
    { key: 'orders',     label: 'Orders',    render: v => v.toLocaleString() },
    { key: 'units',      label: 'Units',     render: v => v.toLocaleString() },
    { key: 'aov',        label: 'AOV',       render: v => `\u20AC${v.toFixed(2)}` },
    { key: 'adSpendPct', label: 'Ad Spend %', render: v => (
      <span className={v > 80 ? 'text-red-600 font-medium' : 'text-gray-700'}>{v.toFixed(1)}%</span>
    )},
  ];

  const pieData = dashboardData.marketplaceData.filter(m => m.revenue > 0).map(m => ({ name: m.name, value: m.revenue, color: m.color }));
  const adEffData = dashboardData.marketplaceData.filter(m => m.revenue > 0).map(m => ({ name: m.name, organicRevenue: m.organicRevenue, adRevenue: m.salesFromAds }));
  const filteredProducts = inventoryFilter === 'issues' ? bolProducts.filter(p => p.alert) : bolProducts;

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }} className="bg-gray-50">

      {/* ════════════════════════ SIDEBAR ════════════════════════ */}
      <aside
        className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0 transition-all duration-300"
        style={{ width: sidebarCollapsed ? '56px' : '220px', overflowX: 'hidden' }}
      >
        {/* Logo */}
        <div
          className={`border-b border-gray-100 flex items-center ${sidebarCollapsed ? 'justify-center py-4 px-2' : 'gap-3 px-4 py-4'}`}
          style={{ minHeight: '64px', flexShrink: 0 }}
        >
          {/* HG mark: two vertical bars + horizontal crossbar */}
          <svg width="30" height="30" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <rect x="5"  y="5" width="18" height="90" rx="3" fill="#0f172a"/>
            <rect x="77" y="5" width="18" height="90" rx="3" fill="#0f172a"/>
            <rect x="5"  y="41" width="90" height="18" rx="3" fill="#0f172a"/>
          </svg>
          {!sidebarCollapsed && (
            <div style={{ overflow: 'hidden' }}>
              <p className="text-sm font-bold text-gray-900 leading-tight whitespace-nowrap">HG Aesthetics</p>
              <p className="text-xs text-gray-400 whitespace-nowrap">EU Dashboard</p>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-2">
          {[
            { id: 'home',      label: 'Home',            Icon: HomeIcon,  badge: null },
            { id: 'sales',     label: 'Sales Analytics', Icon: ChartIcon, badge: null },
            { id: 'inventory', label: 'Inventory',       Icon: BoxIcon,   badge: alertCount > 0 ? alertCount : null },
          ].map(({ id, label, Icon, badge }) => (
            <div key={id} className="relative">
              <button
                onClick={() => setActiveTab(id)}
                className={`w-full flex items-center transition-colors ${
                  sidebarCollapsed ? 'justify-center px-0 py-3' : 'gap-3 px-4 py-3'
                } ${
                  activeTab === id
                    ? 'text-blue-600 bg-blue-50 border-l-4 border-blue-500'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 border-l-4 border-transparent'
                }`}
              >
                <Icon />
                {!sidebarCollapsed && (
                  <>
                    <span className="text-sm font-medium">{label}</span>
                    {badge && (
                      <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center leading-none">
                        {badge}
                      </span>
                    )}
                  </>
                )}
              </button>
              {sidebarCollapsed && badge && (
                <span className="absolute top-2 right-2 bg-red-500 rounded-full w-2 h-2 pointer-events-none"></span>
              )}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-gray-100 p-2" style={{ flexShrink: 0 }}>
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed
                ? <><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></>
                : <><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></>
              }
            </svg>
          </button>
        </div>
      </aside>

      {/* ════════════════════════ MAIN CONTENT ════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0" style={{ minHeight: '64px' }}>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {activeTab === 'home' ? 'Home' : activeTab === 'sales' ? 'Sales Analytics' : 'Inventory'}
            </h1>
            {lastUpdate && <p className="text-xs text-gray-400">Updated {lastUpdate.toLocaleTimeString()}</p>}
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value)}
              className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-blue-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {PERIOD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <button
              onClick={fetchData} disabled={loading}
              className="flex items-center gap-2 bg-white border border-gray-300 px-3 py-2 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
            >
              <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>{'\u21BB'}</span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={handleExport} disabled={exporting}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-sm text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : '\u2193 Export PDF'}
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main id="dashboard-content" className="flex-1 overflow-y-auto p-6">

          {/* ══════════════════════ HOME TAB ══════════════════════ */}
          {activeTab === 'home' && (
            <div>

              {/* KPI row */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                <KPICard
                  title="Total Revenue" value={dashboardData.totalRevenue} prefix={'\u20AC'}
                  change={dashboardData.wowRevenue} icon={'\u20AC'}
                  color="bg-blue-100 text-blue-600" borderColor="border-blue-500"
                />
                <KPICard
                  title="Avg ROAS" value={dashboardData.avgRoas} prefix="" suffix=""
                  change={null} icon={'\uD83C\uDFAF'}
                  color={dashboardData.avgRoas >= 1.5 ? 'bg-green-100 text-green-600' : dashboardData.avgRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}
                  borderColor={dashboardData.avgRoas >= 1.5 ? 'border-green-500' : dashboardData.avgRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'}
                />
                <KPICard
                  title="Orders" value={dashboardData.totalOrders} prefix="" suffix=""
                  change={dashboardData.wowOrders} icon={'\uD83D\uDED2'}
                  color="bg-purple-100 text-purple-600" borderColor="border-purple-500"
                />
                <KPICard
                  title="Avg AOV" value={dashboardData.avgAov} prefix={'\u20AC'} suffix=""
                  change={null} icon={'\uD83D\uDCB0'}
                  color="bg-orange-100 text-orange-600" borderColor="border-orange-500"
                />
                {/* Stock alerts — custom card */}
                <div className={`bg-white rounded-xl shadow-sm border-l-4 p-5 hover:shadow-md transition ${alertCount > 0 ? 'border-red-500' : 'border-green-500'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Stock Alerts</p>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${alertCount > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                      {alertCount > 0 ? '\u26A0\uFE0F' : '\u2713'}
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{alertCount}</h3>
                  <p className={`text-xs font-medium ${alertCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {alertCount > 0 ? 'products need attention' : 'all products OK'}
                  </p>
                </div>
              </div>

              {/* Revenue split + trend */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

                {/* BOL vs Amazon */}
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <h3 className="text-base font-semibold text-gray-800 mb-4">Revenue by Channel</h3>
                  <div className="space-y-4">
                    {[
                      { label: 'BOL.com',    value: dashboardData.bolRevenue, color: '#3B82F6', flag: '\uD83C\uDDF3\uD83C\uDDF1' },
                      { label: 'Amazon EU',  value: dashboardData.amzRevenue, color: '#F59E0B', flag: '\uD83D\uDECD\uFE0F' },
                    ].map(ch => {
                      const pct = dashboardData.combinedRevenue > 0 ? (ch.value / dashboardData.combinedRevenue) * 100 : 0;
                      return (
                        <div key={ch.label}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium text-gray-700">{ch.flag} {ch.label}</span>
                            <span className="text-sm font-bold text-gray-900">
                              {'\u20AC'}{ch.value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              <span className="text-xs text-gray-400 ml-2">({pct.toFixed(1)}%)</span>
                            </span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: ch.color }}></div>
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-3 border-t border-gray-100 flex justify-between">
                      <span className="text-sm font-semibold text-gray-700">Total</span>
                      <span className="text-sm font-bold text-gray-900">
                        {'\u20AC'}{dashboardData.combinedRevenue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Revenue trend */}
                <ChartCard title="Revenue Trend" subtitle="Weekly revenue for selected period">
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={dashboardData.weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} fill="#DBEAFE" name="Revenue" />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              {/* Top 3 marketplaces */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {dashboardData.marketplaceData.slice(0, 3).map((m, i) => (
                  <div key={i} className="bg-white rounded-xl shadow-sm p-5 border-t-4" style={{ borderTopColor: m.color }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{MARKETPLACE_FLAGS[m.name] || ''}</span>
                        <span className="font-semibold text-gray-800">{m.name}</span>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded font-medium ${i === 0 ? 'bg-yellow-100 text-yellow-800' : i === 1 ? 'bg-gray-100 text-gray-700' : 'bg-orange-100 text-orange-800'}`}>
                        #{i + 1}
                      </span>
                    </div>
                    <p className="text-2xl font-bold mb-3" style={{ color: m.color }}>
                      {'\u20AC'}{m.revenue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>ROAS: <span className={`font-medium ${m.roas >= 1.5 ? 'text-green-600' : m.roas >= 1.0 ? 'text-amber-600' : 'text-red-600'}`}>{m.roas.toFixed(2)}</span></div>
                      <div>Orders: <span className="font-medium text-gray-800">{m.orders}</span></div>
                      <div>Ad Spend: <span className="font-medium text-gray-800">{'\u20AC'}{m.adSpend.toFixed(0)}</span></div>
                      <div>AOV: <span className="font-medium text-gray-800">{'\u20AC'}{m.aov.toFixed(2)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════ SALES ANALYTICS TAB ══════════════════ */}
          {activeTab === 'sales' && (
            <div>

              {/* ── Overview ── */}
              <SectionHeading label="Performance Overview" />

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                <KPICard title="Total Revenue"   value={dashboardData.totalRevenue}      prefix={'\u20AC'} change={dashboardData.wowRevenue}  icon={'\u20AC'}          color="bg-blue-100 text-blue-600"   borderColor="border-blue-500" />
                <KPICard title="Sales from Ads"  value={dashboardData.totalSalesFromAds} prefix={'\u20AC'} change={null}                       icon={'\uD83D\uDCB5'}    color="bg-green-100 text-green-600"  borderColor="border-green-500" />
                <KPICard title="Ad Spend"        value={dashboardData.totalAdSpend}      prefix={'\u20AC'} change={dashboardData.wowAdSpend}   icon={'\uD83D\uDCE2'}    color="bg-red-100 text-red-600"     borderColor="border-red-500" />
                <KPICard title="Avg ROAS"        value={dashboardData.avgRoas}           prefix=""         change={null}                       icon={'\uD83C\uDFAF'}    color={dashboardData.avgRoas >= 1.5 ? 'bg-green-100 text-green-600' : dashboardData.avgRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} borderColor={dashboardData.avgRoas >= 1.5 ? 'border-green-500' : dashboardData.avgRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'} />
                <KPICard title="Orders"          value={dashboardData.totalOrders}       prefix=""  suffix="" change={dashboardData.wowOrders}  icon={'\uD83D\uDED2'}    color="bg-purple-100 text-purple-600" borderColor="border-purple-500" />
                <KPICard title="Units Sold"      value={dashboardData.totalUnits}        prefix=""  suffix="" change={dashboardData.wowUnits}   icon={'\uD83D\uDCE6'}    color="bg-indigo-100 text-indigo-600" borderColor="border-indigo-500" />
                <KPICard title="Avg AOV"         value={dashboardData.avgAov}            prefix={'\u20AC'} change={null}                       icon={'\uD83D\uDCB0'}    color="bg-orange-100 text-orange-600" borderColor="border-orange-500" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <ChartCard title="Revenue & Ad Spend Trend" fullWidth subtitle="Weekly overview of total sales vs advertising spend">
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={dashboardData.weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Area type="monotone" dataKey="revenue" fill="#DBEAFE" stroke="#3B82F6" strokeWidth={2} name="Revenue" />
                      <Bar dataKey="adSpend" fill="#FCA5A5" opacity={0.7} name="Ad Spend" barSize={20} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <ChartCard title="Revenue by Marketplace" subtitle="Total revenue per marketplace for selected period">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={dashboardData.marketplaceData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis type="number" tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip content={<EuroTooltip />} />
                      <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]}>
                        {dashboardData.marketplaceData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="ROAS by Marketplace" subtitle="Green >= 1.5 (target) | Amber >= 1.0 (breakeven) | Red < 1.0">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={dashboardData.marketplaceData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="3 3" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                      <ReferenceLine y={1.5} stroke="#10B981" strokeDasharray="3 3" label={{ value: 'Target',    position: 'right', fontSize: 10, fill: '#10B981' }} />
                      <Bar dataKey="roas" name="ROAS" radius={[4, 4, 0, 0]}>
                        {dashboardData.marketplaceData.map((e, i) => <Cell key={i} fill={e.roas >= 1.5 ? '#10B981' : e.roas >= 1.0 ? '#F59E0B' : '#EF4444'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Ad Revenue vs Organic Revenue" subtitle="How much revenue is ad-driven vs organic per marketplace">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={adEffData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Bar dataKey="organicRevenue" stackId="r" fill="#3B82F6" name="Organic Revenue" />
                      <Bar dataKey="adRevenue"      stackId="r" fill="#FCA5A5" name="Ad Revenue" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Revenue Distribution" subtitle="Share of total revenue by marketplace">
                  <ResponsiveContainer width="100%" height={270}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={55} outerRadius={95} paddingAngle={2}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={v => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 gap-4 mb-4">
                <ChartCard title="Orders & Units Trend" subtitle="Weekly order count and units sold">
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={dashboardData.weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Bar  dataKey="orders" fill="#8B5CF6" name="Orders" barSize={20} opacity={0.8} radius={[4, 4, 0, 0]} />
                      <Line dataKey="units"  stroke="#EC4899" strokeWidth={2} name="Units" dot={{ r: 3 }} type="monotone" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              {/* ── Marketplace breakdown ── */}
              <SectionHeading label="Marketplace Breakdown" />

              <div className="bg-white rounded-xl shadow-sm mb-6">
                <div className="p-5 border-b border-gray-100">
                  <h3 className="text-base font-semibold text-gray-800">Marketplace Comparison</h3>
                  <p className="text-xs text-gray-500 mt-1">Click column headers to sort. All values for selected period.</p>
                </div>
                <SortableTable data={sortedTableData} columns={tableColumns} sortKey={tableSortKey} sortDir={tableSortDir} onSort={handleSort} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                {dashboardData.marketplaceData.map((m, i) => (
                  <div key={i} className="bg-white rounded-xl shadow-sm p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-lg">{MARKETPLACE_FLAGS[m.name] || ''}</span>
                      <span className="w-4 h-4 rounded-full" style={{ backgroundColor: m.color }}></span>
                      <h4 className="font-semibold text-gray-800">{m.name}</h4>
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${m.roas >= 1.5 ? 'bg-green-100 text-green-800' : m.roas >= 1.0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                        ROAS {m.roas.toFixed(2)}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-center">
                      <div><p className="text-xs text-gray-500">Revenue</p><p className="text-sm font-semibold">{'\u20AC'}{m.revenue.toFixed(0)}</p></div>
                      <div><p className="text-xs text-gray-500">Ad Spend</p><p className="text-sm font-semibold">{'\u20AC'}{m.adSpend.toFixed(0)}</p></div>
                      <div><p className="text-xs text-gray-500">Orders</p><p className="text-sm font-semibold">{m.orders}</p></div>
                      <div><p className="text-xs text-gray-500">AOV</p><p className="text-sm font-semibold">{'\u20AC'}{m.aov.toFixed(2)}</p></div>
                    </div>
                    {m.weeklyTrend.length > 1 && (
                      <div className="mt-4">
                        <ResponsiveContainer width="100%" height={60}>
                          <AreaChart data={m.weeklyTrend}>
                            <Area type="monotone" dataKey="revenue" fill={m.color} fillOpacity={0.15} stroke={m.color} strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Advertising ── */}
              <SectionHeading label="Advertising" />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <KPICard title="Total Ad Spend"    value={dashboardData.totalAdSpend}      prefix={'\u20AC'} change={dashboardData.wowAdSpend} icon={'\uD83D\uDCB8'} color="bg-red-100 text-red-600"     borderColor="border-red-500" />
                <KPICard title="Ad Revenue"        value={dashboardData.totalSalesFromAds} prefix={'\u20AC'} change={null}                      icon={'\uD83D\uDCB5'} color="bg-green-100 text-green-600" borderColor="border-green-500" />
                <KPICard title="Overall ROAS"      value={dashboardData.avgRoas}           prefix=""         change={null}                      icon={'\uD83C\uDFAF'} color={dashboardData.avgRoas >= 1.5 ? 'bg-green-100 text-green-600' : dashboardData.avgRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} borderColor={dashboardData.avgRoas >= 1.5 ? 'border-green-500' : dashboardData.avgRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'} />
                <KPICard title="Ad Spend % of Rev" value={dashboardData.totalRevenue > 0 ? (dashboardData.totalAdSpend / dashboardData.totalRevenue * 100) : 0} prefix="" suffix="%" change={null} icon={'\uD83D\uDCCA'} color="bg-blue-100 text-blue-600" borderColor="border-blue-500" />
              </div>

              <div className="grid grid-cols-1 gap-4 mb-4">
                <ChartCard title="ROAS Trend by Marketplace" subtitle="Weekly ROAS evolution per marketplace" fullWidth>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={dashboardData.roasTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                      {Object.keys(MARKETPLACE_COLORS).map(name => (
                        <Line key={name} type="monotone" dataKey={name} stroke={MARKETPLACE_COLORS[name]} strokeWidth={2} dot={{ r: 2 }} connectNulls name={name} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <ChartCard title="Ad Spend by Marketplace (Stacked)" subtitle="Weekly ad spend contribution per marketplace">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={dashboardData.adSpendTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {Object.keys(MARKETPLACE_COLORS).map(name => (
                        <Bar key={name} dataKey={name} stackId="a" fill={MARKETPLACE_COLORS[name]} name={name} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Revenue vs Ad Spend Trend" subtitle="Are we spending more to earn more?">
                  <ResponsiveContainer width="100%" height={270}>
                    <LineChart data={dashboardData.weeklyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} name="Revenue"  dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="adSpend" stroke="#EF4444" strokeWidth={2} name="Ad Spend" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </div>
          )}

          {/* ══════════════════════ INVENTORY TAB ══════════════════════ */}
          {activeTab === 'inventory' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">BOL Product Listing</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {bolProducts.length} products total
                    {alertCount > 0 && <span className="ml-2 text-red-600 font-medium">{'\u26A0\uFE0F'} {alertCount} need attention</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setInventoryFilter('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${inventoryFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    All ({bolProducts.length})
                  </button>
                  <button
                    onClick={() => setInventoryFilter('issues')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${inventoryFilter === 'issues' ? 'bg-red-600 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    Issues Only ({alertCount})
                  </button>
                </div>
              </div>

              {bolProducts.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                  <p className="text-4xl mb-3">{'\uD83D\uDCE6'}</p>
                  <p className="text-gray-500">No product data available. Ensure the BOL Product Listing sheet is publicly accessible.</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product Name</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SKU</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Alert</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredProducts.map((p, i) => (
                          <tr key={i} className={`hover:bg-gray-50 ${p.alert ? 'bg-red-50' : ''}`}>
                            <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                            <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.sku}</td>
                            <td className="px-4 py-3">
                              {p.status
                                ? <span className={`px-2 py-1 rounded text-xs font-medium ${p.status.toLowerCase().includes('active') ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{p.status}</span>
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-600 text-xs">{p.reason || '—'}</td>
                            <td className="px-4 py-3">
                              {p.alert
                                ? <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">{'\u26A0\uFE0F'} Critical</span>
                                : <span className="text-green-600 text-xs">{'\u2713'} OK</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </main>

        {/* Footer */}
        <footer className="px-6 py-2 text-center text-xs text-gray-400 border-t border-gray-100 bg-white flex-shrink-0">
          {'\u00A9'} 2026 HG Aesthetics EU &mdash; Auto-refreshing every 10 min | Data from Google Sheets
        </footer>
      </div>
    </div>
  );
}
