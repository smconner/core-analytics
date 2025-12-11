// ModelZero Data Explorer
// Interactive query interface

let currentRange = '24h';
let currentResults = null;
let queryHistory = [];
let historyIndex = -1;

// Command patterns mapping
const COMMAND_PATTERNS = [
  {
    pattern: /unique ip|unique ips|all ips|ip list|ip addresses|show ips/i,
    endpoint: '/api/explore/unique-ips',
    title: 'Unique IP Addresses'
  },
  {
    pattern: /subnet|same network|ip cluster|cluster.*subnet|cluster.*ip/i,
    endpoint: '/api/explore/subnet-clusters',
    title: 'Top IP Subnet Clusters'
  },
  {
    pattern: /burst|rapid|spike|sequential|fast requests|time cluster/i,
    endpoint: '/api/explore/time-bursts',
    title: 'Traffic Burst Activity'
  },
  {
    pattern: /datacenter|data center|cloud|azure|aws|google cloud|gcp/i,
    endpoint: '/api/explore/datacenter-ips',
    title: 'Datacenter IP Traffic'
  },
  {
    pattern: /residential|home|isp|non-datacenter|consumer/i,
    endpoint: '/api/explore/residential-patterns',
    title: 'Residential Traffic Patterns'
  },
  {
    pattern: /asn|autonomous system|network provider|isp provider/i,
    endpoint: '/api/explore/asn-analysis',
    title: 'ASN Analysis'
  },
  {
    pattern: /geographic|geo|location|country|city|region/i,
    endpoint: '/api/explore/geographic-clusters',
    title: 'Geographic Clusters'
  }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const commandInput = document.getElementById('commandInput');
  const executeBtn = document.getElementById('executeBtn');
  const exportBtn = document.getElementById('exportBtn');

  // Check for time range URL parameter and auto-execute
  const urlParams = new URLSearchParams(window.location.search);
  const rangeParam = urlParams.get('range');
  const autoCommand = urlParams.get('cmd');

  if (rangeParam && ['6h', '24h', '7d', '30d'].includes(rangeParam)) {
    currentRange = rangeParam;
    // Update active button
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.range === rangeParam) {
        btn.classList.add('active');
      }
    });
  }

  // Auto-execute command if provided (e.g., from dashboard link)
  if (autoCommand) {
    commandInput.value = autoCommand;
    // Execute after a short delay to ensure DOM is ready
    setTimeout(() => executeCommand(), 100);
  }

  // Command execution
  executeBtn.addEventListener('click', executeCommand);
  commandInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      executeCommand();
    }
  });

  // Command history navigation
  commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHistory('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHistory('down');
    }
  });

  // Quick command buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      commandInput.value = cmd;
      executeCommand();
    });
  });

  // Time range buttons
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
    });
  });

  // Export button
  exportBtn.addEventListener('click', exportToCSV);

  // Focus input on load
  commandInput.focus();
});

