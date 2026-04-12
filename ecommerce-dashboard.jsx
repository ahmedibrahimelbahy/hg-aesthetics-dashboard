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


const PRESET_LABELS = {
  'last_7_days':   'Last 7 days',
  'last_30_days':  'Last 30 days',
  'last_60_days':  'Last 60 days',
  'last_90_days':  'Last 90 days',
  'last_week':     'Last week',
  'last_month':    'Last month',
  'last_year':     'Last year',
  'week_to_date':  'Week to date',
  'month_to_date': 'Month to date',
  'ytd':           'Year to date',
  'all_time':      'All time',
  'custom':        null,
};

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

function extractWeekLabels(rows, dataStartCol, yearWeekStart) {
  if (!rows || rows.length < 1) return [];
  var headerRow = rows[0];
  if (!headerRow) return [];
  // gviz truncates trailing null cells in sparse rows, so the header row may be shorter
  // than data rows. Use the maximum row length across ALL rows so we don't miss weeks
  // that fall past the last year-label cell in the header.
  var maxCols = rows.reduce(function(m, r) { return r ? Math.max(m, r.length) : m; }, headerRow.length);
  // Find the last column that has a real year value — carry-forward only applies AFTER this point.
  var lastYearCol = dataStartCol - 1;
  for (var c = dataStartCol; c < maxCols; c++) {
    var v = c < headerRow.length ? headerRow[c] : null;
    if (v !== null && v !== undefined && v !== '') {
      var p = parseInt(v);
      if (!isNaN(p) && p > 2000) lastYearCol = c;
    }
  }
  var labels = [], currentYear = null, weekCounter = 0, carryForwardStopped = false;
  for (var col = dataStartCol; col < maxCols; col++) {
    var yearVal = col < headerRow.length ? headerRow[col] : null;
    var year = null;
    if (yearVal !== null && yearVal !== undefined && yearVal !== '') {
      var parsed = parseInt(yearVal);
      if (!isNaN(parsed)) year = parsed;
    }
    // Carry forward the year for columns past the last year-label cell (new weeks not yet labelled).
    // Stop carry-forward permanently once we see an all-null column (separator before totals).
    if (year === null && currentYear !== null && col > lastYearCol && !carryForwardStopped) {
      var colHasData = rows.slice(1).some(function(r) {
        var v = r && r.length > col ? r[col] : null;
        return v !== null && v !== undefined && v !== '';
      });
      if (colHasData) { year = currentYear; } else { carryForwardStopped = true; }
    }
    if (year === null) { labels.push(null); continue; }
    if (year !== currentYear) {
      currentYear = year;
      if (yearWeekStart && yearWeekStart.hasOwnProperty(year)) {
        weekCounter = yearWeekStart[year];
      } else {
        var jan4y = new Date(year, 0, 4);
        var w1MonY = new Date(jan4y); w1MonY.setDate(jan4y.getDate() - ((jan4y.getDay() || 7) - 1));
        weekCounter = w1MonY.getFullYear() < year ? 2 : 1;
      }
    } else { weekCounter++; }
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

function parseMarketplaceSheet(rows, dataStartCol, yearWeekStart) {
  var weekLabels   = extractWeekLabels(rows, dataStartCol, yearWeekStart);
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

// Convert ISO year + week number → Monday date of that week
function isoWeekToDate(year, week) {
  const jan4 = new Date(year, 0, 4);
  const w1Mon = new Date(jan4);
  w1Mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
  const d = new Date(w1Mon);
  d.setDate(w1Mon.getDate() + (week - 1) * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Filter weeks that overlap a calendar date range [start, end]
function filterByDateRange(weeklyValues, start, end) {
  if (!weeklyValues || !start || !end) return [];
  return weeklyValues.filter(v => {
    if (v.value === null) return false;
    const wStart = isoWeekToDate(v.year, v.week);
    const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 6);
    return wStart <= end && wEnd >= start;
  });
}

function filterByPeriod(weeklyValues, period) {
  if (!weeklyValues || weeklyValues.length === 0) return [];
  const valid = weeklyValues.filter(v => v.value !== null);
  if (valid.length === 0) return [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const currentYear = now.getFullYear();
  switch (period) {
    case 'this_week':
    case 'week_to_date':  return valid.slice(-1);
    case 'last_week':     return valid.length >= 2 ? valid.slice(-2, -1) : valid.slice(-1);
    case 'last_7_days':   return valid.slice(-1);
    case 'last_month':    return valid.slice(-4);
    case 'last_30_days':  return valid.slice(-4);
    case 'last_60_days':  return valid.slice(-9);
    case 'last_90_days':  return valid.slice(-13);
    case 'month_to_date': return valid.filter(v => {
      const ws = isoWeekToDate(v.year, v.week);
      return ws.getFullYear() === currentYear && ws.getMonth() === now.getMonth();
    });
    case 'ytd':           return valid.filter(v => v.year === currentYear);
    case 'last_year':     return valid.filter(v => v.year === currentYear - 1);
    case 'all_time':      return valid;
    default:              return valid.slice(-4);
  }
}

// Returns the equivalent prior period for period-over-period comparison
function filterPriorPeriod(weeklyValues, period) {
  if (!weeklyValues || weeklyValues.length === 0) return [];
  const valid = weeklyValues.filter(v => v.value !== null);
  if (valid.length === 0) return [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const currentYear = now.getFullYear();
  switch (period) {
    case 'this_week':
    case 'week_to_date':  return valid.length >= 2 ? valid.slice(-2, -1) : [];
    case 'last_week':     return valid.length >= 3 ? valid.slice(-3, -2) : [];
    case 'last_7_days':   return valid.length >= 2 ? valid.slice(-2, -1) : [];
    case 'last_month':
    case 'last_30_days':  return valid.length >= 8  ? valid.slice(-8,  -4) : [];
    case 'last_60_days':  return valid.length >= 18 ? valid.slice(-18, -9) : [];
    case 'last_90_days':  return valid.length >= 26 ? valid.slice(-26,-13) : [];
    case 'month_to_date': return valid.filter(v => {
      const ws = isoWeekToDate(v.year, v.week);
      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear  = now.getMonth() === 0 ? currentYear - 1 : currentYear;
      return ws.getFullYear() === prevYear && ws.getMonth() === prevMonth;
    });
    case 'ytd': {
      const n = valid.filter(v => v.year === currentYear).length;
      return valid.filter(v => v.year === currentYear - 1).slice(0, n);
    }
    case 'last_year':  return valid.filter(v => v.year === currentYear - 2);
    case 'all_time':   return [];
    default:           return [];
  }
}

const PERIOD_COMPARE_LABELS = {
  'this_week':     'vs last week',
  'week_to_date':  'vs last week',
  'last_week':     'vs prev week',
  'last_7_days':   'vs prev 7 days',
  'last_month':    'vs prev month',
  'last_30_days':  'vs prev 30 days',
  'last_60_days':  'vs prev 60 days',
  'last_90_days':  'vs prev 90 days',
  'month_to_date': 'vs prev month',
  'ytd':           'vs same period LY',
  'last_year':     'vs prev year',
  'all_time':      null,
  'custom':        'vs prior period',
};

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
    <img src="https://upload.wikimedia.org/wikipedia/commons/f/f9/Bol.com_2019_logo.svg"
      alt="BOL" style={{ height: '14px', width: 'auto', objectFit: 'contain', display: 'block', maxWidth: '40px' }} />
  );
}

function AmazonIcon() {
  return (
    <img src="https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg"
      alt="Amazon" style={{ height: '14px', width: 'auto', objectFit: 'contain', display: 'block', maxWidth: '50px' }} />
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

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  );
}

function PnlIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  );
}

// === SUB-COMPONENTS ===

function KPICard({ title, value, prefix, suffix, change, changeLabel, icon, color, borderColor, streak, decimals }) {
  const isPos = change > 0;
  const cc    = isPos ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-500';
  const ci    = isPos ? '\u2191' : change < 0 ? '\u2193' : '\u2014';
  const dp    = decimals !== undefined ? decimals : 2;
  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 p-5 hover:shadow-md transition ${borderColor}`}>
      <div className="flex justify-between items-start mb-3">
        <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{title}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${color}`}>{icon}</div>
      </div>
      <h3 className="text-2xl font-bold text-gray-900 mb-2">
        {prefix}{typeof value === 'number' ? value.toLocaleString('de-DE', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : value}{suffix}
      </h3>
      {change !== null && change !== undefined && changeLabel && (
        <div className={`flex items-center gap-1 text-xs font-medium ${cc}`}>
          <span>{ci}</span><span>{Math.abs(change).toFixed(1)}% {changeLabel}</span>
        </div>
      )}
      {streak && streak.count >= 2 && (
        <div className={`flex items-center gap-1 text-xs font-medium mt-1 ${streak.dir === 'up' ? 'text-emerald-500' : 'text-rose-400'}`}>
          <span>{streak.dir === 'up' ? '\u2191' : '\u2193'}</span>
          <span>{streak.count}w {streak.dir === 'up' ? 'rising' : 'falling'}</span>
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

// ── Date Range Picker ────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function CalendarMonth({ year, month, rangeStart, rangeEnd, hoverDate, onDateClick, onDateHover }) {
  const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month, d); dt.setHours(0,0,0,0);
    cells.push(dt);
  }

  return (
    <div style={{ width: '196px' }}>
      <p className="text-center text-sm font-semibold text-gray-800 mb-2">{MONTH_NAMES[month]} {year}</p>
      <div className="grid grid-cols-7">
        {DAYS.map(d => <div key={d} className="text-center text-xs text-gray-400 py-1 font-medium">{d}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={'p'+i} />;
          const isFuture  = date > today;
          const isStart   = rangeStart && date.getTime() === rangeStart.getTime();
          const isEnd     = rangeEnd   && date.getTime() === rangeEnd.getTime();
          const effectEnd = rangeEnd || hoverDate;
          const inRange   = rangeStart && effectEnd && date > rangeStart && date < effectEnd;
          const isToday   = date.getTime() === today.getTime();
          let cls = 'text-xs text-center py-1 w-full transition rounded-full ';
          if      (isFuture)            cls += 'text-gray-300 cursor-not-allowed';
          else if (isStart || isEnd)    cls += 'bg-blue-600 text-white font-semibold cursor-pointer';
          else if (inRange)             cls += 'bg-blue-100 text-blue-800 cursor-pointer';
          else if (isToday)             cls += 'font-bold text-gray-900 hover:bg-gray-100 cursor-pointer';
          else                          cls += 'text-gray-700 hover:bg-gray-100 cursor-pointer';
          return (
            <button key={i} disabled={isFuture} className={cls}
              onClick={() => !isFuture && onDateClick(date)}
              onMouseEnter={() => !isFuture && onDateHover(date)}
            >{date.getDate()}</button>
          );
        })}
      </div>
    </div>
  );
}

function DateRangePicker({ value, customRange, onChange, onCustomRange }) {
  const [open,     setOpen]     = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);
  const [wStart,   setWStart]   = React.useState(null); // { year, week, mon, sun }
  const [wEnd,     setWEnd]     = React.useState(null);
  const ref        = React.useRef(null);
  const scrollRef  = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Scroll to current week when picker opens
  React.useEffect(() => {
    if (!open || !scrollRef.current) return;
    const el = scrollRef.current.querySelector('.week-current');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [open]);

  const applyPreset = v => { onChange(v); setOpen(false); setExpanded(null); };

  // Generate all ISO weeks from 2025 up to current week
  const allWeeks = React.useMemo(() => {
    const weeks = [];
    const limit = new Date(); limit.setDate(limit.getDate() + 8);
    for (let year = 2025; year <= 2027; year++) {
      for (let week = 1; week <= 53; week++) {
        const mon = isoWeekToDate(year, week);
        if (mon > limit) return weeks;
        if (mon.getFullYear() !== year) continue; // skip invalid ISO edge weeks
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        weeks.push({ year, week, mon, sun });
      }
    }
    return weeks;
  }, []);

  const weeksByYear = React.useMemo(() => {
    const map = {};
    allWeeks.forEach(w => { if (!map[w.year]) map[w.year] = []; map[w.year].push(w); });
    return map;
  }, [allWeeks]);

  const weekKey  = w => w ? `${w.year}-${w.week}` : '';
  const cmpWeek  = (a, b) => !a || !b ? 0 : a.year !== b.year ? a.year - b.year : a.week - b.week;
  const inRange  = w => wStart && wEnd && cmpWeek(w, wStart) >= 0 && cmpWeek(w, wEnd) <= 0;
  const fmtShort = d => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });

  const todayWeek = React.useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return allWeeks.find(w => w.mon <= now && w.sun >= now) || null;
  }, [allWeeks]);

  const handleWeekClick = w => {
    if (!wStart || (wStart && wEnd)) { setWStart(w); setWEnd(null); }
    else { cmpWeek(w, wStart) < 0 ? (setWStart(w), setWEnd(null)) : setWEnd(w); }
  };

  const handleApply = () => {
    if (wStart) {
      const eff = wEnd || wStart; // single week when no end selected
      const start = isoWeekToDate(wStart.year, wStart.week);
      const endMon = isoWeekToDate(eff.year, eff.week);
      const end = new Date(endMon); end.setDate(endMon.getDate() + 6);
      onCustomRange({ start, end }); onChange('custom'); setOpen(false);
    }
  };

  // Button label
  const getWkInfo = d => {
    const dt = new Date(d); dt.setHours(0,0,0,0);
    dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
    const yr = dt.getFullYear();
    return { year: yr, week: Math.ceil(((dt - new Date(yr,0,1)) / 86400000 + 1) / 7) };
  };
  let label = PRESET_LABELS[value] || value;
  if (value === 'custom' && customRange) {
    const s = getWkInfo(customRange.start), e = getWkInfo(customRange.end);
    if (s.week === e.week && s.year === e.year) {
      label = `W${s.week} \u2019${String(s.year).slice(2)}`;
    } else {
      label = `W${s.week} \u2019${String(s.year).slice(2)} \u2013 W${e.week} \u2019${String(e.year).slice(2)}`;
    }
  }

  const groups = [
    { key: 'quick', items: [
      { label: 'Last 7 days',  value: 'last_7_days'  },
      { label: 'Last 30 days', value: 'last_30_days' },
      { label: 'Last 60 days', value: 'last_60_days' },
      { label: 'Last 90 days', value: 'last_90_days' },
    ]},
    { key: 'last', label: 'Last', items: [
      { label: 'Last week',  value: 'last_week'  },
      { label: 'Last month', value: 'last_month' },
      { label: 'Last year',  value: 'last_year'  },
    ]},
    { key: 'ptd', label: 'Period to date', items: [
      { label: 'Week to date',  value: 'week_to_date'  },
      { label: 'Month to date', value: 'month_to_date' },
      { label: 'Year to date',  value: 'ytd'           },
    ]},
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-blue-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        style={{ minWidth: '160px' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span className="flex-1 text-left">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 flex overflow-hidden" style={{ minWidth: '580px' }}>

          {/* Left — presets */}
          <div className="w-44 border-r border-gray-100 py-2 flex-shrink-0">
            {groups.map(group => (
              <div key={group.key} className="mb-1">
                {group.label ? (
                  <>
                    <button onClick={() => setExpanded(e => e === group.key ? null : group.key)}
                      className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 font-medium">
                      <span>{group.label}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points={expanded === group.key ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}/>
                      </svg>
                    </button>
                    {expanded === group.key && group.items.map(item => (
                      <button key={item.value} onClick={() => applyPreset(item.value)}
                        className={`w-full text-left px-6 py-1.5 text-sm rounded ${value === item.value ? 'text-blue-600 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {item.label}
                      </button>
                    ))}
                  </>
                ) : group.items.map(item => (
                  <button key={item.value} onClick={() => applyPreset(item.value)}
                    className={`w-full text-left px-4 py-2 text-sm ${value === item.value ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Right — week picker */}
          <div className="p-4 flex-1 flex flex-col" style={{ minWidth: 0 }}>
            {/* Range display */}
            <div className="flex items-center gap-2 mb-3">
              <div className={`flex-1 border rounded-lg px-3 py-1.5 text-sm text-center ${wStart ? 'border-blue-400 text-gray-800 font-semibold' : 'border-gray-300 text-gray-400'}`}>
                {wStart ? `W${wStart.week} \u2019${String(wStart.year).slice(2)}` : 'Start week'}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" style={{ flexShrink:0 }}>
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
              <div className={`flex-1 border rounded-lg px-3 py-1.5 text-sm text-center ${wEnd ? 'border-blue-400 text-gray-800 font-semibold' : 'border-gray-300 text-gray-400'}`}>
                {wEnd ? `W${wEnd.week} \u2019${String(wEnd.year).slice(2)}` : 'End week'}
              </div>
            </div>

            {/* Week grid — scrollable, newest year first */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', maxHeight: '280px' }} className="pr-1">
              {Object.keys(weeksByYear).sort((a, b) => b - a).map(yr => (
                <div key={yr} className="mb-3">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{yr}</p>
                  <div className="grid grid-cols-4 gap-1">
                    {[...weeksByYear[yr]].reverse().map(w => {
                      const isS     = weekKey(wStart)   === weekKey(w);
                      const isE     = weekKey(wEnd)     === weekKey(w);
                      const mid     = inRange(w) && !isS && !isE;
                      const isToday = todayWeek && weekKey(w) === weekKey(todayWeek);
                      return (
                        <button key={weekKey(w)} onClick={() => handleWeekClick(w)}
                          title={`${fmtShort(w.mon)} – ${fmtShort(w.sun)}`}
                          className={`px-1 py-1.5 rounded-lg text-center transition leading-tight ${isToday ? 'week-current' : ''} ${
                            isS || isE ? 'bg-blue-600 text-white font-semibold shadow-sm' :
                            mid        ? 'bg-blue-50 text-blue-700' :
                            isToday    ? 'ring-2 ring-blue-400 text-gray-800 font-semibold' :
                                         'text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <div className="text-xs font-semibold">W{w.week}{isToday && !isS && !isE ? ' ·' : ''}</div>
                          <div style={{ fontSize: '9px' }} className={isS || isE ? 'text-blue-100' : isToday ? 'text-blue-500' : 'text-gray-400'}>
                            {fmtShort(w.mon)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                {!wStart ? 'Select a start week' :
                 !wEnd   ? 'Select end week — or Apply for single week' :
                 `W${wStart.week} \u2013 W${wEnd.week}, ${wEnd.year}`}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="px-4 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={handleApply} disabled={!wStart}
                  className="px-4 py-1.5 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Custom chart tick with flag emoji + name (horizontal charts — flag above name)
function FlagTick({ x, y, payload }) {
  const flag = MARKETPLACE_FLAGS[payload.value] || '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={14} textAnchor="middle" fill="#6B7280" fontSize={11}>
        {flag}
      </text>
      <text x={0} y={0} dy={26} textAnchor="middle" fill="#6B7280" fontSize={10}>
        {payload.value}
      </text>
    </g>
  );
}

// Custom chart tick with flag + name (vertical bar chart — names on Y axis)
function FlagTickY({ x, y, payload }) {
  const flag = MARKETPLACE_FLAGS[payload.value] || '';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-4} y={-8} textAnchor="end" fill="#6B7280" fontSize={11}>{flag}</text>
      <text x={-4} y={6}  textAnchor="end" fill="#6B7280" fontSize={10}>{payload.value}</text>
    </g>
  );
}

// === SALES GLOBE COMPONENT ===

const GLOBE_COUNTRIES = {
  NL: { lat: 52.37, lng: 4.90,  name: 'Netherlands', flag: '\uD83C\uDDF3\uD83C\uDDF1' },
  FR: { lat: 46.20, lng: 2.20,  name: 'France',      flag: '\uD83C\uDDEB\uD83C\uDDF7' },
  DE: { lat: 51.16, lng: 10.45, name: 'Germany',     flag: '\uD83C\uDDE9\uD83C\uDDEA' },
  IT: { lat: 41.87, lng: 12.57, name: 'Italy',       flag: '\uD83C\uDDEE\uD83C\uDDF9' },
  ES: { lat: 40.46, lng: -3.75, name: 'Spain',       flag: '\uD83C\uDDEA\uD83C\uDDF8' },
  BE: { lat: 50.50, lng:  4.47, name: 'Belgium',     flag: '\uD83C\uDDE7\uD83C\uDDEA' },
};
const GLOBE_MP_COUNTRY = {
  'Bol': 'NL', 'AMZ - NL': 'NL', 'AMZ - FR': 'FR',
  'AMZ - DE': 'DE', 'AMZ - IT': 'IT', 'AMZ - ES': 'ES', 'AMZ - BE': 'BE',
};

const COUNTRY_ISO = { NL: 528, FR: 250, DE: 276, IT: 380, ES: 724, BE: 56 };

function SalesGlobe({ marketplaceData }) {
  const containerRef      = React.useRef(null);
  const globeWrapRef      = React.useRef(null);
  const globeRef          = React.useRef(null);
  const [globeChannel,    setGlobeChannel]    = React.useState('all');
  const [hoveredId,       setHoveredId]       = React.useState(null);
  const [selectedCountry, setSelectedCountry] = React.useState(null); // country code e.g. 'IT'

  // Globe-visible country data (respects channel filter)
  const countryData = React.useMemo(() => {
    const filtered = marketplaceData.filter(m =>
      globeChannel === 'bol' ? m.name === 'Bol' :
      globeChannel === 'amz' ? m.name.startsWith('AMZ') : true
    );
    const map = {};
    filtered.forEach(m => {
      const code = GLOBE_MP_COUNTRY[m.name];
      if (!code) return;
      if (!map[code]) map[code] = { ...GLOBE_COUNTRIES[code], code, isoId: COUNTRY_ISO[code], revenue: 0, orders: 0, adSpend: 0 };
      map[code].revenue += m.revenue;
      map[code].orders  += m.orders;
      map[code].adSpend += m.adSpend;
    });
    return Object.values(map).filter(d => d.revenue > 0);
  }, [marketplaceData, globeChannel]);

  // Full country detail for sidebar (respects channel filter + builds weekly trend)
  const countryDetail = React.useMemo(() => {
    if (!selectedCountry) return null;
    let mps = marketplaceData.filter(m => GLOBE_MP_COUNTRY[m.name] === selectedCountry);
    if (globeChannel === 'bol') mps = mps.filter(m => m.name === 'Bol');
    else if (globeChannel === 'amz') mps = mps.filter(m => m.name.startsWith('AMZ'));
    if (!mps.length) return null;
    const revenue = mps.reduce((s, m) => s + m.revenue, 0);
    const adSpend = mps.reduce((s, m) => s + m.adSpend, 0);
    const orders  = mps.reduce((s, m) => s + m.orders,  0);
    const units   = mps.reduce((s, m) => s + m.units,   0);
    const sfa     = mps.reduce((s, m) => s + m.salesFromAds, 0);
    const roas    = adSpend > 0 ? sfa / adSpend : 0;
    const aov     = orders  > 0 ? revenue / orders : 0;
    const adPct   = revenue > 0 ? (adSpend / revenue) * 100 : 0;
    const parseWL = lbl => { const mx = lbl && lbl.match(/W(\d+) '(\d+)/); return mx ? { week: +mx[1], year: 2000 + +mx[2] } : { week: 0, year: 0 }; };
    const weekMap = {};
    mps.forEach(mp => {
      (mp.weeklyTrend || []).forEach(w => {
        if (!weekMap[w.weekLabel]) weekMap[w.weekLabel] = { weekLabel: w.weekLabel, revenue: 0 };
        weekMap[w.weekLabel].revenue += w.revenue || 0;
      });
    });
    const weeklyTrend = Object.values(weekMap).sort((a, b) => {
      const pa = parseWL(a.weekLabel), pb = parseWL(b.weekLabel);
      return pa.year !== pb.year ? pa.year - pb.year : pa.week - pb.week;
    });
    return { ...GLOBE_COUNTRIES[selectedCountry], code: selectedCountry, revenue, adSpend, orders, units, sfa, roas, aov, adPct, marketplaces: mps, weeklyTrend };
  }, [selectedCountry, marketplaceData, globeChannel]);

  const isoRevMap = React.useMemo(() => {
    const m = {}; countryData.forEach(d => { if (d.isoId) m[d.isoId] = d; }); return m;
  }, [countryData]);
  const maxRev = React.useMemo(() => Math.max(...countryData.map(d => d.revenue), 1), [countryData]);

  // Resize globe when sidebar opens/closes
  React.useEffect(() => {
    const t = setTimeout(() => {
      const g = globeRef.current; const w = globeWrapRef.current;
      if (g && w && w.offsetWidth > 50) g.width(w.offsetWidth);
    }, 320);
    return () => clearTimeout(t);
  }, [selectedCountry]);

  // Init globe once
  React.useEffect(() => {
    if (!containerRef.current || typeof Globe === 'undefined') return;
    const w = containerRef.current.offsetWidth || 600;
    const g = Globe()(containerRef.current)
      .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
      .backgroundColor('rgba(0,0,0,0)')
      .width(w).height(440);
    g.controls().enableZoom = true; g.controls().autoRotate = true;
    g.controls().autoRotateSpeed = 0.3; g.controls().minDistance = 115; g.controls().maxDistance = 500;
    g.pointOfView({ lat: 52, lng: 12, altitude: 1.1 }, 0);
    g.controls().addEventListener('start', () => { g.controls().autoRotate = false; });
    g.controls().addEventListener('end',   () => { setTimeout(() => { if (globeRef.current) g.controls().autoRotate = true; }, 3000); });
    g.onGlobeClick(() => setSelectedCountry(null));
    if (typeof topojson !== 'undefined') {
      fetch('//unpkg.com/world-atlas@2.0.2/countries-110m.json').then(r => r.json()).then(world => {
        const features = topojson.feature(world, world.objects.countries).features;
        g.polygonsData(features)
          .polygonAltitude(0.006).polygonCapColor(() => 'rgba(20,40,70,0.2)')
          .polygonSideColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(() => '#1e3a5f')
          .polygonLabel(() => '')
          .onPolygonHover(poly => setHoveredId(poly ? +poly.id : null))
          .onPolygonClick(poly => {
            if (!poly) return;
            const entry = Object.entries(COUNTRY_ISO).find(([, v]) => v === +poly.id);
            if (entry) setSelectedCountry(c => c === entry[0] ? null : entry[0]);
          });
      });
    }
    globeRef.current = g;
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; globeRef.current = null; };
  }, []);

  // Polygon colors — reflect hover + selected
  React.useEffect(() => {
    const g = globeRef.current;
    if (!g || !g.polygonsData || !g.polygonsData().length) return;
    g.polygonCapColor(d => {
      const id = +d.id; const rev = isoRevMap[id];
      const isSel = selectedCountry && COUNTRY_ISO[selectedCountry] === id;
      if (isSel) return 'rgba(251,191,36,0.95)';
      if (id === hoveredId) return rev ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.25)';
      if (rev) return `rgba(245,158,11,${(0.35 + (rev.revenue / maxRev) * 0.45).toFixed(2)})`;
      return 'rgba(20,40,70,0.2)';
    })
    .polygonStrokeColor(d => { const id = +d.id; return (selectedCountry && COUNTRY_ISO[selectedCountry] === id) ? '#FBBF24' : id === hoveredId ? '#FCD34D' : '#1e3a5f'; })
    .polygonAltitude(d => { const id = +d.id; return (selectedCountry && COUNTRY_ISO[selectedCountry] === id) ? 0.03 : id === hoveredId ? 0.02 : isoRevMap[id] ? 0.01 : 0.006; });
  }, [hoveredId, isoRevMap, maxRev, selectedCountry]);

  // Points + rings
  React.useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (countryData.length === 0) { g.ringsData([]).pointsData([]); return; }
    const ptColor = globeChannel === 'bol' ? '#3B82F6' : globeChannel === 'amz' ? '#10B981' : '#F59E0B';
    const mkLabel = d => `<div style="background:rgba(15,23,42,.97);border:1px solid #475569;padding:10px 14px;border-radius:8px;font-family:Inter,sans-serif;min-width:150px"><div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:5px">${d.flag} ${d.name}</div><div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Revenue: <span style="color:#F59E0B;font-weight:700">\u20AC${d.revenue.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div><div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Orders: <span style="color:#e2e8f0;font-weight:600">${d.orders}</span></div><div style="font-size:11px;color:#94a3b8">Click to open details</div></div>`;
    g.ringsData(countryData).ringLat('lat').ringLng('lng')
      .ringColor(() => t => `rgba(245,158,11,${Math.max(0,1-t)})`)
      .ringMaxRadius(d => Math.sqrt(d.revenue/maxRev)*5+1).ringPropagationSpeed(0.85).ringRepeatPeriod(1700)
      .pointsData(countryData).pointLat('lat').pointLng('lng')
      .pointColor(d => d.code === selectedCountry ? '#FCD34D' : ptColor)
      .pointAltitude(d => (d.revenue/maxRev)*0.18+0.02).pointRadius(d => Math.sqrt(d.revenue/maxRev)*0.9+0.25)
      .pointLabel(mkLabel)
      .onPointClick(d => setSelectedCountry(c => c === d.code ? null : d.code));
  }, [countryData, globeChannel, maxRev, selectedCountry]);

  const totalRev      = countryData.reduce((s, d) => s + d.revenue, 0);
  const hoveredC      = hoveredId ? countryData.find(d => d.isoId === hoveredId) : null;
  const channelLabel  = globeChannel === 'bol' ? '\uD83C\uDDF3\uD83C\uDDF1 BOL' : globeChannel === 'amz' ? '\uD83D\uDECD\uFE0F AMZ' : 'All channels';

  return (
    <div className="bg-slate-900 rounded-xl shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-white">Sales by Country</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {selectedCountry && countryDetail
              ? `${countryDetail.flag} ${countryDetail.name} — click X to close`
              : hoveredC
                ? `${hoveredC.flag} ${hoveredC.name} · \u20AC${hoveredC.revenue.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} · Click to open`
                : 'Click a country to open details · Scroll to zoom'}
          </p>
        </div>
        <div className="flex gap-1 bg-slate-800 p-1 rounded-lg">
          {[{label:'All',value:'all'},{label:'\uD83C\uDDF3\uD83C\uDDF1 BOL',value:'bol'},{label:'\uD83D\uDECD\uFE0F AMZ',value:'amz'}].map(opt => (
            <button key={opt.value} onClick={() => setGlobeChannel(opt.value)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${globeChannel===opt.value?'bg-amber-500 text-slate-900 font-semibold':'text-slate-400 hover:text-white'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Globe + Sidebar ── */}
      <div className="flex" style={{ height: '440px' }}>

        {/* Country sidebar */}
        {selectedCountry && countryDetail && (
          <div className="globe-sidebar bg-slate-800 border-r border-slate-700 flex flex-col flex-shrink-0 overflow-y-auto" style={{ width: '270px' }}>

            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
              <div className="flex items-center gap-2">
                <img src={`https://flagcdn.com/w40/${selectedCountry.toLowerCase()}.png`} alt={countryDetail.name} style={{ width: '28px', borderRadius: '3px', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', flexShrink: 0 }} />
                <div>
                  <p className="text-sm font-bold text-white leading-tight">{countryDetail.name}</p>
                  <p className="text-xs text-amber-400">{channelLabel}</p>
                </div>
              </div>
              <button onClick={() => setSelectedCountry(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white transition text-sm font-bold">
                ✕
              </button>
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 gap-px bg-slate-700 border-b border-slate-700 flex-shrink-0">
              {[
                { label: 'Revenue',    value: '\u20AC' + countryDetail.revenue.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}), color: 'text-amber-400' },
                { label: 'Ad Spend',   value: '\u20AC' + countryDetail.adSpend.toFixed(0), color: 'text-red-400' },
                { label: 'ROAS',       value: countryDetail.roas.toFixed(2), color: countryDetail.roas >= 1.5 ? 'text-green-400' : countryDetail.roas >= 1.0 ? 'text-amber-400' : 'text-red-400' },
                { label: 'Orders',     value: countryDetail.orders, color: 'text-purple-400' },
                { label: 'Units',      value: countryDetail.units,  color: 'text-indigo-400' },
                { label: 'Avg AOV',    value: '\u20AC' + countryDetail.aov.toFixed(2), color: 'text-orange-400' },
                { label: 'Ad Revenue', value: '\u20AC' + countryDetail.sfa.toFixed(0), color: 'text-green-400' },
                { label: 'Ad Spend %', value: countryDetail.adPct.toFixed(1) + '%', color: 'text-blue-400' },
              ].map((k, i) => (
                <div key={i} className="bg-slate-800 px-3 py-2">
                  <p className="text-xs text-slate-500 mb-0.5">{k.label}</p>
                  <p className={`text-sm font-bold ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>

            {/* Weekly trend sparkline */}
            <div className="px-3 pt-3 pb-1 flex-shrink-0">
              <p className="text-xs text-slate-400 mb-2 font-medium">Weekly Revenue</p>
              {countryDetail.weeklyTrend.length > 1 ? (
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={countryDetail.weeklyTrend} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="sidebarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#F59E0B" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#F59E0B" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 8, fill: '#64748b' }} interval="preserveStartEnd" />
                    <Tooltip formatter={v => `\u20AC${(+v).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`} contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:6, fontSize:11 }} labelStyle={{ color:'#94a3b8' }} />
                    <Area animationDuration={300} type="monotone" dataKey="revenue" stroke="#F59E0B" strokeWidth={1.5} fill="url(#sidebarGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-slate-600 italic">Not enough data for trend</p>
              )}
            </div>

            {/* Per-marketplace breakdown */}
            {countryDetail.marketplaces.length > 1 && (
              <div className="px-3 pt-2 pb-3 flex-shrink-0">
                <p className="text-xs text-slate-400 mb-2 font-medium">By Marketplace</p>
                <div className="space-y-2">
                  {countryDetail.marketplaces.map((m, i) => (
                    <div key={i} className="bg-slate-750 rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-white flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: MARKETPLACE_COLORS[m.name] || '#6B7280' }}></span>
                          {m.name}
                        </span>
                        <span className={`text-xs font-bold ${m.roas >= 1.5 ? 'text-green-400' : m.roas >= 1.0 ? 'text-amber-400' : 'text-red-400'}`}>ROAS {m.roas.toFixed(2)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 text-xs text-slate-400">
                        <span>Rev: <span className="text-amber-300 font-medium">\u20AC{m.revenue.toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0})}</span></span>
                        <span>Spend: <span className="text-white font-medium">\u20AC{m.adSpend.toFixed(0)}</span></span>
                        <span>Orders: <span className="text-white font-medium">{m.orders}</span></span>
                        <span>AOV: <span className="text-white font-medium">\u20AC{m.aov.toFixed(2)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Globe canvas wrapper */}
        <div ref={globeWrapRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div ref={containerRef} style={{ width: '100%', height: '440px' }} />
        </div>
      </div>

      {/* ── Country bar ── */}
      {countryData.length > 0 && (
        <div className="grid border-t border-slate-700" style={{ gridTemplateColumns: `repeat(${Math.min(countryData.length,6)},1fr)` }}>
          {[...countryData].sort((a,b) => b.revenue - a.revenue).map((d,i) => (
            <button key={i} onClick={() => setSelectedCountry(c => c === d.code ? null : d.code)}
              className={`px-3 py-2 text-center border-r border-slate-700 last:border-r-0 transition hover:bg-slate-700 ${d.code === selectedCountry ? 'bg-slate-700 ring-1 ring-inset ring-amber-500' : ''}`}>
              <p className="text-xs text-slate-400 mb-0.5 flex items-center justify-center gap-1"><img src={`https://flagcdn.com/w20/${d.code.toLowerCase()}.png`} style={{height:'10px',borderRadius:'1px'}} />{d.name}</p>
              <p className="text-sm font-bold text-amber-400">{'\u20AC'}{d.revenue.toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0})}</p>
              <p className="text-xs text-slate-500">{totalRev>0?((d.revenue/totalRev)*100).toFixed(1):0}%</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// === REPORTS HELPERS ===

const MONTH_NAMES_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getAvailableWeeks(rawData) {
  if (!rawData) return [];
  const map = new Map();
  const scan = (parsed) => {
    if (!parsed || !parsed.marketplaces) return;
    Object.values(parsed.marketplaces).forEach(function(mp) {
      (mp.totalSales || []).forEach(function(v) {
        if (v.value !== null) {
          const key = v.year + '-' + String(v.week).padStart(2,'0');
          if (!map.has(key)) map.set(key, { year: v.year, week: v.week, label: v.weekLabel });
        }
      });
    });
  };
  scan(rawData.amazon);
  scan(rawData.bolScore);
  return Array.from(map.values()).sort(function(a,b){ return a.year !== b.year ? a.year - b.year : a.week - b.week; });
}

function getAvailableMonths(weeks) {
  const map = new Map();
  weeks.forEach(function(w) {
    const d = isoWeekToDate(w.year, w.week);
    const y = d.getFullYear(), m = d.getMonth();
    const key = y + '-' + m;
    if (!map.has(key)) map.set(key, { year: y, month: m });
  });
  return Array.from(map.values()).sort(function(a,b){ return a.year !== b.year ? a.year - b.year : a.month - b.month; });
}

function generateNarrative(data, type, periodLabel, compLabel) {
  const { bol, amzList, amzRev, amzAd, amzRoas, totalRev, totalRoas, priorTotalRev } = data;
  const fmt = function(v) { return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const pct = function(a, b) { return b > 0 ? ((a - b) / b * 100).toFixed(1) : null; };
  const lines = [];
  const totalChg = pct(totalRev, priorTotalRev);
  let s = periodLabel + ' generated total revenue of \u20AC' + fmt(totalRev);
  if (totalChg !== null) s += ', ' + (parseFloat(totalChg) >= 0 ? 'up' : 'down') + ' ' + Math.abs(totalChg) + '% vs ' + compLabel;
  lines.push(s + '. ');
  const bolShare = totalRev > 0 ? (bol.revenue / totalRev * 100).toFixed(0) : 0;
  const bolChg = pct(bol.revenue, bol.priorRevenue);
  let bs = 'BOL.com contributed \u20AC' + fmt(bol.revenue) + ' (' + bolShare + '% of total)';
  if (bol.roas > 0) bs += ' with a ROAS of ' + bol.roas.toFixed(2);
  if (bolChg !== null) bs += ', ' + (parseFloat(bolChg) >= 0 ? 'up' : 'down') + ' ' + Math.abs(bolChg) + '% vs ' + compLabel;
  lines.push(bs + '. ');
  const amzShare = totalRev > 0 ? (amzRev / totalRev * 100).toFixed(0) : 0;
  const activeAmz = amzList.filter(function(m){ return m.revenue > 0; }).sort(function(a,b){ return b.revenue - a.revenue; });
  let as2 = 'Amazon EU contributed \u20AC' + fmt(amzRev) + ' (' + amzShare + '% of total)';
  if (amzRoas > 0) as2 += ' with a ROAS of ' + amzRoas.toFixed(2);
  if (activeAmz.length > 0) {
    const top = activeAmz.slice(0,3).map(function(m){ return m.name.replace('AMZ - ','') + ' (\u20AC' + fmt(m.revenue) + ')'; }).join(', ');
    as2 += '. Top markets: ' + top;
  }
  lines.push(as2 + '. ');
  if (totalRoas > 0) {
    const eff = totalRoas >= 2.0 ? 'excellent' : totalRoas >= 1.5 ? 'strong' : totalRoas >= 1.0 ? 'adequate' : 'below breakeven';
    lines.push('Ad efficiency was ' + eff + ' with a combined ROAS of ' + totalRoas.toFixed(2) + ' across \u20AC' + fmt((bol.adSpend || 0) + amzAd) + ' total ad spend.');
  }
  return lines.join('');
}

// === INVENTORY TAB COMPONENT ===

const BACKEND = 'http://localhost:5000';

function InventoryTab({ rawData }) {
  const [items,      setItems]      = React.useState([]);
  const [shipments,  setShipments]  = React.useState([]);
  const [loading,    setLoading]    = React.useState(true);
  const [error,      setError]      = React.useState(null);
  const [filter,     setFilter]     = React.useState('all'); // all | low | critical | inbound
  const [sortKey,    setSortKey]    = React.useState('days');
  const [sortDir,    setSortDir]    = React.useState('asc');

  React.useEffect(function() {
    setLoading(true); setError(null);
    Promise.all([
      fetch(BACKEND + '/api/inventory').then(function(r){ if(!r.ok) throw new Error('Inventory fetch failed'); return r.json(); }),
      fetch(BACKEND + '/api/inbound-shipments').then(function(r){ if(!r.ok) throw new Error('Shipments fetch failed'); return r.json(); }),
    ]).then(function([invData, shipData]) {
      // Compute daily velocity from rawData (units sold per day in last 30d)
      var velocityMap = {};
      if (rawData) {
        var allMPs = Object.values((rawData.bolScore && rawData.bolScore.marketplaces) || {})
          .concat(Object.values((rawData.amazon && rawData.amazon.marketplaces) || {}));
        allMPs.forEach(function(mp) {
          (mp.totalUnits || []).slice(-5).forEach(function(w) {
            if (!w || w.value == null) return;
            // We don't have SKU-level data from sheets, so velocity is aggregate
          });
        });
      }
      setItems(invData.items || []);
      setShipments(shipData.shipments || []);
      setLoading(false);
    }).catch(function(e) {
      setError(e.message);
      setLoading(false);
    });
  }, []);

  // Status helper
  function stockStatus(item) {
    if (item.days == null) return 'unknown';
    if (item.days <= 10)  return 'critical';
    if (item.days <= 30)  return 'low';
    return 'healthy';
  }

  // Enrich items with days_remaining if velocity available
  var enriched = items.map(function(item) {
    return Object.assign({}, item, { days: item.daily_velocity > 0 ? Math.round(item.stock / item.daily_velocity) : null });
  });

  // Filter
  var filtered = enriched.filter(function(item) {
    var s = stockStatus(item);
    if (filter === 'critical') return s === 'critical';
    if (filter === 'low')      return s === 'low' || s === 'critical';
    if (filter === 'inbound')  return item.inbound > 0;
    return true;
  });

  // Sort
  filtered = filtered.slice().sort(function(a, b) {
    var av = a[sortKey], bv = b[sortKey];
    if (av == null) return 1; if (bv == null) return -1;
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  var totalSKUs    = enriched.length;
  var criticalCt   = enriched.filter(function(i){ return stockStatus(i) === 'critical'; }).length;
  var lowCt        = enriched.filter(function(i){ return stockStatus(i) === 'low'; }).length;
  var inboundCt    = shipments.length;
  var totalStock   = enriched.reduce(function(s, i){ return s + (i.stock || 0); }, 0);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(function(d){ return d === 'asc' ? 'desc' : 'asc'; });
    else { setSortKey(key); setSortDir('asc'); }
  }

  var statusColors = { healthy: 'bg-green-100 text-green-700', low: 'bg-amber-100 text-amber-700', critical: 'bg-red-100 text-red-700', unknown: 'bg-gray-100 text-gray-500' };
  var statusLabels = { healthy: 'Healthy', low: 'Low Stock', critical: 'Critical', unknown: 'No velocity data' };

  if (loading) return (
    <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Loading inventory from Ectaroship…</div>
    </div>
  );

  if (error) return (
    <div className="flex-1 overflow-auto p-6">
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-lg">
        <p className="text-red-700 font-semibold mb-1">Could not connect to backend</p>
        <p className="text-red-500 text-sm mb-3">{error}</p>
        <p className="text-gray-500 text-xs">Make sure the Python backend is running:<br/>
          <code className="bg-gray-100 px-1 rounded">cd d:/Dashboard/backend &amp;&amp; uvicorn server:app --port 5000</code>
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        {[
          { label: 'Total SKUs',       value: totalSKUs,  color: 'border-blue-500',  bg: 'bg-blue-50',  text: 'text-blue-700' },
          { label: 'Critical Stock',   value: criticalCt, color: 'border-red-500',   bg: 'bg-red-50',   text: 'text-red-700' },
          { label: 'Low Stock',        value: lowCt,      color: 'border-amber-500', bg: 'bg-amber-50', text: 'text-amber-700' },
          { label: 'Inbound Shipments',value: inboundCt,  color: 'border-green-500', bg: 'bg-green-50', text: 'text-green-700' },
        ].map(function(c) {
          return (
            <div key={c.label} className={'bg-white rounded-xl p-4 border-l-4 shadow-sm ' + c.color}>
              <p className="text-xs text-gray-500 font-medium mb-1">{c.label}</p>
              <p className={'text-3xl font-bold ' + c.text}>{c.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 mb-4">
        {['all','low','critical','inbound'].map(function(f) {
          return (
            <button key={f} onClick={function(){ setFilter(f); }}
              className={'px-3 py-1.5 rounded-lg text-xs font-medium transition ' + (filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50')}>
              {f === 'all' ? 'All SKUs' : f === 'low' ? 'Low Stock' : f === 'critical' ? 'Critical' : 'Inbound'}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-gray-400 self-center">{filtered.length} items</span>
      </div>

      {/* Stock table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {[
                  { key: 'sku',       label: 'SKU' },
                  { key: 'name',      label: 'Product' },
                  { key: 'stock',     label: 'In Stock' },
                  { key: 'inbound',   label: 'Inbound' },
                  { key: 'reserved',  label: 'Reserved' },
                  { key: 'days',      label: 'Days Left' },
                  { key: 'warehouse', label: 'Warehouse' },
                  { key: 'status',    label: 'Status' },
                ].map(function(col) {
                  return (
                    <th key={col.key} onClick={function(){ toggleSort(col.key); }}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none">
                      {col.label} {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No items match this filter.</td></tr>
              ) : filtered.map(function(item, i) {
                var s = stockStatus(item);
                return (
                  <tr key={item.sku || i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{item.sku}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{item.name}</td>
                    <td className="px-4 py-3 text-gray-700 font-semibold">{(item.stock || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-green-600 font-semibold">{item.inbound > 0 ? '+' + item.inbound.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{item.reserved > 0 ? item.reserved.toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 font-semibold">{item.days != null ? item.days + 'd' : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{item.warehouse || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={'px-2 py-0.5 rounded-full text-xs font-semibold ' + (statusColors[s] || statusColors.unknown)}>
                        {statusLabels[s] || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inbound shipments */}
      {shipments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Inbound Shipments</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Reference','Expected Date','Units','Status'].map(function(h) {
                    return <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {shipments.map(function(s, i) {
                  return (
                    <tr key={s.id || i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.reference || s.id}</td>
                      <td className="px-4 py-3 text-gray-700">{s.expected_date || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-800">{(s.units || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">{s.status || '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// === P&L / PROFITABILITY TAB COMPONENT ===

function ProfitTab({ rawData, dashboardData }) {
  const [cogs,        setCogs]        = React.useState(function(){
    try {
      var saved = JSON.parse(localStorage.getItem('hg_cogs') || 'null');
      if (saved && saved.length > 0) return saved;
    } catch(e) {}
    return (typeof DEFAULT_COGS !== 'undefined') ? DEFAULT_COGS : [];
  });
  const [importDate,  setImportDate]  = React.useState(localStorage.getItem('hg_cogs_date') || (typeof DEFAULT_COGS !== 'undefined' ? 'Auto-loaded from Excel files' : null));
  const [dragOver,    setDragOver]    = React.useState(false);
  const [parseError,  setParseError]  = React.useState(null);
  const [sortKey,     setSortKey]     = React.useState('net_profit');
  const [sortDir,     setSortDir]     = React.useState('desc');

  // Parse CSV → array of { sku, product_name, cogs_eur, shipping_eur, vat_pct }
  function parseCsv(text) {
    var lines = text.trim().split('\n');
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');
    var header = lines[0].split(',').map(function(h){ return h.trim().toLowerCase().replace(/[^a-z_]/g,''); });
    var required = ['sku','cogs_eur'];
    required.forEach(function(r){ if (!header.includes(r)) throw new Error('Missing column: ' + r); });
    return lines.slice(1).map(function(line) {
      var cols = line.split(',');
      function col(name) { var idx = header.indexOf(name); return idx >= 0 ? (cols[idx] || '').trim() : ''; }
      return {
        sku:          col('sku'),
        product_name: col('product_name') || col('name') || col('sku'),
        cogs_eur:     parseFloat(col('cogs_eur'))     || 0,
        shipping_eur: parseFloat(col('shipping_eur')) || 0,
        vat_pct:      parseFloat(col('vat_pct'))      || 0,
      };
    }).filter(function(r){ return r.sku; });
  }

  function loadFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var parsed = parseCsv(e.target.result);
        setCogs(parsed);
        var now = new Date().toLocaleString();
        setImportDate(now);
        localStorage.setItem('hg_cogs', JSON.stringify(parsed));
        localStorage.setItem('hg_cogs_date', now);
        setParseError(null);
      } catch(err) {
        setParseError(err.message);
      }
    };
    reader.readAsText(file);
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    loadFile(e.dataTransfer.files[0]);
  }

  // Build cogsMap keyed by SKU
  var cogsMap = {};
  cogs.forEach(function(r){ cogsMap[r.sku] = r; });

  // Aggregate revenue + orders per channel from dashboardData
  var channels = dashboardData && dashboardData.marketplaceData ? dashboardData.marketplaceData : [];

  // Per-channel P&L (using aggregate COGS rate if no SKU match — use avg)
  var avgCogs     = cogs.length > 0 ? cogs.reduce(function(s,r){ return s+r.cogs_eur; }, 0) / cogs.length : 0;
  var avgShipping = cogs.length > 0 ? cogs.reduce(function(s,r){ return s+r.shipping_eur; }, 0) / cogs.length : 0;

  // VAT is a pass-through (debit/credit for the company) — not charged to product cost
  var channelPnl = channels.map(function(ch) {
    var cogsTotal   = ch.orders * avgCogs;
    var shipTotal   = ch.orders * avgShipping;
    var grossProfit = ch.revenue - cogsTotal - shipTotal;
    var netProfit   = grossProfit - (ch.adSpend || 0);
    var margin      = ch.revenue > 0 ? (netProfit / ch.revenue * 100) : 0;
    return { name: ch.name, revenue: ch.revenue, adSpend: ch.adSpend || 0, cogsTotal: cogsTotal, shipTotal: shipTotal, grossProfit: grossProfit, netProfit: netProfit, margin: margin, orders: ch.orders };
  });

  // Totals
  var totals = channelPnl.reduce(function(acc, ch) {
    return {
      revenue:     acc.revenue     + ch.revenue,
      adSpend:     acc.adSpend     + ch.adSpend,
      cogsTotal:   acc.cogsTotal   + ch.cogsTotal,
      shipTotal:   acc.shipTotal   + ch.shipTotal,
      grossProfit: acc.grossProfit + ch.grossProfit,
      netProfit:   acc.netProfit   + ch.netProfit,
    };
  }, { revenue:0, adSpend:0, cogsTotal:0, shipTotal:0, grossProfit:0, netProfit:0 });
  totals.margin = totals.revenue > 0 ? (totals.netProfit / totals.revenue * 100) : 0;

  // Per-SKU table (from COGS data × estimated units from dashboardData aggregate)
  // Without SKU-level sales, we show COGS data so the user can see which SKUs are configured
  var skuRows = cogs.map(function(r) {
    var netPrice  = r.cogs_eur + r.shipping_eur + r.cogs_eur * 0.5; // rough est. if no real price
    return r;
  });

  function fmt(n)   { return '\u20AC' + (n || 0).toLocaleString('nl-NL', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  function fmtPct(n){ return (n || 0).toFixed(1) + '%'; }

  function marginColor(m) {
    if (m < 0)   return 'text-red-600';
    if (m < 10)  return 'text-red-500';
    if (m < 25)  return 'text-amber-600';
    return 'text-green-600';
  }
  function marginBadge(m) {
    if (m < 0)   return 'bg-red-100 text-red-700';
    if (m < 10)  return 'bg-red-50 text-red-600';
    if (m < 25)  return 'bg-amber-50 text-amber-700';
    return 'bg-green-50 text-green-700';
  }

  var hasCogs = cogs.length > 0;
  var hasData = channels.length > 0;

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">

      {/* COGS Import */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">COGS &amp; Cost Import</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Upload a CSV with columns: <code className="bg-gray-100 px-1 rounded">sku, product_name, cogs_eur, shipping_eur, vat_pct</code>
            </p>
          </div>
          {importDate && <span className="text-xs text-gray-400">Last imported: {importDate} · {cogs.length} SKUs</span>}
        </div>

        <div
          onDragOver={function(e){ e.preventDefault(); setDragOver(true); }}
          onDragLeave={function(){ setDragOver(false); }}
          onDrop={onDrop}
          className={'border-2 border-dashed rounded-xl p-8 text-center transition-colors ' + (dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300')}
        >
          <p className="text-sm text-gray-500 mb-3">Drag &amp; drop a CSV file here, or</p>
          <label className="cursor-pointer px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
            Choose File
            <input type="file" accept=".csv" className="hidden" onChange={function(e){ loadFile(e.target.files[0]); }} />
          </label>
        </div>

        {parseError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs">{parseError}</div>
        )}

        {hasCogs && !parseError && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs font-medium">
            ✓ {cogs.length} SKUs loaded {importDate === 'Auto-loaded from Excel files' ? '(auto-imported from your Excel files)' : '· Last upload: ' + importDate} · Avg COGS {fmt(avgCogs)} · Avg shipping {fmt(avgShipping)}
          </div>
        )}
      </div>

      {/* P&L Summary KPIs */}
      {hasData && hasCogs && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            {[
              { label: 'Revenue',        value: fmt(totals.revenue),    color: 'border-blue-500',   text: 'text-blue-700' },
              { label: 'COGS + Shipping',value: fmt(totals.cogsTotal + totals.shipTotal), color: 'border-orange-400', text: 'text-orange-600' },
              { label: 'Net Profit',     value: fmt(totals.netProfit),  color: totals.netProfit >= 0 ? 'border-green-500' : 'border-red-500', text: totals.netProfit >= 0 ? 'text-green-700' : 'text-red-700' },
              { label: 'Net Margin',     value: fmtPct(totals.margin),  color: totals.margin >= 20 ? 'border-green-500' : totals.margin >= 0 ? 'border-amber-400' : 'border-red-500', text: marginColor(totals.margin) },
            ].map(function(c) {
              return (
                <div key={c.label} className={'bg-white rounded-xl p-4 border-l-4 shadow-sm ' + c.color}>
                  <p className="text-xs text-gray-500 font-medium mb-1">{c.label}</p>
                  <p className={'text-2xl font-bold ' + c.text}>{c.value}</p>
                </div>
              );
            })}
          </div>

          {/* Per-channel P&L table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Channel P&amp;L Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Channel','Revenue','Ad Spend','COGS','Shipping','Gross Profit','Net Profit','Margin'].map(function(h){
                      return <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {channelPnl.map(function(ch, i) {
                    return (
                      <tr key={ch.name} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{ch.name}</td>
                        <td className="px-4 py-3 text-gray-700">{fmt(ch.revenue)}</td>
                        <td className="px-4 py-3 text-red-500">{fmt(ch.adSpend)}</td>
                        <td className="px-4 py-3 text-orange-500">{fmt(ch.cogsTotal)}</td>
                        <td className="px-4 py-3 text-orange-400">{fmt(ch.shipTotal)}</td>
                        <td className="px-4 py-3 text-gray-700 font-medium">{fmt(ch.grossProfit)}</td>
                        <td className={'px-4 py-3 font-bold ' + marginColor(ch.margin)}>{fmt(ch.netProfit)}</td>
                        <td className="px-4 py-3">
                          <span className={'px-2 py-0.5 rounded-full text-xs font-semibold ' + marginBadge(ch.margin)}>{fmtPct(ch.margin)}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Totals row */}
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                    <td className="px-4 py-3 text-gray-800">Total</td>
                    <td className="px-4 py-3 text-gray-800">{fmt(totals.revenue)}</td>
                    <td className="px-4 py-3 text-red-600">{fmt(totals.adSpend)}</td>
                    <td className="px-4 py-3 text-orange-600">{fmt(totals.cogsTotal)}</td>
                    <td className="px-4 py-3 text-orange-500">{fmt(totals.shipTotal)}</td>
                    <td className="px-4 py-3 text-gray-800">{fmt(totals.grossProfit)}</td>
                    <td className={'px-4 py-3 ' + marginColor(totals.margin)}>{fmt(totals.netProfit)}</td>
                    <td className="px-4 py-3">
                      <span className={'px-2 py-0.5 rounded-full text-xs font-semibold ' + marginBadge(totals.margin)}>{fmtPct(totals.margin)}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* COGS per-SKU table */}
      {hasCogs && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Product Cost Table ({cogs.length} SKUs)</h3>
            <span className="text-xs text-gray-400">Revenue data per SKU available after BOL/Amazon API connection</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['SKU','Product Name','COGS (€)','Shipping (€)','VAT %','Total Cost/Unit'].map(function(h){
                    return <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {cogs.map(function(r, i) {
                  var totalCost = r.cogs_eur + r.shipping_eur;
                  return (
                    <tr key={r.sku || i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.sku}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium">{r.product_name}</td>
                      <td className="px-4 py-3 text-orange-600 font-semibold">{fmt(r.cogs_eur)}</td>
                      <td className="px-4 py-3 text-orange-400">{fmt(r.shipping_eur)}</td>
                      <td className="px-4 py-3 text-gray-500">{r.vat_pct > 0 ? r.vat_pct + '%' : '—'}</td>
                      <td className="px-4 py-3 font-bold text-gray-800">{fmt(totalCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasCogs && (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400 shadow-sm">
          <p className="text-2xl mb-2">📊</p>
          <p className="font-medium mb-1">No COGS data yet</p>
          <p className="text-sm">Upload a CSV above to start calculating profit margins.</p>
        </div>
      )}
    </div>
  );
}

// === REPORTS TAB COMPONENT ===

function ReportsTab({ rawData }) {
  const [reportType, setReportType] = React.useState('weekly');

  const availableWeeks  = React.useMemo(function(){ return getAvailableWeeks(rawData); }, [rawData]);
  const availableMonths = React.useMemo(function(){ return getAvailableMonths(availableWeeks); }, [availableWeeks]);

  const [selWeek,  setSelWeek]  = React.useState(null);
  const [selMonth, setSelMonth] = React.useState(null);

  React.useEffect(function(){
    if (availableWeeks.length > 0) setSelWeek(function(prev){ return prev || availableWeeks[availableWeeks.length - 1]; });
  }, [availableWeeks]);
  React.useEffect(function(){
    if (availableMonths.length > 0) setSelMonth(function(prev){ return prev || availableMonths[availableMonths.length - 1]; });
  }, [availableMonths]);

  const reportData = React.useMemo(function() {
    if (!rawData) return null;
    if (reportType === 'weekly' && !selWeek) return null;
    if (reportType === 'monthly' && !selMonth) return null;

    const { amazon, bolScore } = rawData;
    const mp = {};
    if (amazon && amazon.marketplaces) Object.keys(amazon.marketplaces).forEach(function(k){ mp[k] = amazon.marketplaces[k]; });
    if (bolScore && bolScore.marketplaces) Object.keys(bolScore.marketplaces).forEach(function(k){ mp[k] = bolScore.marketplaces[k]; });
    const allNames = ['Bol','AMZ - NL','AMZ - FR','AMZ - DE','AMZ - IT','AMZ - ES','AMZ - BE'];
    const mpNames = allNames.filter(function(n){ return !!mp[n]; });

    function fp(arr) {
      if (!arr) return [];
      if (reportType === 'weekly') return arr.filter(function(v){ return v.value !== null && v.year === selWeek.year && v.week === selWeek.week; });
      return arr.filter(function(v) {
        if (v.value === null) return false;
        const ws = isoWeekToDate(v.year, v.week);
        return ws.getFullYear() === selMonth.year && ws.getMonth() === selMonth.month;
      });
    }

    const priorWeekIdx = availableWeeks.findIndex(function(w){ return selWeek && w.year === selWeek.year && w.week === selWeek.week; }) - 1;
    const priorWeek = priorWeekIdx >= 0 ? availableWeeks[priorWeekIdx] : null;
    const priorMonthObj = selMonth ? (selMonth.month === 0 ? { year: selMonth.year - 1, month: 11 } : { year: selMonth.year, month: selMonth.month - 1 }) : null;

    function fpp(arr) {
      if (!arr) return [];
      if (reportType === 'weekly') {
        if (!priorWeek) return [];
        return arr.filter(function(v){ return v.value !== null && v.year === priorWeek.year && v.week === priorWeek.week; });
      }
      if (!priorMonthObj) return [];
      return arr.filter(function(v) {
        if (v.value === null) return false;
        const ws = isoWeekToDate(v.year, v.week);
        return ws.getFullYear() === priorMonthObj.year && ws.getMonth() === priorMonthObj.month;
      });
    }

    const mpData = mpNames.map(function(name) {
      const d = mp[name] || {};
      const fS = fp(d.totalSales || []), fA = fp(d.adSpend || []), fO = fp(d.totalOrders || []);
      const fU = fp(d.totalUnits || []), fSfa = fp(d.salesFromAds || []);
      const rev = sumValues(fS), ad = sumValues(fA), ord = sumValues(fO), sfa = sumValues(fSfa);
      const priorRev = sumValues(fpp(d.totalSales || [])), priorAd = sumValues(fpp(d.adSpend || [])), priorSFA = sumValues(fpp(d.salesFromAds || []));
      return { name, revenue: rev, adSpend: ad, orders: ord, units: sumValues(fU), salesFromAds: sfa,
        roas: ad > 0 ? sfa / ad : 0, aov: ord > 0 ? rev / ord : 0,
        priorRevenue: priorRev, priorAdSpend: priorAd, priorRoas: priorAd > 0 ? priorSFA / priorAd : 0,
        color: MARKETPLACE_COLORS[name] || '#6B7280',
        weeklyBreakdown: fS.map(function(s){ return { weekLabel: s.weekLabel, revenue: s.value || 0 }; }),
      };
    });

    const bol = mpData.find(function(m){ return m.name === 'Bol'; }) || { revenue:0, orders:0, roas:0, adSpend:0, salesFromAds:0, priorRevenue:0 };
    const amzList = mpData.filter(function(m){ return m.name.startsWith('AMZ'); });
    const amzRev = amzList.reduce(function(s,m){ return s+m.revenue; }, 0);
    const amzOrd = amzList.reduce(function(s,m){ return s+m.orders; }, 0);
    const amzAd  = amzList.reduce(function(s,m){ return s+m.adSpend; }, 0);
    const amzSFA = amzList.reduce(function(s,m){ return s+m.salesFromAds; }, 0);
    const amzRoas = amzAd > 0 ? amzSFA / amzAd : 0;
    const amzPriorRev = amzList.reduce(function(s,m){ return s+m.priorRevenue; }, 0);
    const totalRev = bol.revenue + amzRev;
    const totalOrd = bol.orders + amzOrd;
    const totalAd  = bol.adSpend + amzAd;
    const totalSFA = bol.salesFromAds + amzSFA;
    const totalRoas = totalAd > 0 ? totalSFA / totalAd : 0;
    const totalAov  = totalOrd > 0 ? totalRev / totalOrd : 0;
    const priorTotalRev = bol.priorRevenue + amzPriorRev;

    let trendData = [];
    if (reportType === 'monthly') {
      const wlMap = new Map();
      mpNames.forEach(function(name) {
        fp(mp[name] && mp[name].totalSales || []).forEach(function(v) {
          if (!wlMap.has(v.weekLabel)) wlMap.set(v.weekLabel, { weekLabel: v.weekLabel, bol: 0, amazon: 0, week: v.week });
          const e = wlMap.get(v.weekLabel);
          if (name === 'Bol') e.bol += v.value || 0; else e.amazon += v.value || 0;
        });
      });
      trendData = Array.from(wlMap.values()).sort(function(a,b){ return a.week - b.week; });
    } else {
      trendData = [
        { name: 'BOL.com',    current: bol.revenue, prior: bol.priorRevenue,    color: '#3B82F6' },
        { name: 'Amazon EU',  current: amzRev,       prior: amzPriorRev,         color: '#F59E0B' },
      ];
    }
    return { bol, amzList, amzRev, amzOrd, amzAd, amzRoas, totalRev, totalOrd, totalRoas, totalAov, priorTotalRev, amzPriorRev, trendData, priorWeek, priorMonthObj };
  }, [rawData, reportType, selWeek, selMonth, availableWeeks]);

  const periodLabel = React.useMemo(function() {
    if (reportType === 'weekly' && selWeek) {
      const mon = isoWeekToDate(selWeek.year, selWeek.week);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const f = function(d){ return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' }); };
      return 'Week ' + selWeek.week + ' \u2014 ' + f(mon) + ' to ' + f(sun) + ', ' + selWeek.year;
    }
    if (reportType === 'monthly' && selMonth) return MONTH_NAMES_LONG[selMonth.month] + ' ' + selMonth.year;
    return '';
  }, [reportType, selWeek, selMonth]);

  const compLabel = React.useMemo(function() {
    if (!reportData) return 'prior period';
    if (reportType === 'weekly' && reportData.priorWeek) return 'W' + reportData.priorWeek.week + ' \u2019' + String(reportData.priorWeek.year).slice(2);
    if (reportType === 'monthly' && reportData.priorMonthObj) return MONTH_NAMES_LONG[reportData.priorMonthObj.month].slice(0,3) + ' ' + reportData.priorMonthObj.year;
    return 'prior period';
  }, [reportData, reportType]);

  const narrative = React.useMemo(function() {
    if (!reportData) return '';
    return generateNarrative(reportData, reportType, periodLabel, compLabel);
  }, [reportData, reportType, periodLabel, compLabel]);

  const [exporting, setExporting] = React.useState(false);
  async function exportReportPDF() {
    setExporting(true);
    try {
      const el = document.getElementById('report-print');
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jspdf.jsPDF('portrait', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), mg = 10;
      const iw = pw - mg * 2, ih = (canvas.height * iw) / canvas.width;
      let left = ih, pos = mg;
      pdf.addImage(imgData, 'PNG', mg, pos, iw, ih);
      left -= (ph - mg * 2);
      while (left > 0) { pdf.addPage(); pos = mg - (ih - left); pdf.addImage(imgData,'PNG',mg,pos,iw,ih); left -= (ph - mg*2); }
      pdf.save('HG-Report-' + periodLabel.replace(/[^a-zA-Z0-9]/g,'-') + '.pdf');
    } catch(e) { console.error(e); }
    setExporting(false);
  }

  const fmtE = function(v) { return (v||0).toLocaleString('de-DE', { minimumFractionDigits:2, maximumFractionDigits:2 }); };
  const fmtPct = function(a, b) {
    if (!b || b === 0) return null;
    const p = ((a - b) / b * 100).toFixed(1);
    return { val: Math.abs(p), up: a >= b };
  };

  if (!rawData) return <div className="p-8 text-gray-500">Loading data...</div>;

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
          {['weekly','monthly'].map(function(t) {
            return (
              <button key={t} onClick={function(){ setReportType(t); }}
                className={'px-4 py-2 text-sm font-medium transition ' + (reportType === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
                {t === 'weekly' ? 'Weekly Report' : 'Monthly Report'}
              </button>
            );
          })}
        </div>

        {reportType === 'weekly' ? (
          <select value={selWeek ? selWeek.year+'-'+selWeek.week : ''}
            onChange={function(e){
              const parts = e.target.value.split('-'); const y=parseInt(parts[0]),w=parseInt(parts[1]);
              setSelWeek(availableWeeks.find(function(wk){ return wk.year===y && wk.week===w; }) || null);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
            {[...availableWeeks].reverse().map(function(w) {
              return <option key={w.year+'-'+w.week} value={w.year+'-'+w.week}>{w.label}</option>;
            })}
          </select>
        ) : (
          <select value={selMonth ? selMonth.year+'-'+selMonth.month : ''}
            onChange={function(e){
              const parts = e.target.value.split('-'); const y=parseInt(parts[0]),m=parseInt(parts[1]);
              setSelMonth(availableMonths.find(function(mo){ return mo.year===y && mo.month===m; }) || null);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
            {[...availableMonths].reverse().map(function(mo) {
              return <option key={mo.year+'-'+mo.month} value={mo.year+'-'+mo.month}>{MONTH_NAMES_LONG[mo.month]} {mo.year}</option>;
            })}
          </select>
        )}

        <button onClick={exportReportPDF} disabled={exporting || !reportData}
          className="ml-auto flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 shadow-sm">
          {exporting ? 'Exporting...' : '\u2193 Export PDF'}
        </button>
      </div>

      {!reportData ? (
        <div className="bg-white rounded-xl p-12 text-center text-gray-400">Select a period above to generate the report.</div>
      ) : (function() {
        const { bol, amzList, amzRev, amzOrd, amzAd, amzRoas, totalRev, totalOrd, totalRoas, totalAov, priorTotalRev, amzPriorRev, trendData } = reportData;
        return (
          <div id="report-print" style={{ background:'#fff', borderRadius:12, padding:'32px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)', fontFamily:'Inter,sans-serif', maxWidth:900, margin:'0 auto' }}>

            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24, paddingBottom:16, borderBottom:'2px solid #1e3a5f' }}>
              <div>
                <img src="https://hgaesthetics.com/cdn/shop/files/HG-Logo-black.png?crop=center&height=110&v=1753723090&width=210" alt="HG" style={{ height:28, marginBottom:4 }} />
                <p style={{ margin:0, color:'#6B7280', fontSize:12 }}>HG Aesthetics EU — E-commerce Performance</p>
              </div>
              <div style={{ textAlign:'right' }}>
                <p style={{ margin:0, fontSize:18, fontWeight:700, color:'#111827' }}>{reportType === 'weekly' ? 'Weekly Report' : 'Monthly Report'}</p>
                <p style={{ margin:'2px 0 0', fontSize:13, color:'#374151', fontWeight:500 }}>{periodLabel}</p>
                <p style={{ margin:'2px 0 0', fontSize:11, color:'#9CA3AF' }}>Generated {new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</p>
              </div>
            </div>

            {/* KPI Row */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
              {[
                { label:'Total Revenue', value:'\u20AC'+fmtE(totalRev), chg: fmtPct(totalRev, priorTotalRev), color:'#3B82F6' },
                { label:'Overall ROAS',  value:totalRoas > 0 ? totalRoas.toFixed(2) : '\u2014', color:'#10B981' },
                { label:'Total Orders',  value:Math.round(totalOrd).toLocaleString('de-DE'), color:'#8B5CF6' },
                { label:'Avg AOV',       value:'\u20AC'+fmtE(totalAov), color:'#F59E0B' },
              ].map(function(k,i) {
                return (
                  <div key={i} style={{ background:'#F9FAFB', borderRadius:8, padding:'14px 16px', borderTop:'3px solid '+k.color }}>
                    <p style={{ margin:0, fontSize:10, fontWeight:600, color:'#6B7280', textTransform:'uppercase', letterSpacing:'0.05em' }}>{k.label}</p>
                    <p style={{ margin:'6px 0 0', fontSize:22, fontWeight:700, color:'#111827' }}>{k.value}</p>
                    {k.chg && <p style={{ margin:'4px 0 0', fontSize:11, fontWeight:600, color: k.chg.up ? '#10B981' : '#EF4444' }}>{k.chg.up ? '\u2191' : '\u2193'} {k.chg.val}% vs {compLabel}</p>}
                  </div>
                );
              })}
            </div>

            {/* Channel split */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
              {/* BOL */}
              <div style={{ background:'#EFF6FF', borderRadius:8, padding:16, border:'1px solid #BFDBFE' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                  <div style={{ width:10, height:10, borderRadius:'50%', background:'#3B82F6' }}></div>
                  <span style={{ fontSize:13, fontWeight:700, color:'#1E40AF' }}>BOL.com</span>
                  <span style={{ marginLeft:'auto', fontSize:11, color:'#6B7280', background:'#DBEAFE', borderRadius:999, padding:'2px 8px' }}>
                    {totalRev > 0 ? (bol.revenue/totalRev*100).toFixed(1) : 0}% of total
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    { l:'Revenue',   v:'\u20AC'+fmtE(bol.revenue), chg: fmtPct(bol.revenue, bol.priorRevenue) },
                    { l:'ROAS',      v: bol.roas > 0 ? bol.roas.toFixed(2) : '\u2014' },
                    { l:'Orders',    v: Math.round(bol.orders) },
                    { l:'Ad Spend',  v:'\u20AC'+fmtE(bol.adSpend) },
                    { l:'Sales fr. Ads', v:'\u20AC'+fmtE(bol.salesFromAds) },
                    { l:'Units Sold', v: Math.round(bol.units||0) },
                  ].map(function(row,i){
                    return (
                      <div key={i}>
                        <p style={{ margin:0, fontSize:10, color:'#6B7280', fontWeight:600, textTransform:'uppercase' }}>{row.l}</p>
                        <p style={{ margin:'2px 0 0', fontSize:16, fontWeight:700, color:'#111827' }}>{row.v}</p>
                        {row.chg && <p style={{ margin:0, fontSize:10, fontWeight:600, color: row.chg.up ? '#10B981' : '#EF4444' }}>{row.chg.up ? '\u2191' : '\u2193'}{row.chg.val}%</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Amazon */}
              <div style={{ background:'#FFFBEB', borderRadius:8, padding:16, border:'1px solid #FDE68A' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                  <div style={{ width:10, height:10, borderRadius:'50%', background:'#F59E0B' }}></div>
                  <span style={{ fontSize:13, fontWeight:700, color:'#92400E' }}>Amazon EU</span>
                  <span style={{ marginLeft:'auto', fontSize:11, color:'#6B7280', background:'#FEF3C7', borderRadius:999, padding:'2px 8px' }}>
                    {totalRev > 0 ? (amzRev/totalRev*100).toFixed(1) : 0}% of total
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    { l:'Revenue',   v:'\u20AC'+fmtE(amzRev), chg: fmtPct(amzRev, amzPriorRev) },
                    { l:'ROAS',      v: amzRoas > 0 ? amzRoas.toFixed(2) : '\u2014' },
                    { l:'Orders',    v: Math.round(amzOrd) },
                    { l:'Ad Spend',  v:'\u20AC'+fmtE(amzAd) },
                  ].map(function(row,i){
                    return (
                      <div key={i}>
                        <p style={{ margin:0, fontSize:10, color:'#6B7280', fontWeight:600, textTransform:'uppercase' }}>{row.l}</p>
                        <p style={{ margin:'2px 0 0', fontSize:16, fontWeight:700, color:'#111827' }}>{row.v}</p>
                        {row.chg && <p style={{ margin:0, fontSize:10, fontWeight:600, color: row.chg.up ? '#10B981' : '#EF4444' }}>{row.chg.up ? '\u2191' : '\u2193'}{row.chg.val}%</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Amazon country breakdown */}
            {amzList.filter(function(m){ return m.revenue > 0; }).length > 0 && (
              <div style={{ marginBottom:20 }}>
                <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em' }}>Amazon EU — Country Breakdown</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:8 }}>
                  {[...amzList].filter(function(m){ return m.revenue > 0; }).sort(function(a,b){ return b.revenue - a.revenue; }).map(function(m,i){
                    return (
                      <div key={i} style={{ background:'#F9FAFB', borderRadius:6, padding:'10px 12px', borderLeft:'3px solid '+m.color }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                          <img src={'https://flagcdn.com/w20/'+m.name.replace('AMZ - ','').toLowerCase()+'.png'} style={{ width:18, height:12, borderRadius:2, objectFit:'cover', flexShrink:0 }} />
                          <span style={{ fontSize:12, fontWeight:700, color:'#374151' }}>{m.name.replace('AMZ - ','')}</span>
                        </div>
                        <p style={{ margin:'3px 0 0', fontSize:15, fontWeight:700, color:'#111827' }}>{'\u20AC'}{fmtE(m.revenue)}</p>
                        <p style={{ margin:'2px 0 0', fontSize:10, color:'#6B7280' }}>ROAS {m.roas > 0 ? m.roas.toFixed(2) : '\u2014'} &bull; {Math.round(m.orders)} ord.</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chart */}
            <div style={{ marginBottom:20, background:'#F9FAFB', borderRadius:8, padding:16 }}>
              <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em' }}>
                {reportType === 'weekly' ? 'Channel Comparison — Current vs Prior Week' : 'Weekly Revenue Breakdown — ' + MONTH_NAMES_LONG[selMonth && selMonth.month] + (selMonth ? ' '+selMonth.year : '')}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                {reportType === 'monthly' ? (
                  <AreaChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize:11 }} />
                    <YAxis tickFormatter={function(v){ return '\u20AC'+v; }} tick={{ fontSize:11 }} />
                    <Tooltip formatter={function(v,n){ return ['\u20AC'+fmtE(v), n === 'bol' ? 'BOL.com' : 'Amazon EU']; }} />
                    <Legend formatter={function(n){ return n === 'bol' ? 'BOL.com' : 'Amazon EU'; }} />
                    <Area type="monotone" dataKey="bol"    stackId="1" stroke="#3B82F6" fill="#DBEAFE" name="bol" />
                    <Area type="monotone" dataKey="amazon" stackId="1" stroke="#F59E0B" fill="#FEF3C7" name="amazon" />
                  </AreaChart>
                ) : (
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="name" tick={{ fontSize:11 }} />
                    <YAxis tickFormatter={function(v){ return '\u20AC'+v; }} tick={{ fontSize:11 }} />
                    <Tooltip formatter={function(v){ return '\u20AC'+fmtE(v); }} />
                    <Legend />
                    <Bar dataKey="current" name={selWeek ? 'W'+selWeek.week+' \u201926' : 'Current'} radius={[4,4,0,0]}>
                      {trendData.map(function(e,i){ return <Cell key={i} fill={e.color} />; })}
                    </Bar>
                    <Bar dataKey="prior" name={compLabel || 'Prior'} fill="#D1D5DB" radius={[4,4,0,0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Narrative */}
            <div style={{ background:'#F0FDF4', borderRadius:8, padding:'16px 20px', borderLeft:'4px solid #10B981', marginBottom:20 }}>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:700, color:'#065F46', textTransform:'uppercase', letterSpacing:'0.06em' }}>Executive Summary</p>
              <p style={{ margin:0, fontSize:13, color:'#111827', lineHeight:1.8 }}>{narrative}</p>
            </div>

            {/* Footer */}
            <div style={{ paddingTop:12, borderTop:'1px solid #E5E7EB', display:'flex', justifyContent:'space-between' }}>
              <p style={{ margin:0, fontSize:10, color:'#9CA3AF' }}>HG Aesthetics EU — Internal Use Only</p>
              <p style={{ margin:0, fontSize:10, color:'#9CA3AF' }}>Data sourced from Google Sheets via gviz API</p>
            </div>
          </div>
        );
      })()}
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
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);
  const [inventoryFilter,  setInventoryFilter]  = React.useState('all');
  const [tableSortKey,     setTableSortKey]     = React.useState('revenue');
  const [tableSortDir,     setTableSortDir]     = React.useState('desc');
  const [exporting,        setExporting]        = React.useState(false);
  const [chartChannel,     setChartChannel]     = React.useState('all'); // 'all' | 'bol' | 'amz'
  const [customRange,      setCustomRange]      = React.useState(null); // { start: Date, end: Date }
  const [darkMode,         setDarkMode]         = React.useState(false);

  React.useEffect(() => {
    darkMode
      ? document.documentElement.classList.add('dark-theme')
      : document.documentElement.classList.remove('dark-theme');
  }, [darkMode]);

  // --- Data Fetching ---

  const fetchGviz = async (sheetId, params, label) => {
    const url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json' + (params || '');
    try {
      const res = await fetch(url, { cache: 'no-store' });
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
        fetchGviz(AMAZON_SHEET_ID, '&gid=1044833545',               'Amazon Scorecard'),
      ]);

      if (!bolScore25Rows || bolScore25Rows._error) {
        throw new Error(bolScore25Rows ? bolScore25Rows._error : 'BOL Scorecard 2025 empty');
      }

      const bolParsed25 = parseMarketplaceSheet(bolScore25Rows, 2);
      let   bolParsed26 = { marketplaces: {}, weekLabels: [] };
      if (bolScore26Rows && !bolScore26Rows._error && Array.isArray(bolScore26Rows)) {
        bolParsed26 = parseMarketplaceSheet(bolScore26Rows, 2, { 2026: 1 });
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

    // Wrappers: use custom date range when period === 'custom'
    const _fp  = arr => selectedPeriod === 'custom' && customRange
      ? filterByDateRange(arr, customRange.start, customRange.end)
      : filterByPeriod(arr, selectedPeriod);
    const _fpp = arr => {
      if (selectedPeriod === 'custom' && customRange) {
        const dur = customRange.end.getTime() - customRange.start.getTime();
        const priorEnd   = new Date(customRange.start.getTime() - 86400000);
        const priorStart = new Date(priorEnd.getTime() - dur);
        return filterByDateRange(arr, priorStart, priorEnd);
      }
      return filterPriorPeriod(arr, selectedPeriod);
    };

    const fSales    = _fp(allMarkets.totalSales    || []);
    const fAdSpend  = _fp(allMarkets.adSpend       || []);
    const fOrders   = _fp(allMarkets.totalOrders   || []);
    const fUnits    = _fp(allMarkets.totalUnits    || []);
    const fSFA      = _fp(allMarkets.salesFromAds  || []);

    const totalAdSpend      = sumValues(fAdSpend);
    const totalOrders       = sumValues(fOrders);
    const totalUnits        = sumValues(fUnits);
    const totalSalesFromAds = sumValues(fSFA);
    const avgRoas           = totalAdSpend > 0 ? totalSalesFromAds / totalAdSpend : 0;
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
      const fS   = _fp(d.totalSales   || []);
      const fA   = _fp(d.adSpend      || []);
      const fO   = _fp(d.totalOrders  || []);
      const fU   = _fp(d.totalUnits   || []);
      const fSfa = _fp(d.salesFromAds || []);
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
        // prior period for period-over-period comparison
        priorRevenue: sumValues(_fpp(d.totalSales  || [])),
        priorAdSpend: sumValues(_fpp(d.adSpend     || [])),
        priorOrders:  sumValues(_fpp(d.totalOrders || [])),
        priorUnits:   sumValues(_fpp(d.totalUnits  || [])),
      };
    });

    const roasTrend = fSales.map((sale, i) => {
      const entry = { weekLabel: sale.weekLabel };
      mpNames.forEach(name => {
        const fr = _fp((mp[name] || {}).roas || []);
        entry[name] = (fr[i] && fr[i].value) || 0;
      });
      return entry;
    });

    const adSpendTrend = fSales.map((sale, i) => {
      const entry = { weekLabel: sale.weekLabel };
      mpNames.forEach(name => {
        const fa = _fp((mp[name] || {}).adSpend || []);
        entry[name] = (fa[i] && fa[i].value) || 0;
      });
      return entry;
    });

    const bolRevenue      = marketplaceData.filter(m => m.name === 'Bol').reduce((s, m) => s + m.revenue, 0);
    const amzRevenue      = marketplaceData.filter(m => m.name.startsWith('AMZ')).reduce((s, m) => s + m.revenue, 0);
    const combinedRevenue = bolRevenue + amzRevenue;

    // Recompute totals from per-marketplace data — allMarkets index-based combine is unreliable
    // when BOL and Amazon arrays have different lengths/structures.
    const trueOrders   = marketplaceData.reduce((s, m) => s + m.orders,       0);
    const trueAdSpend  = marketplaceData.reduce((s, m) => s + m.adSpend,      0);
    const trueUnits    = marketplaceData.reduce((s, m) => s + m.units,        0);
    const trueSFA      = marketplaceData.reduce((s, m) => s + m.salesFromAds, 0);
    const trueAvgRoas  = trueAdSpend > 0 ? trueSFA / trueAdSpend : 0;
    const trueAvgAov   = trueOrders  > 0 ? combinedRevenue / trueOrders : 0;

    // Period-over-period comparison (consistent with how current totals are computed)
    const bolRevenuePrior      = marketplaceData.filter(m => m.name === 'Bol').reduce((s, m) => s + m.priorRevenue, 0);
    const amzRevenuePrior      = marketplaceData.filter(m => m.name.startsWith('AMZ')).reduce((s, m) => s + m.priorRevenue, 0);
    const combinedRevenuePrior = bolRevenuePrior + amzRevenuePrior;
    const totalAdSpendPrior    = marketplaceData.reduce((s, m) => s + m.priorAdSpend, 0);
    const totalOrdersPrior     = marketplaceData.reduce((s, m) => s + m.priorOrders,  0);
    const totalUnitsPrior      = marketplaceData.reduce((s, m) => s + m.priorUnits,   0);
    const popChange = (cur, prior) => prior > 0 ? ((cur - prior) / prior) * 100 : null;
    const compareLabel = selectedPeriod === 'custom' && customRange
      ? `vs prior ${Math.round((customRange.end - customRange.start) / 86400000)} days`
      : (PERIOD_COMPARE_LABELS[selectedPeriod] || null);

    return {
      totalRevenue: combinedRevenue,
      totalAdSpend: trueAdSpend, totalOrders: trueOrders, totalUnits: trueUnits,
      totalSalesFromAds: trueSFA, avgRoas: trueAvgRoas, avgAov: trueAvgAov,
      wowRevenue: popChange(combinedRevenue, combinedRevenuePrior),
      wowAdSpend: popChange(trueAdSpend,    totalAdSpendPrior),
      wowOrders:  popChange(trueOrders,     totalOrdersPrior),
      wowUnits:   popChange(trueUnits,      totalUnitsPrior),
      wowBol:     popChange(bolRevenue,      bolRevenuePrior),
      wowAmz:     popChange(amzRevenue,      amzRevenuePrior),
      compareLabel,
      weeklyTrend, marketplaceData, roasTrend, adSpendTrend, bolRevenue, amzRevenue, combinedRevenue,
    };
  }, [rawData, selectedPeriod, customRange]);

  const alertCount = bolProducts.filter(p => p.alert).length;

  // --- Home tab trend (synced to global period selector) ---
  const homeTrend = React.useMemo(() => {
    if (!rawData) return [];
    const { amazon, bolScore } = rawData;
    const mp = {};
    if (amazon    && amazon.marketplaces)   Object.keys(amazon.marketplaces).forEach(k => { mp[k] = amazon.marketplaces[k]; });
    if (bolScore  && bolScore.marketplaces) Object.keys(bolScore.marketplaces).forEach(k => { mp[k] = bolScore.marketplaces[k]; });

    const allNames    = ['Bol', 'AMZ - NL', 'AMZ - FR', 'AMZ - DE', 'AMZ - IT', 'AMZ - ES', 'AMZ - BE'];
    const allMpNames  = allNames.filter(n => mp[n]);
    const channelNames = chartChannel === 'bol' ? allMpNames.filter(n => n === 'Bol')
                       : chartChannel === 'amz' ? allMpNames.filter(n => n.startsWith('AMZ'))
                       : allMpNames;

    const combinedMap = { totalSales: {}, adSpend: {} };
    ['totalSales', 'adSpend'].forEach(function(metric) {
      channelNames.forEach(function(name) {
        const d = (mp[name] || {})[metric] || [];
        d.forEach(function(e) {
          const key = e.weekLabel;
          if (!combinedMap[metric][key]) combinedMap[metric][key] = { weekLabel: e.weekLabel, year: e.year, week: e.week, value: 0 };
          combinedMap[metric][key].value = (combinedMap[metric][key].value || 0) + (e.value || 0);
        });
      });
    });
    const toSortedArray = obj => Object.values(obj).sort((a, b) => a.year !== b.year ? a.year - b.year : a.week - b.week);
    const combined = { totalSales: toSortedArray(combinedMap.totalSales), adSpend: toSortedArray(combinedMap.adSpend) };

    const fp = arr => selectedPeriod === 'custom' && customRange
      ? filterByDateRange(arr, customRange.start, customRange.end)
      : filterByPeriod(arr, selectedPeriod);

    const fS = fp(combined.totalSales || []);
    const fA = fp(combined.adSpend    || []);
    return fS.map((s, i) => ({
      weekLabel: s.weekLabel,
      revenue:   s.value || 0,
      adSpend:   (fA[i] && fA[i].value) || 0,
    }));
  }, [rawData, selectedPeriod, customRange, chartChannel]);

  // --- ROAS Heatmap (moved here: must be before any conditional returns) ---
  const roasHeatmap = React.useMemo(() => {
    if (!dashboardData) return { weeks: [], countries: [], data: {} };
    const weeks = dashboardData.adSpendTrend.map(w => w.weekLabel);
    const countryMpMap = {
      NL: ['Bol', 'AMZ - NL'], FR: ['AMZ - FR'], DE: ['AMZ - DE'],
      IT: ['AMZ - IT'],        ES: ['AMZ - ES'], BE: ['AMZ - BE'],
    };
    const ALL_CC = ['NL', 'FR', 'DE', 'IT', 'ES', 'BE'];
    const adByWk = {}, roasByWk = {};
    dashboardData.adSpendTrend.forEach(w => { adByWk[w.weekLabel]   = w; });
    dashboardData.roasTrend.forEach(w    => { roasByWk[w.weekLabel] = w; });
    const data = {};
    ALL_CC.forEach(cc => {
      data[cc] = {};
      weeks.forEach(wl => {
        let totalAd = 0, totalSfa = 0;
        (countryMpMap[cc] || []).forEach(mpName => {
          const ad   = (adByWk[wl]   && adByWk[wl][mpName])   || 0;
          const roas = (roasByWk[wl] && roasByWk[wl][mpName]) || 0;
          totalAd  += ad;
          totalSfa += ad * roas;
        });
        data[cc][wl] = totalAd > 0 ? +(totalSfa / totalAd).toFixed(2) : null;
      });
    });
    const countries = ALL_CC.filter(cc => weeks.some(wl => data[cc][wl] !== null));
    const visWeeks = weeks.slice(-12);
    return { weeks: visWeeks, countries, data };
  }, [dashboardData]);

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

  // BOL Analytics data
  const bolMarket = dashboardData.marketplaceData.find(m => m.name === 'Bol') || { revenue: 0, adSpend: 0, orders: 0, units: 0, salesFromAds: 0, roas: 0, aov: 0, weeklyTrend: [] };
  const bolAdMap = {};
  dashboardData.adSpendTrend.forEach(w => { bolAdMap[w.weekLabel] = w['Bol'] || 0; });
  const bolTrendData = (bolMarket.weeklyTrend || []).map(w => ({ ...w, adSpend: bolAdMap[w.weekLabel] || 0 }));
  const bolRoasTrend = dashboardData.roasTrend.map(w => ({ weekLabel: w.weekLabel, roas: w['Bol'] || 0 })).filter(w => w.roas > 0);

  // Amazon Analytics data
  const amzMarkets = dashboardData.marketplaceData.filter(m => m.name.startsWith('AMZ'));
  const amzRevenue = amzMarkets.reduce((s, m) => s + m.revenue, 0);
  const amzAdSpend = amzMarkets.reduce((s, m) => s + m.adSpend, 0);
  const amzOrders  = amzMarkets.reduce((s, m) => s + m.orders, 0);
  const amzUnits   = amzMarkets.reduce((s, m) => s + m.units, 0);
  const amzSFA     = amzMarkets.reduce((s, m) => s + m.salesFromAds, 0);
  const amzRoas    = amzAdSpend > 0 ? amzSFA / amzAdSpend : 0;
  const amzAov     = amzOrders > 0 ? amzRevenue / amzOrders : 0;
  const amzNames   = ['AMZ - NL', 'AMZ - FR', 'AMZ - DE', 'AMZ - IT', 'AMZ - ES', 'AMZ - BE'];
  const parseWL    = lbl => { const m = lbl && lbl.match(/W(\d+) '(\d+)/); return m ? { week: +m[1], year: 2000 + +m[2] } : { week: 0, year: 0 }; };
  const amzRevMap  = {};
  amzMarkets.forEach(m => { (m.weeklyTrend || []).forEach(w => { if (!amzRevMap[w.weekLabel]) amzRevMap[w.weekLabel] = { weekLabel: w.weekLabel, revenue: 0 }; amzRevMap[w.weekLabel].revenue += w.revenue || 0; }); });
  const amzAdByWeek = {};
  dashboardData.adSpendTrend.forEach(w => { amzAdByWeek[w.weekLabel] = amzNames.reduce((s, n) => s + (w[n] || 0), 0); });
  const amzTrendData = Object.values(amzRevMap).sort((a, b) => { const pa = parseWL(a.weekLabel), pb = parseWL(b.weekLabel); return pa.year !== pb.year ? pa.year - pb.year : pa.week - pb.week; }).map(w => ({ ...w, adSpend: amzAdByWeek[w.weekLabel] || 0 }));
  const amzPieData = amzMarkets.filter(m => m.revenue > 0).map(m => ({ name: m.name, value: m.revenue, color: m.color }));

  // ─── Advanced Analytics computed vars ────────────────────────────────────

  // 1. Consecutive streak (revenue + ROAS)
  const streakInfo = (() => {
    const calcStreak = (arr, key) => {
      let count = 0, dir = null;
      for (let i = arr.length - 1; i >= 1; i--) {
        const d = arr[i][key] > arr[i-1][key] ? 'up' : arr[i][key] < arr[i-1][key] ? 'down' : null;
        if (!dir) { dir = d; }
        if (dir && d === dir) count++;
        else break;
      }
      return count >= 2 ? { count, dir } : null;
    };
    const wt = dashboardData.weeklyTrend || [];
    return { revenue: calcStreak(wt, 'revenue'), roas: calcStreak(wt, 'roas') };
  })();

  // 2. Profit after ads per week (from homeTrend)
  const profitTrend = homeTrend.map(w => ({
    weekLabel: w.weekLabel,
    profit:    +(w.revenue - w.adSpend).toFixed(2),
    revenue:   w.revenue,
    margin:    w.revenue > 0 ? +((w.revenue - w.adSpend) / w.revenue * 100).toFixed(1) : 0,
  }));
  const totalProfit  = profitTrend.reduce((s, w) => s + w.profit, 0);
  const avgMarginPct = profitTrend.length > 0
    ? +(profitTrend.reduce((s, w) => s + w.margin, 0) / profitTrend.length).toFixed(1)
    : 0;

  // 3. Ad spend velocity — WoW% change of revenue vs ad spend
  const velocityData = homeTrend.length < 2 ? [] : homeTrend.slice(1).map((w, i) => {
    const prev = homeTrend[i];
    return {
      weekLabel:     w.weekLabel,
      revenueGrowth: prev.revenue > 0 ? +((w.revenue - prev.revenue) / prev.revenue * 100).toFixed(1) : 0,
      adSpendGrowth: prev.adSpend > 0 ? +((w.adSpend - prev.adSpend) / prev.adSpend * 100).toFixed(1) : 0,
    };
  });

  // 4. Revenue forecast — linear regression on last 6 actual weeks, +4 projected
  const forecastChartData = (() => {
    if (homeTrend.length < 3) return homeTrend.map(w => ({ ...w, forecast: null }));
    const lastN = homeTrend.slice(-6);
    const n = lastN.length;
    const ys = lastN.map(w => w.revenue);
    const sumX  = (n * (n - 1)) / 2;
    const sumY  = ys.reduce((a, b) => a + b, 0);
    const sumXY = ys.reduce((s, y, i) => s + i * y, 0);
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;
    const actual = homeTrend.map(w => ({ ...w, forecast: null }));
    // Bridge last actual point into the forecast line
    actual[actual.length - 1] = { ...actual[actual.length - 1], forecast: actual[actual.length - 1].revenue };
    const last = homeTrend[homeTrend.length - 1];
    const mw = last && last.weekLabel.match(/W(\d+) '(\d+)/);
    let fw = mw ? +mw[1] : 1, fy = mw ? 2000 + +mw[2] : 2026;
    const fut = [];
    for (let i = 1; i <= 4; i++) {
      fw++; if (fw > 52) { fw = 1; fy++; }
      fut.push({
        weekLabel: `W${fw} '${String(fy).slice(-2)}`,
        revenue: null, adSpend: null,
        forecast: Math.max(0, Math.round(intercept + slope * (n - 1 + i))),
      });
    }
    return [...actual, ...fut];
  })();

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }} className="bg-gray-50">

      {/* ════════════════════════ SIDEBAR ════════════════════════ */}
      <aside
        className="bg-white border-r border-gray-200 flex flex-col flex-shrink-0 transition-all duration-300"
        style={{ width: sidebarCollapsed ? '56px' : '220px', overflowX: 'hidden' }}
        onMouseEnter={() => setSidebarCollapsed(false)}
        onMouseLeave={() => setSidebarCollapsed(true)}
      >
        {/* Logo */}
        <div
          className={`border-b border-gray-100 flex items-center ${sidebarCollapsed ? 'justify-center py-4 px-2' : 'px-4 py-4'}`}
          style={{ minHeight: '64px', flexShrink: 0 }}
        >
          {sidebarCollapsed ? (
            /* Collapsed: HG logo mark */
            <img src="https://hgaesthetics.com/cdn/shop/files/HG-Logo-black.png?crop=center&height=110&v=1753723090&width=210"
              alt="HG" className="hg-logo-img" style={{ width: '32px', height: '32px', objectFit: 'contain', flexShrink: 0 }} />
          ) : (
            /* Expanded: actual HG Aesthetics logo */
            <div style={{ overflow: 'hidden' }}>
              <img
                src="https://hgaesthetics.com/cdn/shop/files/HG-Logo-black.png?crop=center&height=110&v=1753723090&width=210"
                alt="HG Aesthetics"
                className="hg-logo-img"
                style={{ height: '36px', width: 'auto', objectFit: 'contain', display: 'block', maxWidth: '160px' }}
              />
              <p className="text-xs text-gray-400 whitespace-nowrap mt-0.5">EU Dashboard</p>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-2">
          {[
            { id: 'home',      label: 'Home',              Icon: HomeIcon,   badge: null },
            { id: 'bol',       label: 'BOL Analytics',    Icon: ChartIcon,  badge: null },
            { id: 'amz',       label: 'Amazon Analytics', Icon: AmazonIcon, badge: null },
            { id: 'inventory', label: 'Inventory',         Icon: BoxIcon,    badge: alertCount > 0 ? alertCount : null },
            { id: 'pnl',       label: 'P&L',               Icon: PnlIcon,    badge: null },
            { id: 'reports',   label: 'Reports',           Icon: ReportIcon, badge: null },
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

        {/* ── Theme toggle + Account ── */}
        <div className={`mt-auto border-t border-gray-200 ${sidebarCollapsed ? 'p-2' : 'p-3'} flex flex-col gap-2`}>
          {/* Dark/light toggle pill */}
          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ display:'flex', alignItems:'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: sidebarCollapsed ? 0 : '10px', padding:'6px 8px', borderRadius:'8px', border:'none', background:'transparent', cursor:'pointer', width:'100%' }}
            className="hover:bg-gray-100 transition-colors"
          >
            <span style={{ display:'flex', alignItems:'center', background: darkMode ? '#1e3a5f' : '#f3f4f6', borderRadius:'20px', padding:'3px 5px', gap:'2px', flexShrink:0 }}>
              <span style={{ padding:'2px 5px', borderRadius:'12px', background: !darkMode ? '#fff' : 'transparent', color: !darkMode ? '#F59E0B' : '#6B7280', display:'flex', alignItems:'center', transition:'all 0.2s' }}>
                <SunIcon />
              </span>
              <span style={{ padding:'2px 5px', borderRadius:'12px', background: darkMode ? '#334155' : 'transparent', color: darkMode ? '#93C5FD' : '#6B7280', display:'flex', alignItems:'center', transition:'all 0.2s' }}>
                <MoonIcon />
              </span>
            </span>
            {!sidebarCollapsed && (
              <span style={{ fontSize:'12px', fontWeight:500, color: darkMode ? '#CBD5E1' : '#374151', whiteSpace:'nowrap' }}>
                {darkMode ? 'Light mode' : 'Dark mode'}
              </span>
            )}
          </button>

          {/* Account */}
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2 px-1'}`}>
            <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'linear-gradient(135deg,#fce7f3,#fbcfe8)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, overflow:'hidden' }}>
              <img src="https://hgaesthetics.com/cdn/shop/files/HG-Logo-black.png?crop=center&height=110&v=1753723090&width=210"
                alt="HG" style={{ width:'22px', height:'22px', objectFit:'contain' }} />
            </div>
            {!sidebarCollapsed && (
              <div style={{ overflow:'hidden' }}>
                <p className="text-xs font-semibold text-gray-900 whitespace-nowrap leading-tight">HG Aesthetics</p>
                <p className="text-xs text-gray-400 whitespace-nowrap">Admin</p>
              </div>
            )}
          </div>
        </div>

      </aside>

      {/* ════════════════════════ MAIN CONTENT ════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0" style={{ minHeight: '64px' }}>
          <div>
            <h1 className="text-base font-semibold text-gray-900">
              {activeTab === 'home' ? 'Home' : activeTab === 'bol' ? '\uD83C\uDDF3\uD83C\uDDF1 BOL Analytics' : activeTab === 'amz' ? '\uD83D\uDECD\uFE0F Amazon Analytics' : activeTab === 'inventory' ? '\uD83D\uDCE6 Inventory' : activeTab === 'pnl' ? '\uD83D\uDCB0 P&L' : '\uD83D\uDCC4 Reports'}
            </h1>
            {lastUpdate && <p className="text-xs text-gray-400">Updated {lastUpdate.toLocaleTimeString()}</p>}
          </div>
          <div className="flex items-center gap-3">
            {/* Live / connected indicator */}
            {!loading && !error ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" style={{ animationDuration: '2s' }}></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-xs font-semibold text-green-700">Live</span>
              </div>
            ) : loading ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span className="text-xs font-medium text-amber-700">Syncing</span>
              </div>
            ) : null}
            {activeTab !== 'reports' && activeTab !== 'inventory' && activeTab !== 'pnl' && (
              <DateRangePicker
                value={selectedPeriod}
                customRange={customRange}
                onChange={setSelectedPeriod}
                onCustomRange={setCustomRange}
              />
            )}
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

              {/* Current week card */}
              {(() => {
                const now = new Date(); now.setHours(0,0,0,0);
                const dt = new Date(now); dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
                const cwY = dt.getFullYear();
                const cwW = Math.ceil(((dt - new Date(cwY, 0, 1)) / 86400000 + 1) / 7);
                const mon = new Date(dt); mon.setDate(dt.getDate() - 3);
                const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
                const fmt = d => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
                return (
                  <div className="inline-flex flex-col mb-5 rounded-xl overflow-hidden shadow-sm border border-gray-200" style={{ width: '90px' }}>
                    <div className="bg-blue-600 text-white text-center py-1" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em' }}>
                      {cwY}
                    </div>
                    <div className="bg-white text-center px-2 py-2">
                      <p className="font-bold text-gray-900" style={{ fontSize: '22px', lineHeight: 1 }}>W{cwW}</p>
                      <p className="text-gray-400 mt-1" style={{ fontSize: '9px' }}>{fmt(mon)} – {fmt(sun)}</p>
                    </div>
                  </div>
                );
              })()}

              {/* KPI row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <KPICard
                  title="Total Revenue" value={dashboardData.totalRevenue} prefix={'\u20AC'}
                  change={dashboardData.wowRevenue} changeLabel={dashboardData.compareLabel} icon={'\u20AC'}
                  color="bg-blue-100 text-blue-600" borderColor="border-blue-500"
                  streak={streakInfo.revenue}
                />
                <KPICard
                  title="Avg ROAS" value={dashboardData.avgRoas} prefix="" suffix=""
                  change={null} icon={'\uD83C\uDFAF'}
                  color={dashboardData.avgRoas >= 1.5 ? 'bg-green-100 text-green-600' : dashboardData.avgRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}
                  borderColor={dashboardData.avgRoas >= 1.5 ? 'border-green-500' : dashboardData.avgRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'}
                  streak={streakInfo.roas}
                />
                <KPICard
                  title="Orders" value={Math.round(dashboardData.totalOrders)} prefix="" suffix=""
                  change={dashboardData.wowOrders} changeLabel={dashboardData.compareLabel} icon={'\uD83D\uDED2'}
                  color="bg-purple-100 text-purple-600" borderColor="border-purple-500"
                  decimals={0}
                />
                <KPICard
                  title="Avg AOV" value={dashboardData.avgAov} prefix={'\u20AC'} suffix=""
                  change={null} icon={'\uD83D\uDCB0'}
                  color="bg-orange-100 text-orange-600" borderColor="border-orange-500"
                />
              </div>

              {/* Revenue split + trend */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

                {/* BOL vs Amazon — Pie chart */}
                <div className="bg-white rounded-xl shadow-sm p-5 flex flex-col">
                  <h3 className="text-base font-semibold text-gray-800 mb-2">Revenue by Channel</h3>
                  {(() => {
                    const channels = [
                      { label: 'BOL.com',   value: dashboardData.bolRevenue, wow: dashboardData.wowBol, color: '#3B82F6' },
                      { label: 'Amazon EU', value: dashboardData.amzRevenue, wow: dashboardData.wowAmz, color: '#F59E0B' },
                    ];
                    const total = dashboardData.combinedRevenue || 0;
                    const pieData = channels.map(c => ({ name: c.label, value: c.value, color: c.color }));
                    const fmtEur = v => '\u20AC' + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return (
                      <>
                        <ResponsiveContainer width="100%" height={160}>
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72}
                              dataKey="value" paddingAngle={3} startAngle={90} endAngle={-270}>
                              {pieData.map((entry, i) => (
                                <Cell key={i} fill={entry.color} stroke="none" />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v, name) => [fmtEur(v), name]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-2 mt-1">
                          {channels.map(ch => {
                            const pct   = total > 0 ? (ch.value / total * 100) : 0;
                            const isPos = ch.wow > 0;
                            const wCls  = isPos ? 'text-green-600' : ch.wow < 0 ? 'text-red-600' : 'text-gray-400';
                            return (
                              <div key={ch.label} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ch.color }}></div>
                                  <span className="text-xs font-medium text-gray-700">{ch.label}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-xs font-bold text-gray-900">{fmtEur(ch.value)} <span className="text-gray-400 font-normal">({pct.toFixed(1)}%)</span></span>
                                  {ch.wow !== null && dashboardData.compareLabel && (
                                    <div className={`text-xs ${wCls}`}>{isPos ? '\u2191' : ch.wow < 0 ? '\u2193' : ''} {Math.abs(ch.wow).toFixed(1)}% {dashboardData.compareLabel}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                            <span className="text-xs font-semibold text-gray-600">Total</span>
                            <span className="text-xs font-bold text-gray-900">{fmtEur(total)}</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {/* Revenue + Ad Spend trend */}
                <div className="bg-white rounded-xl shadow-sm p-5 lg:col-span-2">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-gray-800">Revenue &amp; Ad Spend Trend</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {chartChannel === 'all' ? '\uD83C\uDDF3\uD83C\uDDF1 BOL.com + \uD83D\uDECD\uFE0F Amazon EU combined' : chartChannel === 'bol' ? '\uD83C\uDDF3\uD83C\uDDF1 BOL.com only' : '\uD83D\uDECD\uFE0F Amazon EU only'}
                      </p>
                    </div>
                    {/* Channel picker */}
                    <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                      {[
                        { label: 'All',                       value: 'all' },
                        { label: '\uD83C\uDDF3\uD83C\uDDF1 BOL', value: 'bol' },
                        { label: '\uD83D\uDECD\uFE0F AMZ',       value: 'amz' },
                      ].map(opt => (
                        <button key={opt.value} onClick={() => setChartChannel(opt.value)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition ${chartChannel === opt.value ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={homeTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left"  tickFormatter={v => v >= 1000 ? `\u20AC${(v/1000).toFixed(1)}k` : `\u20AC${Math.round(v)}`} tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" tickFormatter={v => v >= 1000 ? `\u20AC${(v/1000).toFixed(1)}k` : `\u20AC${Math.round(v)}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area yAxisId="left"  type="monotone" dataKey="revenue" stroke={chartChannel === 'amz' ? '#10B981' : '#3B82F6'} strokeWidth={2} fill={chartChannel === 'amz' ? '#D1FAE5' : '#DBEAFE'} name="Revenue" />
                      <Line yAxisId="right" type="monotone" dataKey="adSpend" stroke="#F59E0B" strokeWidth={2} dot={false} name="Ad Spend" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 3D Sales Globe */}
              <SalesGlobe marketplaceData={dashboardData.marketplaceData} />

              {/* ══ Advanced Analytics ══ */}
              <div className="mt-6">
                <SectionHeading label="Advanced Analytics" />

                {/* Row 1: Profit After Ads | Ad Spend Velocity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

                  {/* Profit After Ads */}
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-semibold text-gray-800">Profit After Ads</h3>
                      <div className="text-right">
                        <span className={`text-lg font-bold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {'\u20AC'}{totalProfit.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="ml-2 text-xs font-medium text-gray-400">avg margin {avgMarginPct}%</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mb-3">Revenue minus ad spend — weekly</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={profitTrend}>
                        <defs>
                          <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#10B981" stopOpacity={0.25}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="left"  tickFormatter={v => `\u20AC${Math.round(v)}`} tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} domain={[0, 100]} />
                        <Tooltip formatter={(v, name) => name === 'Margin %' ? `${v}%` : `\u20AC${(+v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }} />
                        <ReferenceLine yAxisId="left" y={0} stroke="#EF4444" strokeDasharray="3 3" />
                        <Area animationDuration={300} yAxisId="left" type="monotone" dataKey="profit" stroke="#10B981" strokeWidth={2} fill="url(#profitGrad)" name="Profit" />
                        <Line animationDuration={300} yAxisId="right" type="monotone" dataKey="margin" stroke="#F59E0B" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Margin %" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Ad Spend Velocity */}
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="mb-1">
                      <h3 className="text-base font-semibold text-gray-800">Ad Spend Velocity</h3>
                    </div>
                    <p className="text-xs text-gray-400 mb-3">Week-on-week growth: revenue vs ad spend — danger zone when ad spend grows faster than revenue</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={velocityData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                        <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={v => `${v}%`} contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="#9CA3AF" />
                        <Bar animationDuration={300} dataKey="revenueGrowth" name="Revenue Growth %" fill="#3B82F6" opacity={0.75} barSize={14} />
                        <Bar animationDuration={300} dataKey="adSpendGrowth" name="Ad Spend Growth %" fill="#F59E0B" opacity={0.75} barSize={14} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Row 2: Revenue Forecast */}
                <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-semibold text-gray-800">Revenue Forecast</h3>
                    <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">+4 weeks projected</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-3">Linear trend from the last 6 actual weeks — dashed line shows projected revenue</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={forecastChartData}>
                      <defs>
                        <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => v >= 1000 ? `\u20AC${(v/1000).toFixed(1)}k` : `\u20AC${Math.round(v)}`} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v, name) => [`\u20AC${(+v).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, name]} contentStyle={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area animationDuration={300} type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} fill="url(#revGrad)" name="Actual Revenue" connectNulls={false} />
                      <Line animationDuration={300} type="monotone" dataKey="forecast" stroke="#6366F1" strokeWidth={2} strokeDasharray="6 4" dot={{ r: 3, fill: '#6366F1' }} name="Forecast" connectNulls={true} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Row 3: ROAS Heatmap */}
                <div className="bg-slate-900 rounded-xl shadow-sm p-5 mb-4 overflow-x-auto">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-white">ROAS Heatmap by Country</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Weekly ROAS per country — last 12 weeks</p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {[
                        { label: '\u2265 2.0', bg: '#064e3b', text: '#6ee7b7' },
                        { label: '\u2265 1.5', bg: '#14532d', text: '#86efac' },
                        { label: '\u2265 1.0', bg: '#78350f', text: '#fcd34d' },
                        { label: '\u2265 0.5', bg: '#7c2d12', text: '#fdba74' },
                        { label: '< 0.5',     bg: '#450a0a', text: '#fca5a5' },
                        { label: 'No data',   bg: '#1e293b', text: '#475569' },
                      ].map(l => (
                        <div key={l.label} className="flex items-center gap-1">
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: l.bg, display: 'inline-block' }}></span>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{l.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {roasHeatmap.countries.length > 0 ? (
                    <table style={{ borderCollapse: 'separate', borderSpacing: '3px', minWidth: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ fontSize: 10, color: '#64748b', textAlign: 'left', padding: '2px 8px', minWidth: 40 }}>Country</th>
                          {roasHeatmap.weeks.map(wl => (
                            <th key={wl} style={{ fontSize: 9, color: '#64748b', textAlign: 'center', padding: '2px 4px', minWidth: 42 }}>{wl}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {roasHeatmap.countries.map(cc => {
                          const heatColor = r => {
                            if (r === null) return { bg: '#1e293b', text: '#475569' };
                            if (r >= 2.0)  return { bg: '#064e3b', text: '#6ee7b7' };
                            if (r >= 1.5)  return { bg: '#14532d', text: '#86efac' };
                            if (r >= 1.0)  return { bg: '#78350f', text: '#fcd34d' };
                            if (r >= 0.5)  return { bg: '#7c2d12', text: '#fdba74' };
                            return { bg: '#450a0a', text: '#fca5a5' };
                          };
                          return (
                            <tr key={cc}>
                              <td style={{ fontSize: 11, color: '#e2e8f0', padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                <img src={`https://flagcdn.com/w20/${cc.toLowerCase()}.png`} style={{ height: '10px', borderRadius: '1px', marginRight: '4px', verticalAlign: 'middle' }} />
                                {cc}
                              </td>
                              {roasHeatmap.weeks.map(wl => {
                                const r = roasHeatmap.data[cc][wl];
                                const { bg, text } = heatColor(r);
                                return (
                                  <td key={wl} title={r !== null ? `ROAS ${r}` : 'No data'}
                                    style={{ background: bg, borderRadius: 4, textAlign: 'center', padding: '5px 4px', fontSize: 11, fontWeight: 600, color: text, cursor: 'default' }}>
                                    {r !== null ? r.toFixed(2) : '—'}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No heatmap data available for this period.</p>
                  )}
                </div>

              </div>

            </div>
          )}

          {/* ══════════════════ BOL ANALYTICS TAB ══════════════════ */}
          {activeTab === 'bol' && (
            <div>
              <SectionHeading label="\uD83C\uDDF3\uD83C\uDDF1 BOL.com Performance" />

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                <KPICard title="Revenue"        value={bolMarket.revenue}      prefix={'\u20AC'} change={dashboardData.wowBol} changeLabel={dashboardData.compareLabel} icon={'\u20AC'}       color="bg-blue-100 text-blue-600"    borderColor="border-blue-500" />
                <KPICard title="Sales from Ads" value={bolMarket.salesFromAds} prefix={'\u20AC'} change={null} icon={'\uD83D\uDCB5'} color="bg-green-100 text-green-600"  borderColor="border-green-500" />
                <KPICard title="Ad Spend"       value={bolMarket.adSpend}      prefix={'\u20AC'} change={null} icon={'\uD83D\uDCE2'} color="bg-red-100 text-red-600"     borderColor="border-red-500" />
                <KPICard title="ROAS"           value={bolMarket.roas}         prefix=""         change={null} icon={'\uD83C\uDFAF'} color={bolMarket.roas >= 1.5 ? 'bg-green-100 text-green-600' : bolMarket.roas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} borderColor={bolMarket.roas >= 1.5 ? 'border-green-500' : bolMarket.roas >= 1.0 ? 'border-amber-500' : 'border-red-500'} />
                <KPICard title="Orders"         value={bolMarket.orders}       prefix="" suffix="" change={dashboardData.wowOrders} changeLabel={dashboardData.compareLabel} icon={'\uD83D\uDED2'} color="bg-purple-100 text-purple-600" borderColor="border-purple-500" />
                <KPICard title="Units Sold"     value={bolMarket.units}        prefix="" suffix="" change={null} icon={'\uD83D\uDCE6'} color="bg-indigo-100 text-indigo-600" borderColor="border-indigo-500" />
                <KPICard title="Avg AOV"        value={bolMarket.aov}          prefix={'\u20AC'} change={null} icon={'\uD83D\uDCB0'} color="bg-orange-100 text-orange-600" borderColor="border-orange-500" />
              </div>

              <div className="grid grid-cols-1 gap-4 mb-4">
                <ChartCard title="Revenue & Ad Spend Trend" fullWidth subtitle="Weekly BOL.com revenue vs ad spend">
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={bolTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Area animationDuration={300} type="monotone" dataKey="revenue" fill="#DBEAFE" stroke="#3B82F6" strokeWidth={2} name="Revenue" />
                      <Bar animationDuration={300} dataKey="adSpend" fill="#FCA5A5" opacity={0.7} name="Ad Spend" barSize={20} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <ChartCard title="ROAS Trend" subtitle="Weekly ROAS — Target \u2265 1.5 | Breakeven \u2265 1.0">
                  <ResponsiveContainer width="100%" height={270}>
                    <LineChart data={bolRoasTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                      <ReferenceLine y={1.5} stroke="#10B981" strokeDasharray="4 4" label={{ value: 'Target', position: 'right', fontSize: 10, fill: '#10B981' }} />
                      <Line animationDuration={300} type="monotone" dataKey="roas" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} name="ROAS" />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Ad Efficiency" subtitle="Organic vs ad-driven revenue">
                  {(() => {
                    const effPie = [
                      { name: 'Organic Revenue', value: Math.max(0, bolMarket.revenue - bolMarket.salesFromAds), color: '#3B82F6' },
                      { name: 'Ad Revenue',      value: bolMarket.salesFromAds, color: '#FCA5A5' },
                    ].filter(d => d.value > 0);
                    return (
                      <ResponsiveContainer width="100%" height={270}>
                        <PieChart>
                          <Pie animationDuration={300} data={effPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                            innerRadius={60} outerRadius={95} paddingAngle={3}
                            label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                            labelLine={{ strokeWidth: 1 }}
                          >
                            {effPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip formatter={v => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </ChartCard>
              </div>

              <SectionHeading label="Advertising Details" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <KPICard title="Ad Spend"       value={bolMarket.adSpend}      prefix={'\u20AC'} change={null} icon={'\uD83D\uDCB8'} color="bg-red-100 text-red-600"    borderColor="border-red-500" />
                <KPICard title="Ad Revenue"     value={bolMarket.salesFromAds} prefix={'\u20AC'} change={null} icon={'\uD83D\uDCB5'} color="bg-green-100 text-green-600" borderColor="border-green-500" />
                <KPICard title="ROAS"           value={bolMarket.roas}         prefix=""         change={null} icon={'\uD83C\uDFAF'} color={bolMarket.roas >= 1.5 ? 'bg-green-100 text-green-600' : bolMarket.roas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} borderColor={bolMarket.roas >= 1.5 ? 'border-green-500' : bolMarket.roas >= 1.0 ? 'border-amber-500' : 'border-red-500'} />
                <KPICard title="Ad Spend % Rev" value={bolMarket.revenue > 0 ? (bolMarket.adSpend / bolMarket.revenue * 100) : 0} prefix="" suffix="%" change={null} icon={'\uD83D\uDCCA'} color="bg-blue-100 text-blue-600" borderColor="border-blue-500" />
              </div>

              <div className="grid grid-cols-1 gap-4 mb-6">
                <ChartCard title="Orders & Units Trend" subtitle="Weekly order count and units sold" fullWidth>
                  <ResponsiveContainer width="100%" height={250}>
                    <ComposedChart data={bolTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Bar animationDuration={300} dataKey="orders"  fill="#8B5CF6" name="Orders" barSize={20} opacity={0.8} radius={[4,4,0,0]} />
                      <Line dataKey="units"   stroke="#EC4899" strokeWidth={2} name="Units" dot={{ r: 3 }} type="monotone" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </div>
          )}

          {/* ══════════════════════ AMAZON ANALYTICS TAB ══════════════════════ */}
          {activeTab === 'amz' && (
            <div>
              <SectionHeading label="\uD83D\uDECD\uFE0F Amazon EU Performance" />

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                <KPICard title="Revenue"        value={amzRevenue} prefix={'\u20AC'} change={dashboardData.wowAmz} changeLabel={dashboardData.compareLabel} icon={'\u20AC'}       color="bg-amber-100 text-amber-600"  borderColor="border-amber-500" />
                <KPICard title="Sales from Ads" value={amzSFA}     prefix={'\u20AC'} change={null} icon={'\uD83D\uDCB5'} color="bg-green-100 text-green-600"  borderColor="border-green-500" />
                <KPICard title="Ad Spend"       value={amzAdSpend} prefix={'\u20AC'} change={null} icon={'\uD83D\uDCE2'} color="bg-red-100 text-red-600"     borderColor="border-red-500" />
                <KPICard title="ROAS"           value={amzRoas}    prefix=""         change={null} icon={'\uD83C\uDFAF'} color={amzRoas >= 1.5 ? 'bg-green-100 text-green-600' : amzRoas >= 1.0 ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} borderColor={amzRoas >= 1.5 ? 'border-green-500' : amzRoas >= 1.0 ? 'border-amber-500' : 'border-red-500'} />
                <KPICard title="Orders"         value={amzOrders}  prefix="" suffix="" change={null} icon={'\uD83D\uDED2'} color="bg-purple-100 text-purple-600" borderColor="border-purple-500" />
                <KPICard title="Units Sold"     value={amzUnits}   prefix="" suffix="" change={null} icon={'\uD83D\uDCE6'} color="bg-indigo-100 text-indigo-600" borderColor="border-indigo-500" />
                <KPICard title="Avg AOV"        value={amzAov}     prefix={'\u20AC'} change={null} icon={'\uD83D\uDCB0'} color="bg-orange-100 text-orange-600" borderColor="border-orange-500" />
              </div>

              <div className="grid grid-cols-1 gap-4 mb-4">
                <ChartCard title="Revenue & Ad Spend Trend" fullWidth subtitle="Weekly Amazon EU combined revenue vs ad spend">
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={amzTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <Legend />
                      <Area animationDuration={300} type="monotone" dataKey="revenue" fill="#FEF3C7" stroke="#F59E0B" strokeWidth={2} name="Revenue" />
                      <Bar animationDuration={300} dataKey="adSpend" fill="#FCA5A5" opacity={0.7} name="Ad Spend" barSize={20} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <ChartCard title="Revenue by Marketplace" subtitle="Revenue per Amazon EU country">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={amzMarkets.filter(m => m.revenue > 0)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis type="number" tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={<FlagTickY />} width={100} />
                      <Tooltip content={<EuroTooltip />} />
                      <Bar animationDuration={300} dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]}>
                        {amzMarkets.filter(m => m.revenue > 0).map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="ROAS by Marketplace" subtitle="Green \u2265 1.5 (target) | Amber \u2265 1.0 (breakeven) | Red < 1.0">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={amzMarkets.filter(m => m.revenue > 0)} margin={{ bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="name" tick={<FlagTick />} height={50} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<EuroTooltip />} />
                      <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="3 3" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                      <ReferenceLine y={1.5} stroke="#10B981" strokeDasharray="3 3" label={{ value: 'Target', position: 'right', fontSize: 10, fill: '#10B981' }} />
                      <Bar animationDuration={300} dataKey="roas" name="ROAS" radius={[4, 4, 0, 0]}>
                        {amzMarkets.filter(m => m.revenue > 0).map((e, i) => <Cell key={i} fill={e.roas >= 1.5 ? '#10B981' : e.roas >= 1.0 ? '#F59E0B' : '#EF4444'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Revenue Distribution" subtitle="Share of Amazon EU revenue by country">
                  <ResponsiveContainer width="100%" height={270}>
                    <PieChart>
                      <Pie animationDuration={300} data={amzPieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                        innerRadius={55} outerRadius={95} paddingAngle={2}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {amzPieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={v => `\u20AC${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Ad Spend by Marketplace (Stacked)" subtitle="Weekly ad spend per Amazon EU country">
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={dashboardData.adSpendTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => `\u20AC${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {amzNames.map(name => (
                        <Bar animationDuration={300} key={name} dataKey={name} stackId="a" fill={MARKETPLACE_COLORS[name]} name={name} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <SectionHeading label="Marketplace Breakdown" />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                {amzMarkets.map((m, i) => (
                  <div key={i} className="bg-white rounded-xl shadow-sm p-5 border-t-4" style={{ borderTopColor: m.color }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{MARKETPLACE_FLAGS[m.name] || ''}</span>
                      <span className="font-semibold text-gray-800">{m.name}</span>
                      <span className={`ml-auto text-xs px-2 py-0.5 rounded font-medium ${m.roas >= 1.5 ? 'bg-green-100 text-green-800' : m.roas >= 1.0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                        ROAS {m.roas.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-2xl font-bold mb-3" style={{ color: m.color }}>
                      {'\u20AC'}{m.revenue.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>Ad Spend: <span className="font-medium text-gray-800">{'\u20AC'}{m.adSpend.toFixed(0)}</span></div>
                      <div>Orders: <span className="font-medium text-gray-800">{m.orders}</span></div>
                      <div>Units: <span className="font-medium text-gray-800">{m.units}</span></div>
                      <div>AOV: <span className="font-medium text-gray-800">{'\u20AC'}{m.aov.toFixed(2)}</span></div>
                    </div>
                    {m.weeklyTrend.length > 1 && (
                      <div className="mt-3">
                        <ResponsiveContainer width="100%" height={50}>
                          <AreaChart data={m.weeklyTrend}>
                            <Area animationDuration={300} type="monotone" dataKey="revenue" fill={m.color} fillOpacity={0.15} stroke={m.color} strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 mb-6">
                <ChartCard title="ROAS Trend by Marketplace" subtitle="Weekly ROAS evolution per Amazon EU country" fullWidth>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={dashboardData.roasTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <ReferenceLine y={1.0} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Breakeven', position: 'right', fontSize: 10, fill: '#EF4444' }} />
                      {amzNames.map(name => (
                        <Line key={name} type="monotone" dataKey={name} stroke={MARKETPLACE_COLORS[name]} strokeWidth={2} dot={{ r: 2 }} connectNulls name={name} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </div>
          )}

          {/* ══════════════════════ INVENTORY TAB ══════════════════════ */}
          {activeTab === 'inventory' && (
            <InventoryTab rawData={rawData} />
          )}

          {/* ══════════════════════ P&L TAB ══════════════════════ */}
          {activeTab === 'pnl' && (
            <ProfitTab rawData={rawData} dashboardData={dashboardData} />
          )}

          {/* ══════════════════════ REPORTS TAB ══════════════════════ */}
          {activeTab === 'reports' && (
            <ReportsTab rawData={rawData} />
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

// ============================================================================
// LOGIN PAGE
// ============================================================================

function LoginPage({ onLogin }) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError]       = React.useState('');
  const [showPass, setShowPass] = React.useState(false);
  const [loading, setLoading]   = React.useState(false);

  const VALID_USER = 'HGadmin';
  const VALID_PASS = 'hg2026$$$';

  function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (username === VALID_USER && password === VALID_PASS) {
        sessionStorage.setItem('hg_auth', '1');
        onLogin();
      } else {
        setError('Invalid username or password.');
        setLoading(false);
      }
    }, 400);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '0 16px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="https://hgaesthetics.com/cdn/shop/files/HG-Logo-black.png?crop=center&height=110&v=1753723090&width=210" alt="HG Aesthetics" style={{ height: 48, filter: 'invert(1) brightness(10)' }} />
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 8, letterSpacing: '0.05em' }}>EU E-COMMERCE DASHBOARD</p>
        </div>

        {/* Card */}
        <div style={{ background: '#1e293b', borderRadius: 16, padding: '36px 32px', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', border: '1px solid #334155' }}>
          <h2 style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 700, marginBottom: 4, marginTop: 0 }}>Sign in</h2>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 28 }}>Enter your credentials to access the dashboard.</p>

          <form onSubmit={handleSubmit} autoComplete="off">
            {/* Username */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 6, letterSpacing: '0.04em' }}>USERNAME</label>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); }}
                placeholder="HGadmin"
                required
                style={{ width: '100%', padding: '10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24, position: 'relative' }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, fontWeight: 600, marginBottom: 6, letterSpacing: '0.04em' }}>PASSWORD</label>
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="••••••••"
                required
                style={{ width: '100%', padding: '10px 40px 10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
              <button type="button" onClick={() => setShowPass(p => !p)} style={{ position: 'absolute', right: 12, top: 34, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13 }}>
                {showPass ? '🙈' : '👁'}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', background: loading ? '#334155' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: '#334155', fontSize: 12, marginTop: 24 }}>© 2026 HG Aesthetics EU — Internal Use Only</p>
      </div>
    </div>
  );
}

// ============================================================================
// APP WRAPPER (handles auth)
// ============================================================================

function App() {
  const [authed, setAuthed] = React.useState(() => sessionStorage.getItem('hg_auth') === '1');
  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;
  return <EcommerceDashboard />;
}
