const CSV_URL = 'https://docs.google.com/spreadsheets/d/1odUPX5mWpUYUUQOrhX_k8kXWV7drMUdQ58DRwgSQNS8/gviz/tq?tqx=out:csv&sheet=Data%20DB';

let rawData = [];
let charts = {};
let currentFilter = 'all';

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchAndRender();
    // Auto-refresh every 5 minutes
    setInterval(fetchAndRender, 300000);
});

async function fetchAndRender() {
    showToast('Syncing with GHN Cloud...');
    try {
        const response = await fetch(`${CSV_URL}&t=${Date.now()}`); // Cache busting
        const csvText = await response.text();
        rawData = d3.csvParse(csvText);
        
        processData();
        if (!document.getElementById('date-filter').options.length) {
            initFilters();
        }
        updateDashboard();
        document.getElementById('last-update').textContent = `Last sync: ${new Date().toLocaleTimeString()}`;
        showToast('Data synchronized successfully', 'success');
    } catch (error) {
        console.error('Error:', error);
        showToast('Sync failed!', 'danger');
    }
}

function processData() {
    rawData.forEach(d => {
        // Chuẩn hóa hỗ trợ cả tiêu đề viết hoa và viết thường từ Google Sheet
        ['BL LM', 'BL LM >5 ngay', 'BL KTC', '%BL LM >5 ngay', 'BL KTC cung tinh', '%BL KTC cung tinh'].forEach(k => {
            if (d[k] === undefined && d[k.toLowerCase()] !== undefined) {
                d[k] = d[k.toLowerCase()];
            }
        });
        d['BL LM'] = +d['BL LM'] || 0;
        d['BL KTC'] = +d['BL KTC'] || 0;
        d['BL LM >5 ngay'] = +d['BL LM >5 ngay'] || 0;
        d['gtc_avg_7ngay'] = +d['gtc_avg_7ngay'] || 0;
        d['gtc_max_7ngay'] = +d['gtc_max_7ngay'] || 0;
        d['du_kien_clear_ton'] = +d['du_kien_clear_ton'] || 0;
        
        d.date = (d.ngay || d.update_time || '').split(' ')[0].replace(/\//g, '-');
        d.total_backlog = d['BL LM'] + d['BL KTC'];
        d.ratio = d.gtc_avg_7ngay > 0 ? (d.total_backlog / d.gtc_avg_7ngay) : 0;
        
        // Advanced Metrics
        d.efficiency = d['gtc_max_7ngay'] > 0 ? (d['gtc_avg_7ngay'] / d['gtc_max_7ngay']) : 0;
        
        // Risk Score Calculation (0-100)
        let risk = 0;
        if (d.tinh_hinh === 'Bất ổn') risk += 30;
        risk += Math.min(d.du_kien_clear_ton * 20, 40); // Max 40 points from clearance days
        risk += Math.min(d['BL LM >5 ngay'] * 2, 30); // Max 30 points from aging
        d.riskScore = Math.min(Math.round(risk), 100);

        // Root Cause extraction
        d.reason = d.ly_do_bat_on || 'N/A';
        if (d.reason.includes('|')) d.reason = 'Multiple Issues';
    });
}

function initFilters() {
    const dates = [...new Set(rawData.map(d => d.date))].sort().reverse();
    const regions = [...new Set(rawData.map(d => d.vung_giao))].sort();
    
    const dateSelect = document.getElementById('date-filter');
    dates.forEach(date => {
        const opt = new Option(formatDate(date), date);
        dateSelect.add(opt);
    });

    const regionSelect = document.getElementById('region-filter');
    regions.forEach(r => regionSelect.add(new Option(r, r)));

    // Event Listeners
    dateSelect.addEventListener('change', updateDashboard);
    regionSelect.addEventListener('change', () => {
        updateProvinceFilter();
        updateDashboard();
    });
    document.getElementById('province-filter').addEventListener('change', updateDashboard);
    document.getElementById('search-box').addEventListener('input', () => updateTable());
    document.getElementById('refresh-btn').addEventListener('click', fetchAndRender);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            updateDashboard();
        });
    });
}

