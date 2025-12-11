// ModelZero Analytics Dashboard
// Real-time AI bot traffic visualization

// Centralized color scheme - single source of truth
const BOT_COLORS = {
  'Human': '#10b981',                // Green - real human traffic
  'Official AI': '#3b82f6',          // Blue - declared AI bots
  'Stealth AI': '#f59e0b',           // Orange - undeclared AI
  'Web Crawler': '#06b6d4',          // Cyan - traditional crawlers
  'Monitoring': '#8b5cf6',           // Purple - uptime/monitoring services
  'Undetermined Bot': '#64748b',     // Gray - unknown bot type
  'Attack Traffic': '#ef4444',       // Red - all attack traffic lumped together
  'Attack: WordPress': '#ef4444',    // Red - attack traffic (legacy)
  'Attack: WebShell': '#dc2626',     // Dark red (legacy)
  'Attack: Config': '#b91c1c',       // Darker red (legacy)
  'Attack: Exploit': '#991b1b'       // Darkest red (legacy)
};

let timelineChart, botClassificationChart, topBotsChart, geoMap, heatLayer;
let currentTimeRange = '24h';
let currentVizMode = 'proportional';
let thaibelleMemoryCareOnly = true; // Default to Memory Care Only view
let allMarkers = [];
let markerClusterGroup = null;
let cachedGeoData = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
  initializeCharts();
  initializeGeographicMap();

  await loadDashboardData();

  // Set up time range selectors
  document.querySelectorAll('.time-btn[data-range]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      document.querySelectorAll('.time-btn[data-range]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTimeRange = e.target.dataset.range;
      await loadDashboardData();
    });
  });

  // Set up visualization mode selectors
  document.querySelectorAll('.viz-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.viz-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentVizMode = e.target.dataset.mode;
      if (cachedGeoData) {
        updateGeographicVisualization(cachedGeoData);
      }
    });
  });

  // Set up Unique IPs card click handler
  document.getElementById('unique-ips-card').addEventListener('click', () => {
    // Navigate to Data Explorer with current time range and auto-execute unique IPs query
    window.location.href = `/explore.html?range=${currentTimeRange}&cmd=show unique ips`;
  });

  // Auto-refresh every 2 minutes
  setInterval(loadDashboardData, 120000);
});

// Initialize empty charts
function initializeCharts() {
  // Timeline Chart
  const timelineCtx = document.getElementById('timelineChart').getContext('2d');
  timelineChart = new Chart(timelineCtx, {
    type: 'line',
    data: {
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#e2e8f0',
          bodyColor: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
        }
      },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day',
            displayFormats: {
              day: 'MMM d'
            }
          },
          grid: {
            color: '#334155'
          },
          ticks: {
            color: '#94a3b8',
            font: {
              size: 14
            }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: '#334155'
          },
          ticks: {
            color: '#94a3b8'
          },
          title: {
            display: true,
            text: 'Unique Visitors (IPs)',
            color: '#94a3b8'
          }
        }
      }
    }
  });

  // Bot Classification Pie Chart
  const botClassCtx = document.getElementById('botClassificationChart').getContext('2d');
  botClassificationChart = new Chart(botClassCtx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderWidth: 2,
        borderColor: '#1e293b'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#e2e8f0',
            padding: 20,
            font: {
              size: 14
            }
          }
        },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#e2e8f0',
          bodyColor: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
        }
      }
    }
  });

  // Top Bots Bar Chart
  const topBotsCtx = document.getElementById('topBotsChart').getContext('2d');
  topBotsChart = new Chart(topBotsCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Requests',
        data: [],
        backgroundColor: '#667eea',
        borderColor: '#764ba2',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#e2e8f0',
          bodyColor: '#e2e8f0',
          borderColor: '#334155',
          borderWidth: 1,
        }
      },
      scales: {
        x: {
          grid: {
            color: '#334155'
          },
          ticks: {
            color: '#94a3b8'
          }
        },
        y: {
          grid: {
            display: false
          },
          ticks: {
            color: '#94a3b8'
          }
        }
      }
    }
  });
}

