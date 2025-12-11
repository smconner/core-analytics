/**
 * Search Intelligence Dashboard JavaScript
 * Fetches and displays Google search monitoring data
 */

const API_BASE = window.location.origin + '/api/search';

let aiFrequencyChart = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
});

// Refresh dashboard
function refreshDashboard() {
  loadDashboard();
}

// Load all dashboard data
async function loadDashboard() {
  try {
    await Promise.all([
      loadOverview(),
      loadQueries(),
      loadAIOverviews(),
      loadCitations(),
      loadOpportunities()
    ]);

    document.getElementById('last-updated').textContent = `Last updated: ${new Date().toLocaleString()}`;
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Load overview stats
async function loadOverview() {
  try {
    const response = await fetch(`${API_BASE}/overview`);
    const data = await response.json();

    document.getElementById('total-searches').textContent = data.totalSearches.toLocaleString();
    document.getElementById('queries-tracked').textContent = `${data.queriesTracked} queries tracked`;

    document.getElementById('ai-overviews').textContent = data.aiOverviewsFound.toLocaleString();
    document.getElementById('ai-percentage').textContent = `${data.aiOverviewPercentage.toFixed(1)}% of searches`;

    document.getElementById('thailand-mentions').textContent = data.thailandMentions.toLocaleString();
    document.getElementById('vivocare-mentions').textContent = data.vivocareMentions.toLocaleString();

    document.getElementById('opportunities').textContent = data.platformOpportunities.toLocaleString();

    // Update card styling based on mentions
    if (data.thailandMentions > 0) {
      document.getElementById('thailand-card').classList.add('alert');
    }
    if (data.vivocareMentions > 0) {
      document.getElementById('vivocare-card').classList.add('critical');
    }

    // Format dates
    if (data.lastSearchDate) {
      const lastSearch = new Date(data.lastSearchDate);
      document.getElementById('last-search').textContent = lastSearch.toLocaleDateString();
      document.getElementById('last-search').style.fontSize = '1.5rem';
    }

    if (data.firstSearchDate) {
      const firstSearch = new Date(data.firstSearchDate);
      document.getElementById('first-search').textContent = `Since ${firstSearch.toLocaleDateString()}`;
    }
  } catch (error) {
    console.error('Error loading overview:', error);
  }
}

// Load queries
async function loadQueries() {
  try {
    const response = await fetch(`${API_BASE}/queries`);
    const queries = await response.json();

    const grid = document.getElementById('queries-grid');
    grid.innerHTML = '';

    if (queries.length === 0) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No queries tracked yet</div></div>';
      return;
    }

    // Prepare data for AI frequency chart
    const chartLabels = [];
    const chartData = [];
    const chartColors = [];

    queries.forEach(query => {
      const card = document.createElement('div');
      card.className = 'query-card';

      const priorityClass = query.priority === 'high' ? 'high' : '';
      const lastSearchDate = query.lastSearch ? new Date(query.lastSearch).toLocaleDateString() : 'Never';
      const aiPercentage = query.totalSearches > 0 ? ((query.aiOverviewCount / query.totalSearches) * 100).toFixed(0) : 0;

      card.innerHTML = `
        <div class="query-text">"${query.queryText}"</div>
        <div class="query-meta">
          <span class="query-badge ${priorityClass}">${query.category}</span>
          <span class="query-badge">${query.priority} priority</span>
          <span class="query-badge">Last: ${lastSearchDate}</span>
        </div>
        <div class="query-stats">
          <div class="query-stat">
            <div class="query-stat-label">Searches</div>
            <div class="query-stat-value">${query.totalSearches}</div>
          </div>
          <div class="query-stat">
            <div class="query-stat-label">AI Overview</div>
            <div class="query-stat-value">${aiPercentage}%</div>
          </div>
          <div class="query-stat">
            <div class="query-stat-label">Opportunities</div>
            <div class="query-stat-value">${query.opportunityCount}</div>
          </div>
        </div>
      `;

      grid.appendChild(card);

      // Add to chart data
      chartLabels.push(query.queryText.substring(0, 30) + (query.queryText.length > 30 ? '...' : ''));
      chartData.push(aiPercentage);
      chartColors.push(aiPercentage > 80 ? '#10b981' : aiPercentage > 50 ? '#f59e0b' : '#64748b');
    });

    // Create AI frequency chart
    createAIFrequencyChart(chartLabels, chartData, chartColors);
  } catch (error) {
    console.error('Error loading queries:', error);
  }
}

// Create AI frequency chart
function createAIFrequencyChart(labels, data, colors) {
  const ctx = document.getElementById('ai-frequency-chart');

  if (aiFrequencyChart) {
    aiFrequencyChart.destroy();
  }

  aiFrequencyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'AI Overview Frequency (%)',
        data: data,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
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
          padding: 12,
          displayColors: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            color: '#94a3b8',
            callback: function(value) {
              return value + '%';
            }
          },
          grid: {
            color: '#334155',
            drawBorder: false
          }
        },
        x: {
          ticks: {
            color: '#94a3b8',
            maxRotation: 45,
            minRotation: 45
          },
          grid: {
            display: false
          }
        }
      }
    }
  });
}