function updateProvinceFilter() {
    const region = document.getElementById('region-filter').value;
    const provinces = [...new Set(rawData
        .filter(d => region === 'All' || d.vung_giao === region)
        .map(d => d.tinh_giao)
    )].sort();

    const provinceSelect = document.getElementById('province-filter');
    provinceSelect.innerHTML = '<option value="All">ALL PROVINCES</option>';
    provinces.forEach(p => provinceSelect.add(new Option(p, p)));
}

function updateDashboard() {
    const date = document.getElementById('date-filter').value;
    const region = document.getElementById('region-filter').value;
    const province = document.getElementById('province-filter').value;

    const filteredData = rawData.filter(d => 
        d.date === date && 
        (region === 'All' || d.vung_giao === region) &&
        (province === 'All' || d.tinh_giao === province)
    );

    const dates = [...new Set(rawData.map(d => d.date))].sort();
    const dateIdx = dates.indexOf(date);
    const prevDate = dateIdx > 0 ? dates[dateIdx - 1] : null;
    const prevData = prevDate ? rawData.filter(d => d.date === prevDate) : [];

    renderScorecards(filteredData, prevData);
    renderCharts(filteredData);
    updateTable(filteredData, prevData);
}

function renderScorecards(current, prev) {
    const unstable = current.filter(d => d.tinh_hinh === 'Bất ổn');
    const aging = current.filter(d => d['BL LM >5 ngay'] > 0);
    const totalBacklog = d3.sum(current, d => d.total_backlog);
    
    // Network Health Index
    const health = 100 - (unstable.length / (current.length || 1) * 100);
    const healthEl = document.getElementById('card-health');
    healthEl.querySelector('.kpi-value').textContent = `${Math.round(health)}%`;
    healthEl.querySelector('.kpi-gauge-fill').style.width = `${health}%`;
    healthEl.querySelector('.kpi-gauge-fill').style.background = health > 90 ? 'var(--success)' : (health > 70 ? 'var(--warning)' : 'var(--danger)');

    // Delta helpers
    const getDelta = (curr, prevVal) => {
        if (!prevVal) return { val: 0, text: '--' };
        const diff = curr - prevVal;
        return { val: diff, text: `${diff > 0 ? '+' : ''}${diff}` };
    };

    const prevUnstable = prev.filter(d => d.tinh_hinh === 'Bất ổn').length;
    const prevAging = prev.filter(d => d['BL LM >5 ngay'] > 0).length;
    const prevBacklog = d3.sum(prev, d => d.total_backlog);

    updateKpi('card-unstable', unstable.length, getDelta(unstable.length, prevUnstable));
    updateKpi('card-aging', aging.length, getDelta(aging.length, prevAging));
    updateKpi('card-backlog-vol', totalBacklog.toLocaleString(), getDelta(totalBacklog, prevBacklog));
}

function updateKpi(id, value, delta) {
    const el = document.getElementById(id);
    el.querySelector('.kpi-value').textContent = value;
    const deltaEl = el.querySelector('.kpi-delta');
    deltaEl.textContent = delta.text;
    deltaEl.className = `kpi-delta ${delta.val > 0 ? 'delta-up' : (delta.val < 0 ? 'delta-down' : 'delta-neutral')}`;
}