// Load dashboard data from API
async function loadDashboardData() {
  try {
    const data = await fetchDashboardData(currentTimeRange);

    // Update stats with current time range
    updateStats(data.stats, currentTimeRange);

    // Update timeline chart
    updateTimelineChart(data.timeline);

    // Update bot classification chart
    updateBotClassificationChart(data.botClassification);

    // Update top bots chart
    updateTopBotsChart(data.topBots);

    // Update geographic visualization
    await updateGeographicData();

    // Update last updated time
    document.getElementById('last-updated').textContent = new Date().toLocaleString();

  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    showError('Failed to load dashboard data. Please check the console for details.');
  }
}

// Fetch data from PostgreSQL via API
async function fetchDashboardData(timeRange) {
  try {
    const filterParam = thaibelleMemoryCareOnly ? '&thaibelleMemoryCareOnly=true' : '';

    // Fetch all data in parallel
    const [statsRes, timelineRes, botClassRes, topBotsRes] = await Promise.all([
      fetch(`/api/stats?range=${timeRange}${filterParam}`),
      fetch(`/api/timeline?range=${timeRange}${filterParam}`),
      fetch(`/api/bot-classification?range=${timeRange}${filterParam}`),
      fetch(`/api/top-bots?range=${timeRange}${filterParam}`)
    ]);

    const [stats, timeline, botClassification, topBots] = await Promise.all([
      statsRes.json(),
      timelineRes.json(),
      botClassRes.json(),
      topBotsRes.json()
    ]);

    return {
      stats,
      timeline,
      botClassification,
      topBots
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    throw error;
  }
}

// Helper function to format time range for display
function formatTimeRange(range) {
  const ranges = {
    '6h': { short: '6H', long: 'Last 6 hours' },
    '24h': { short: '24H', long: 'Last 24 hours' },
    '7d': { short: '7D', long: 'Last 7 days' },
    '30d': { short: '30D', long: 'Last 30 days' }
  };
  return ranges[range] || ranges['24h'];
}

// Update stats cards
function updateStats(stats, timeRange) {
  const rangeText = formatTimeRange(timeRange);

  // Update Total Requests label and value
  document.getElementById('total-requests-label').textContent = 'Total Requests';
  document.getElementById('total-requests').textContent = stats.totalRequests.toLocaleString();
  document.getElementById('total-requests-change').textContent = rangeText.long;

  // Update Unique IPs
  document.getElementById('unique-ips').textContent = stats.uniqueIps.toLocaleString();
  document.getElementById('unique-ips-change').textContent = rangeText.long;

  // Update Human Traffic
  document.getElementById('human-count').textContent = (stats.human || 0).toLocaleString();
  const humanPct = ((stats.human || 0) / stats.totalRequests * 100).toFixed(1);
  document.getElementById('human-pct').textContent = `${humanPct}% of traffic`;

  // Update AI Bot counts
  document.getElementById('official-ai-count').textContent = (stats.aiOfficial || 0).toLocaleString();
  document.getElementById('stealth-ai-count').textContent = (stats.aiStealth || 0).toLocaleString();
  document.getElementById('web-crawler-count').textContent = (stats.webCrawler || 0).toLocaleString();

  const officialPct = ((stats.aiOfficial || 0) / stats.totalRequests * 100).toFixed(1);
  const stealthPct = ((stats.aiStealth || 0) / stats.totalRequests * 100).toFixed(1);
  const webCrawlerPct = ((stats.webCrawler || 0) / stats.totalRequests * 100).toFixed(1);

  document.getElementById('official-ai-pct').textContent = `${officialPct}% of traffic`;
  document.getElementById('stealth-ai-pct').textContent = `${stealthPct}% of traffic`;
  document.getElementById('web-crawler-pct').textContent = `${webCrawlerPct}% of traffic`;

  // Update Infrastructure & Unknown
  document.getElementById('monitoring-count').textContent = (stats.monitoringService || 0).toLocaleString();
  document.getElementById('undetermined-count').textContent = (stats.botUndetermined || 0).toLocaleString();
  document.getElementById('attack-count').textContent = (stats.attackTraffic || 0).toLocaleString();

  const monitoringPct = ((stats.monitoringService || 0) / stats.totalRequests * 100).toFixed(1);
  const undeterminedPct = ((stats.botUndetermined || 0) / stats.totalRequests * 100).toFixed(1);
  const attackPct = ((stats.attackTraffic || 0) / stats.totalRequests * 100).toFixed(1);

  document.getElementById('monitoring-pct').textContent = `${monitoringPct}% of traffic`;
  document.getElementById('undetermined-pct').textContent = `${undeterminedPct}% of traffic`;
  document.getElementById('attack-pct').textContent = `${attackPct}% of traffic`;
}

// Update timeline chart
function updateTimelineChart(timelineData) {
  const datasets = [];

  // Site colors
  const siteColors = {
    'veteransmemorycare.org': '#f59e0b',  // Amber/Orange
    'memorycareguide.org': '#3b82f6',     // Blue
    'thaibelle.com': '#8b5cf6'            // Purple
  };

  Object.keys(timelineData).forEach(site => {
    datasets.push({
      label: site,
      data: timelineData[site].map(d => ({ x: d.time, y: d.count })),
      borderColor: siteColors[site],
      backgroundColor: siteColors[site] + '20',
      tension: 0.1,
      cubicInterpolationMode: 'monotone',
      fill: true
    });
  });

  // Update time axis configuration based on current time range
  const timeConfig = {
    '6h': { unit: 'minute', displayFormat: 'HH:mm' },
    '24h': { unit: 'hour', displayFormat: 'HH:mm' },
    '7d': { unit: 'hour', displayFormat: 'MMM d HH:mm' },
    '30d': { unit: 'day', displayFormat: 'MMM d' }
  };

  const config = timeConfig[currentTimeRange] || timeConfig['24h'];

  timelineChart.options.scales.x.time.unit = config.unit;
  timelineChart.options.scales.x.time.displayFormats = {
    minute: 'HH:mm',
    hour: config.displayFormat,
    day: config.displayFormat
  };

  timelineChart.data.datasets = datasets;
  timelineChart.update();
}

// Update bot classification chart
function updateBotClassificationChart(data) {
  botClassificationChart.data.labels = data.map(d => d.name);
  botClassificationChart.data.datasets[0].data = data.map(d => d.count);
  botClassificationChart.data.datasets[0].backgroundColor = data.map(d => BOT_COLORS[d.name] || '#64748b');
  botClassificationChart.update();
}

// Update top bots chart
function updateTopBotsChart(data) {
  topBotsChart.data.labels = data.map(d => d.name);
  topBotsChart.data.datasets[0].data = data.map(d => d.count);
  topBotsChart.update();
}

// Show error message
function showError(message) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.textContent = message;
  document.querySelector('.container').prepend(errorDiv);

  setTimeout(() => errorDiv.remove(), 5000);
}

