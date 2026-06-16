# Deploying MIRO Market Workstation to Cloudflare Workers

This guide explains how to deploy the redesigned MIRO Market Workstation frontend to Cloudflare Workers.

## Overview

The application has been redesigned as a single-file HTML application compatible with Cloudflare Workers, featuring:
- MATLAB-style ribbon toolbar with 5 tab groups
- Left sidebar Market Watch (130px) 
- Center 2x2 resizable tile grid
- Right panel Workspace Inspector (148px)
- Bottom dock with tabs and command input
- Status bar
- Live data fetching from public APIs (Binance, CoinGecko, Yahoo Finance)

## Deployment Methods

### Method 1: Using Wrangler CLI (Recommended)

1. **Install wrangler** (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

3. **Deploy the worker**:
   ```bash
   wrangler deploy
   ```

4. **Visit your deployed application** at the URL provided by wrangler.

### Method 2: Manual Upload via Cloudflare Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account → Workers & Pages → Create Application → Workers
3. Create a new Worker service
4. Replace the default worker script with the contents of `worker.js`
5. Save and deploy

### Method 3: Using wrangler.toml (Alternative Configuration)

If you prefer TOML format, you can convert the wrangler.jsonc to wrangler.toml:

```toml
name = "miro-market-mind"
compatibility_date = "2025-09-24"
compatibility_flags = ["nodejs_compat"]
main = "./worker.js"

[assets]
directory = "./"
binding = "ASSETS"

[vars]
NODE_ENV = "production"
```

Then deploy with: `wrangler deploy`

## Local Development & Testing

To test the worker locally before deploying:

1. **Install wrangler** (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. **Start local development server**:
   ```bash
   wrangler dev
   ```

3. **Visit** http://localhost:8787 to see your application

## Configuration Notes

- The worker serves the complete HTML application from the `MIRO_HTML` constant
- Split.js is fetched from CDN when requested (handled in the worker fetch handler)
- All data fetching happens client-side from public APIs (no API keys required)
- The application updates data every 3 seconds
- Responsive design works on desktop and mobile browsers

## Customization

To modify the application:
1. Edit the `MIRO_HTML` constant in `worker.js` to change the HTML/CSS/JS
2. Or edit the original `index.html` and update the worker.js accordingly
3. Redeploy after making changes

## Troubleshooting

- **CORS issues**: The worker fetches data from public APIs which should allow CORS
- **Service worker conflicts**: If you have existing service workers, you may need to unregister them
- **Deployment failures**: Check wrangler logs with `wrangler logs --tail`

## Files Included

- `worker.js` - The Cloudflare Worker script serving the application
- `wrangler.jsonc` - Updated wrangler configuration pointing to worker.js
- `index.html` - The original HTML file (kept for reference)
- `DEPLOYMENT_GUIDE.md` - This guide

## Note on Original Project Structure

This deployment replaces the original TanStack Start-based frontend with a standalone HTML/JavaScript application. The backend logic and API integrations in the `src/` directory remain untouched and can still be used if you wish to revert to the original frontend approach.

For any questions or issues, please refer to the Cloudflare Workers documentation:
https://developers.cloudflare.com/workers/