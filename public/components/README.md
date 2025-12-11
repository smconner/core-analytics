# ModelZero Consistent Header Component

## Usage

To use the consistent header across all ModelZero pages:

1. Include the header CSS in your `<head>`:
```html
<link rel="stylesheet" href="/components/header.css">
```

2. Use this standard header structure:
```html
<header>
  <div class="header-top">
    <h1>Your Page Title</h1>
    <span class="version">v1.0</span>
  </div>
  <p class="subtitle">Your page description</p>
  <div class="nav-links">
    <a href="/" class="nav-link">Bot Analytics</a>
    <a href="/search-intelligence/" class="nav-link">Search Intelligence</a>
    <a href="/explore" class="nav-link">Data Explorer</a>
  </div>
</header>
```

3. Add `class="active"` to the current page's nav link

## Pages Updated

- ✅ Bot Analytics (`/index.html`)
- ✅ Search Intelligence Dashboard (`/search-intelligence/index.html`)
- ✅ Data Explorer (`/explore.html`)

## Styling

The header uses a consistent purple gradient for titles and standardized spacing, colors, and hover effects across all pages.