// Initialize geographic map
function initializeGeographicMap() {
  // Create map centered on world view
  geoMap = L.map('geoMap', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 8,
    zoomControl: true,
    attributionControl: true
  });

  // Use dark CartoDB basemap tiles (free, no API key required)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(geoMap);
}

// Fetch geographic data and update visualization
async function updateGeographicData() {
  try {
    const filterParam = thaibelleMemoryCareOnly ? '&thaibelleMemoryCareOnly=true' : '';
    const data = await fetch(`/api/geographic-heatmap?range=${currentTimeRange}${filterParam}`)
      .then(r => r.json());

    cachedGeoData = data;
    updateGeographicVisualization(data);
  } catch (error) {
    console.error('Failed to load geographic data:', error);
  }
}

// Update geographic visualization based on current mode
function updateGeographicVisualization(data) {
  clearMapLayers();

  switch(currentVizMode) {
    case 'heatmap':
      renderHeatmap(data);
      break;
    case 'proportional':
      renderProportionalSymbols(data);
      break;
    case 'clusters':
      renderMarkerClusters(data);
      break;
  }
}

// Clear all map layers
function clearMapLayers() {
  // Remove heatmap layer
  if (heatLayer) {
    geoMap.removeLayer(heatLayer);
    heatLayer = null;
  }

  // Remove all markers
  allMarkers.forEach(marker => {
    geoMap.removeLayer(marker);
  });
  allMarkers = [];

  // Remove cluster group
  if (markerClusterGroup) {
    geoMap.removeLayer(markerClusterGroup);
    markerClusterGroup = null;
  }
}