// Execute command
async function executeCommand() {
  const commandInput = document.getElementById('commandInput');
  const command = commandInput.value.trim();

  if (!command) return;

  // Add to history
  if (queryHistory[queryHistory.length - 1] !== command) {
    queryHistory.push(command);
    if (queryHistory.length > 50) {
      queryHistory.shift();
    }
  }
  historyIndex = queryHistory.length;

  // Show loading
  showLoading();

  try {
    // First, interpret the command using AI
    const interpretResponse = await fetch('/api/explore/interpret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command })
    });

    if (!interpretResponse.ok) {
      throw new Error(`HTTP ${interpretResponse.status}: ${interpretResponse.statusText}`);
    }

    const interpretation = await interpretResponse.json();

    if (!interpretation.success) {
      // Show suggestions if command not understood
      let errorMsg = 'I didn\'t understand that command. Try asking about:\n\n';
      interpretation.suggestions.forEach(s => {
        errorMsg += `• ${s.name}: ${s.description}\n`;
      });
      showError(errorMsg);
      return;
    }

    // Fetch data from the interpreted endpoint
    const url = `${interpretation.endpoint}?range=${currentRange}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    currentResults = { data, title: interpretation.queryName, command };

    renderResults(data, interpretation.queryName);
  } catch (error) {
    showError(`Failed to fetch data: ${error.message}`);
  }
}

// Navigate command history
function navigateHistory(direction) {
  const commandInput = document.getElementById('commandInput');

  if (direction === 'up' && historyIndex > 0) {
    historyIndex--;
    commandInput.value = queryHistory[historyIndex];
  } else if (direction === 'down') {
    historyIndex++;
    if (historyIndex >= queryHistory.length) {
      historyIndex = queryHistory.length;
      commandInput.value = '';
    } else {
      commandInput.value = queryHistory[historyIndex];
    }
  }
}

// Show loading state
function showLoading() {
  const resultsSection = document.getElementById('resultsSection');
  const resultsContent = document.getElementById('resultsContent');
  const emptyState = document.getElementById('emptyState');

  emptyState.style.display = 'none';
  resultsSection.style.display = 'block';
  resultsContent.innerHTML = '<div class="loading">Loading...</div>';
}

// Show error
function showError(message) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsContent = document.getElementById('resultsContent');
  const emptyState = document.getElementById('emptyState');

  emptyState.style.display = 'none';
  resultsSection.style.display = 'block';
  resultsContent.innerHTML = `<div class="error">${message}</div>`;
}

// Render results as table
function renderResults(data, title) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsTitle = document.getElementById('resultsTitle');
  const resultsContent = document.getElementById('resultsContent');
  const emptyState = document.getElementById('emptyState');

  emptyState.style.display = 'none';
  resultsSection.style.display = 'block';
  resultsTitle.textContent = `${title} (${data.length} rows)`;

  if (data.length === 0) {
    resultsContent.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
    return;
  }

  // Build table
  const columns = Object.keys(data[0]);
  let html = '<table><thead><tr>';

  // Add row number column
  html += '<th>#</th>';

  columns.forEach(col => {
    html += `<th onclick="sortTable('${col}')">${formatColumnName(col)}</th>`;
  });

  html += '</tr></thead><tbody>';

  data.forEach((row, index) => {
    html += '<tr>';
    // Add row number
    html += `<td style="color: #667eea; font-weight: bold;">${index + 1}</td>`;
    columns.forEach(col => {
      html += `<td>${formatCellValue(row[col], col)}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  resultsContent.innerHTML = html;
}

// Format column names
function formatColumnName(col) {
  return col
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Format cell values
function formatCellValue(value, column) {
  if (value === null || value === undefined) return '-';

  // Numbers with commas
  if (typeof value === 'number' && !column.includes('asn')) {
    return value.toLocaleString();
  }

  // Arrays
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  // Truncate long strings
  if (typeof value === 'string' && value.length > 100) {
    return value.substring(0, 97) + '...';
  }

  return value;
}

// Sort table by column
function sortTable(column) {
  if (!currentResults) return;

  const data = currentResults.data;
  const sortedData = [...data].sort((a, b) => {
    const aVal = a[column];
    const bVal = b[column];

    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return bVal - aVal; // Descending for numbers
    }

    return String(aVal).localeCompare(String(bVal));
  });

  currentResults.data = sortedData;
  renderResults(sortedData, currentResults.title);
}

// Export to CSV
function exportToCSV() {
  if (!currentResults || !currentResults.data.length) return;

  const data = currentResults.data;
  const columns = Object.keys(data[0]);

  // Build CSV
  let csv = columns.map(col => `"${formatColumnName(col)}"`).join(',') + '\n';

  data.forEach(row => {
    const values = columns.map(col => {
      let value = row[col];

      if (value === null || value === undefined) return '';
      if (Array.isArray(value)) value = value.join('; ');

      // Escape quotes
      value = String(value).replace(/"/g, '""');

      return `"${value}"`;
    });

    csv += values.join(',') + '\n';
  });

  // Download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `modelzero_${currentResults.command.replace(/\s+/g, '_')}_${timestamp}.csv`;

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