// Load AI Overviews
async function loadAIOverviews() {
  try {
    const response = await fetch(`${API_BASE}/ai-overviews?limit=5`);
    const overviews = await response.json();

    const container = document.getElementById('ai-overviews-list');
    container.innerHTML = '';

    if (overviews.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🤖</div><div class="empty-state-text">No AI Overviews captured yet</div></div>';
      return;
    }

    overviews.forEach(overview => {
      const card = document.createElement('div');
      card.className = 'ai-overview-card';

      // Highlight brand mentions in text
      let overviewText = overview.overviewText;
      if (overview.mentionsThailand) {
        overviewText = overviewText.replace(/thailand/gi, '<span class="brand-mention">Thailand</span>');
      }
      if (overview.mentionsVivocare) {
        overviewText = overviewText.replace(/vivocare/gi, '<span class="brand-mention">VivoCare</span>');
      }

      let citationsHTML = '';
      if (overview.citations && overview.citations.length > 0) {
        citationsHTML = `
          <div class="citations">
            <div class="citations-title">${overview.citationCount} Citations:</div>
            ${overview.citations.slice(0, 5).map(citation => `
              <div class="citation">
                <div class="citation-pos">#${citation.position}</div>
                <div class="citation-info">
                  <div class="citation-domain">${citation.domain}</div>
                  <div class="citation-title">${citation.title || citation.snippet || 'No title'}</div>
                </div>
              </div>
            `).join('')}
            ${overview.citations.length > 5 ? `<div style="color: #64748b; font-size: 0.875rem; margin-top: 8px;">+ ${overview.citations.length - 5} more citations</div>` : ''}
          </div>
        `;
      }

      const searchDate = new Date(overview.searchDate).toLocaleString();

      card.innerHTML = `
        <div class="ai-overview-header">
          <div class="ai-query">"${overview.queryText}"</div>
          <div class="ai-date">${searchDate}</div>
        </div>
        <div class="ai-text">${overviewText}</div>
        ${citationsHTML}
      `;

      container.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading AI overviews:', error);
  }
}

// Load citations
async function loadCitations() {
  try {
    const response = await fetch(`${API_BASE}/citations?limit=20`);
    const citations = await response.json();

    const tbody = document.querySelector('#citations-table tbody');
    tbody.innerHTML = '';

    if (citations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 40px;">No citations data available yet</td></tr>';
      return;
    }

    citations.forEach(citation => {
      const row = document.createElement('tr');

      const organicRank = citation.avgOrganicPosition ? `#${citation.avgOrganicPosition}` : '--';
      const appearsInOrganic = citation.appearsInOrganic ? '✓' : '';

      row.innerHTML = `
        <td><a href="https://${citation.domain}" target="_blank" class="domain-link">${citation.domain}</a></td>
        <td><strong>${citation.citationCount}</strong></td>
        <td>#${citation.avgPosition}</td>
        <td>${appearsInOrganic}</td>
        <td>${organicRank}</td>
      `;

      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading citations:', error);
  }
}

// Load opportunities
async function loadOpportunities() {
  try {
    const response = await fetch(`${API_BASE}/opportunities?status=new`);
    const opportunities = await response.json();

    const container = document.getElementById('opportunities-list');
    container.innerHTML = '';

    if (opportunities.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><div class="empty-state-text">No platform opportunities found yet</div></div>';
      return;
    }

    opportunities.forEach(opp => {
      const card = document.createElement('div');
      card.className = 'opportunity-card';

      const platformClass = `platform-${opp.platformName.toLowerCase()}`;
      const priorityClass = opp.priority === 'high' ? 'priority-high' : '';
      const searchDate = new Date(opp.searchDate).toLocaleDateString();

      card.innerHTML = `
        <div class="opportunity-header">
          <span class="platform-badge ${platformClass}">${opp.platformName}</span>
          <span class="${priorityClass}">${opp.priority.toUpperCase()}</span>
        </div>
        <div class="opportunity-title">${opp.title}</div>
        <a href="${opp.url}" target="_blank" class="opportunity-url">${opp.url}</a>
        <div class="opportunity-snippet">${opp.snippet}</div>
        <div style="margin-top: 12px; color: #64748b; font-size: 0.875rem;">
          Query: "${opp.queryText}" • Found: ${searchDate}
        </div>
      `;

      container.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading opportunities:', error);
  }
}