// Helper function to determine dominant bot type color
function getBotTypeColor(location) {
  const human = parseInt(location.human_count) || 0;
  const officialAI = parseInt(location.official_ai_count) || 0;
  const stealthAI = parseInt(location.stealth_ai_count) || 0;
  const webCrawler = parseInt(location.web_crawler_count) || 0;
  const monitoring = parseInt(location.monitoring_count) || 0;

  const max = Math.max(human, officialAI, stealthAI, webCrawler, monitoring);

  if (max === 0) return '#667eea'; // Default purple
  if (max === human) return BOT_COLORS['Human'];
  if (max === officialAI) return BOT_COLORS['Official AI'];
  if (max === stealthAI) return BOT_COLORS['Stealth AI'];
  if (max === webCrawler) return BOT_COLORS['Web Crawler'];
  if (max === monitoring) return BOT_COLORS['Monitoring'];
  return '#667eea'; // Default purple
}

// Helper function to create detailed popup
function createDetailedPopup(location) {
  const human = parseInt(location.human_count) || 0;
  const officialAI = parseInt(location.official_ai_count) || 0;
  const stealthAI = parseInt(location.stealth_ai_count) || 0;
  const webCrawler = parseInt(location.web_crawler_count) || 0;
  const monitoring = parseInt(location.monitoring_count) || 0;

  return `
    <div style="font-family: inherit;">
      <strong>${location.city || 'Unknown'}, ${location.country || 'Unknown'}</strong><br>
      <strong>Total: ${location.count.toLocaleString()}</strong><br>
      <div style="margin-top: 8px; font-size: 0.875rem;">
        <span style="color: ${BOT_COLORS['Human']};">●</span> Human: ${human.toLocaleString()}<br>
        <span style="color: ${BOT_COLORS['Official AI']};">●</span> Official AI: ${officialAI.toLocaleString()}<br>
        <span style="color: ${BOT_COLORS['Stealth AI']};">●</span> Stealth AI: ${stealthAI.toLocaleString()}<br>
        <span style="color: ${BOT_COLORS['Web Crawler']};">●</span> Web Crawler: ${webCrawler.toLocaleString()}<br>
        <span style="color: ${BOT_COLORS['Monitoring']};">●</span> Monitoring: ${monitoring.toLocaleString()}
      </div>
    </div>
  `;
}

// Render heatmap visualization
function renderHeatmap(data) {
  const heatData = data.map(d => [
    parseFloat(d.lat),
    parseFloat(d.lng),
    parseFloat(d.count)
  ]);

  heatLayer = L.heatLayer(heatData, {
    radius: 25,
    blur: 15,
    maxZoom: 10,
    max: 1.0,
    gradient: {
      0.0: '#667eea',
      0.5: '#764ba2',
      0.7: '#ef4444',
      1.0: '#fbbf24'
    }
  }).addTo(geoMap);
}

// Render proportional symbols (graduated circles)
function renderProportionalSymbols(data) {
  if (data.length === 0) return;

  // Find max count for scaling
  const maxCount = Math.max(...data.map(d => d.count));

  data.forEach(location => {
    // Scale radius by square root for accurate area representation
    const radius = Math.sqrt(location.count / maxCount) * 25 + 5; // 5-30px range

    const marker = L.circleMarker([location.lat, location.lng], {
      radius: radius,
      fillColor: getBotTypeColor(location),
      color: '#e2e8f0',
      weight: 2,
      opacity: 0.8,
      fillOpacity: 0.6
    })
    .bindPopup(createDetailedPopup(location))
    .addTo(geoMap);

    allMarkers.push(marker);
  });
}

// Render marker clusters
function renderMarkerClusters(data) {
  markerClusterGroup = L.markerClusterGroup({
    iconCreateFunction: (cluster) => {
      const markers = cluster.getAllChildMarkers();
      const totalCount = markers.reduce((sum, m) => sum + m.options.count, 0);

      // Size clusters by total volume
      let size = 'small';
      if (totalCount > 1000) size = 'large';
      else if (totalCount > 100) size = 'medium';

      return L.divIcon({
        html: `<div><span>${markers.length}</span></div>`,
        className: `marker-cluster marker-cluster-${size}`,
        iconSize: L.point(40, 40)
      });
    },
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 80
  });

  data.forEach(location => {
    const marker = L.marker([location.lat, location.lng], {
      count: location.count,
      icon: L.divIcon({
        html: `<div style="
          background-color: ${getBotTypeColor(location)};
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid #e2e8f0;
        "></div>`,
        className: '',
        iconSize: [12, 12]
      })
    })
    .bindPopup(createDetailedPopup(location));

    markerClusterGroup.addLayer(marker);
  });

  geoMap.addLayer(markerClusterGroup);
}