function renderCharts(data) {
    // 1. Scatter Plot (Scale vs Risk)
    const scatterCtx = document.getElementById('scatterChart').getContext('2d');
    if (charts.scatter) charts.scatter.destroy();
    
    charts.scatter = new Chart(scatterCtx, {
        type: 'bubble',
        data: {
            datasets: [{
                data: data.map(d => ({
                    x: d.gtc_avg_7ngay,
                    y: d.du_kien_clear_ton,
                    r: Math.sqrt(d['BL LM >5 ngay']) * 2 + 2
                })),
                backgroundColor: data.map(d => d.riskScore > 60 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(249, 115, 22, 0.4)'),
                borderColor: data.map(d => d.riskScore > 60 ? 'var(--danger)' : 'var(--ghn-orange)'),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: 'Avg Volume', color: '#64748B' }, grid: { color: '#21262D' }, ticks: { color: '#94A3B8' } },
                y: { title: { display: true, text: 'Clearance Days', color: '#64748B' }, grid: { color: '#21262D' }, ticks: { color: '#94A3B8' } }
            }
        }
    });

    // 2. Treemap (Root Cause)
    const treeCtx = document.getElementById('treemapChart').getContext('2d');
    if (charts.treemap) charts.treemap.destroy();

    const reasons = d3.rollup(data.filter(d => d.tinh_hinh === 'Bất ổn'), v => v.length, d => d.reason);
    const treeData = Array.from(reasons, ([key, value]) => ({ key, value }));

    charts.treemap = new Chart(treeCtx, {
        type: 'treemap',
        data: {
            datasets: [{
                tree: treeData,
                key: 'value',
                groups: ['key'],
                spacing: 1,
                borderWidth: 0,
                backgroundColor: (ctx) => {
                    const val = ctx.raw?._data?.value || 0;
                    return `rgba(249, 115, 22, ${Math.min(0.2 + val/20, 0.8)})`;
                },
                labels: { display: true, color: '#FFF', font: { family: 'Outfit', weight: 'bold' } }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

function updateTable(data, prevData) {
    const search = document.getElementById('search-box').value.toLowerCase();
    
    let displayData = data;
    if (currentFilter === 'unstable') displayData = data.filter(d => d.tinh_hinh === 'Bất ổn');
    if (currentFilter === 'critical') displayData = data.filter(d => d.riskScore > 70);
    
    if (search) {
        displayData = displayData.filter(d => 
            d.kho_giao_name.toLowerCase().includes(search) || 
            d.kho_giao_id.includes(search)
        );
    }

    const tbody = document.querySelector('#main-table tbody');
    tbody.innerHTML = '';

    displayData.sort((a,b) => b.riskScore - a.riskScore).forEach(d => {
        const statusClass = d.riskScore > 70 ? 'status-crit' : (d.riskScore > 30 ? 'status-warn' : 'status-ok');
        const statusText = d.riskScore > 70 ? 'CRITICAL' : (d.riskScore > 30 ? 'WARNING' : 'STABLE');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="font-weight:700; color:var(--ghn-orange)">${d.kho_giao_name}</div>
                <div style="font-size:10px; color:var(--text-dim)">${d.vung_giao} • ${d.tinh_giao} • ID: ${d.kho_giao_id}</div>
            </td>
            <td>
                <div style="font-weight:600">${d.total_backlog.toLocaleString()}</div>
                <div style="font-size:10px; color:var(--text-secondary)">Aging: ${d['BL LM >5 ngay']}</div>
            </td>
            <td>
                <div style="font-weight:600">${d.du_kien_clear_ton.toFixed(1)}d</div>
                <div style="font-size:10px; color:var(--text-secondary)">Ratio: ${(d.ratio * 100).toFixed(0)}%</div>
            </td>
            <td>
                <div class="eff-box">
                    <span style="font-family:var(--font-mono)">${(d.efficiency * 100).toFixed(0)}%</span>
                    <div class="eff-bar-bg"><div class="eff-bar-fill" style="width: ${d.efficiency * 100}%; background: ${d.efficiency > 0.8 ? 'var(--success)' : 'var(--warning)'}"></div></div>
                </div>
            </td>
            <td>
                <span class="risk-dot" style="background: ${d.riskScore > 70 ? 'var(--danger)' : (d.riskScore > 30 ? 'var(--warning)' : 'var(--success)')}"></span>
                <span style="font-family:var(--font-mono); font-weight:700">${d.riskScore}</span>
            </td>
            <td><span class="status-pill ${statusClass}">${statusText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.className = 'toast', 4000);
}
